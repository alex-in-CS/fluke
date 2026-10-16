//! Speech-to-text.
//!
//! * Deepgram: streaming websocket, interim + final results, ~300 ms latency.
//! * OpenAI-compatible `/audio/transcriptions` (OpenAI, Groq, Mistral, local whisper servers):
//!   local voice-activity segmentation, each utterance uploaded as a WAV when it ends.

use std::io::Cursor;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::Message as WsMessage;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderValue, header::AUTHORIZATION};

use crate::audio::TARGET_RATE;
use crate::config::{ProviderConfig, ProviderKind};
use crate::error::{AppError, Result, provider_error};
use crate::llm::LlmClient;
use crate::state::SourceState;

pub struct SttConfig {
    pub provider: ProviderConfig,
    pub api_key: Option<String>,
    pub model: String,
    pub language: String,
}

#[derive(Debug, Clone)]
pub enum SttEvent {
    /// Best guess of the utterance in progress (replaces the previous interim).
    Interim(String),
    /// A finished utterance.
    Final(String),
    Status(SourceState, Option<String>),
}

/// Runs until the audio channel closes (capture stopped) or the task is aborted.
pub async fn run<F>(cfg: SttConfig, http: reqwest::Client, audio: mpsc::Receiver<Vec<i16>>, emit: F)
where
    F: Fn(SttEvent) + Send + Sync + 'static,
{
    match cfg.provider.kind {
        ProviderKind::Deepgram => deepgram(cfg, audio, emit).await,
        ProviderKind::OpenaiCompat => chunked(cfg, http, audio, emit).await,
        _ => emit(SttEvent::Status(
            SourceState::Error,
            Some(format!(
                "{} doesn't support speech-to-text",
                cfg.provider.label
            )),
        )),
    }
}

// ---------------------------------------------------------------------------------------------
// Deepgram streaming
// ---------------------------------------------------------------------------------------------

fn deepgram_url(cfg: &SttConfig) -> String {
    let base = cfg.provider.base_url.trim_end_matches('/');
    let ws_base = base
        .replacen("https://", "wss://", 1)
        .replacen("http://", "ws://", 1);
    let mut url = format!(
        "{ws_base}/v1/listen?model={}&encoding=linear16&sample_rate={TARGET_RATE}&channels=1\
         &interim_results=true&smart_format=true&punctuate=true&endpointing=300\
         &utterance_end_ms=1000&vad_events=true",
        urlencode(&cfg.model)
    );
    let lang = cfg.language.trim();
    if !lang.is_empty() {
        url.push_str(&format!("&language={}", urlencode(lang)));
    }
    url
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

async fn deepgram<F>(cfg: SttConfig, mut audio: mpsc::Receiver<Vec<i16>>, emit: F)
where
    F: Fn(SttEvent) + Send + Sync + 'static,
{
    let mut backoff = Duration::from_millis(500);
    loop {
        emit(SttEvent::Status(SourceState::Connecting, None));
        match deepgram_session(&cfg, &mut audio, &emit).await {
            Ok(SessionEnd::AudioClosed) => {
                emit(SttEvent::Status(SourceState::Off, None));
                return;
            }
            Ok(SessionEnd::Disconnected) => {
                backoff = Duration::from_millis(500);
            }
            Err(e) => {
                tracing::warn!("deepgram: {e}");
                emit(SttEvent::Status(SourceState::Error, Some(e.to_string())));
                // Auth / config errors won't fix themselves by retrying fast.
                if matches!(
                    e,
                    AppError::Provider {
                        status: 400..=403,
                        ..
                    }
                ) {
                    return;
                }
            }
        }
        // Drain audio queued while reconnecting so we don't fall behind real time.
        while audio.try_recv().is_ok() {}
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(Duration::from_secs(10));
    }
}

enum SessionEnd {
    AudioClosed,
    Disconnected,
}

async fn deepgram_session<F>(
    cfg: &SttConfig,
    audio: &mut mpsc::Receiver<Vec<i16>>,
    emit: &F,
) -> Result<SessionEnd>
where
    F: Fn(SttEvent) + Send + Sync,
{
    let mut req = deepgram_url(cfg)
        .into_client_request()
        .map_err(|e| AppError::msg(format!("Deepgram URL: {e}")))?;
    let key = cfg.api_key.clone().unwrap_or_default();
    req.headers_mut().insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Token {key}")).map_err(|e| AppError::msg(e.to_string()))?,
    );
    let (ws, _) = tokio_tungstenite::connect_async(req)
        .await
        .map_err(|e| match e {
            tokio_tungstenite::tungstenite::Error::Http(resp) => {
                let body = resp
                    .body()
                    .as_ref()
                    .map(|b| String::from_utf8_lossy(b).into_owned())
                    .unwrap_or_default();
                provider_error("Deepgram", resp.status().as_u16(), &body)
            }
            other => AppError::msg(format!("Deepgram connection failed: {other}")),
        })?;
    emit(SttEvent::Status(SourceState::Live, None));
    let (mut tx, mut rx) = ws.split();

    // Finals for the current utterance, joined when Deepgram marks speech_final / UtteranceEnd.
    let mut finals: Vec<String> = Vec::new();
    let mut last_sent = Instant::now();
    let mut keepalive = tokio::time::interval(Duration::from_secs(3));

    let flush = |finals: &mut Vec<String>| {
        if !finals.is_empty() {
            emit(SttEvent::Final(finals.join(" ")));
            finals.clear();
        }
    };

    loop {
        tokio::select! {
            frame = audio.recv() => {
                let Some(frame) = frame else {
                    let _ = tx.send(WsMessage::text(r#"{"type":"CloseStream"}"#)).await;
                    flush(&mut finals);
                    return Ok(SessionEnd::AudioClosed);
                };
                let bytes: Vec<u8> = frame.iter().flat_map(|s| s.to_le_bytes()).collect();
                if tx.send(WsMessage::binary(bytes)).await.is_err() {
                    flush(&mut finals);
                    return Ok(SessionEnd::Disconnected);
                }
                last_sent = Instant::now();
            }
            _ = keepalive.tick() => {
                // System audio is silent (no frames) whenever nothing is playing.
                if last_sent.elapsed() > Duration::from_secs(3)
                    && tx.send(WsMessage::text(r#"{"type":"KeepAlive"}"#)).await.is_err()
                {
                    return Ok(SessionEnd::Disconnected);
                }
            }
            msg = rx.next() => {
                let msg = match msg {
                    Some(Ok(m)) => m,
                    Some(Err(e)) => {
                        tracing::warn!("deepgram socket: {e}");
                        flush(&mut finals);
                        return Ok(SessionEnd::Disconnected);
                    }
                    None => {
                        flush(&mut finals);
                        return Ok(SessionEnd::Disconnected);
                    }
                };
                let WsMessage::Text(text) = msg else { continue };
                let Ok(v) = serde_json::from_str::<Value>(text.as_str()) else { continue };
                match v.get("type").and_then(Value::as_str) {
                    Some("Results") => {
                        let transcript = v
                            .pointer("/channel/alternatives/0/transcript")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .trim()
                            .to_owned();
                        let is_final = v.get("is_final").and_then(Value::as_bool).unwrap_or(false);
                        let speech_final = v.get("speech_final").and_then(Value::as_bool).unwrap_or(false);
                        if is_final {
                            if !transcript.is_empty() {
                                finals.push(transcript);
                            }
                            if speech_final {
                                flush(&mut finals);
                            } else if !finals.is_empty() {
                                emit(SttEvent::Interim(finals.join(" ")));
                            }
                        } else if !transcript.is_empty() {
                            let mut so_far = finals.join(" ");
                            if !so_far.is_empty() {
                                so_far.push(' ');
                            }
                            so_far.push_str(&transcript);
                            emit(SttEvent::Interim(so_far));
                        }
                    }
                    Some("UtteranceEnd") => flush(&mut finals),
                    Some("Error") | Some("error") => {
                        let m = v
                            .get("description")
                            .or_else(|| v.get("message"))
                            .and_then(Value::as_str)
                            .unwrap_or("unknown error");
                        return Err(AppError::msg(format!("Deepgram: {m}")));
                    }
                    _ => {}
                }
            }
        }
    }
}

pub async fn deepgram_list_models(client: &LlmClient) -> Result<Vec<String>> {
    // Validates the key and lists streaming-capable model names.
    let resp = client
        .http
        .get(format!("{}/v1/models", client.base()))
        .header("Authorization", format!("Token {}", client.key()))
        .send()
        .await?;
    let v: Value = client.check(resp).await?.json().await?;
    let mut models: Vec<String> = v
        .get("stt")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter(|m| m.get("streaming").and_then(Value::as_bool).unwrap_or(true))
                .filter_map(|m| m.get("canonical_name").and_then(Value::as_str))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    if models.is_empty() {
        models = client.provider.suggested_models.clone();
    }
    Ok(models)
}

// ---------------------------------------------------------------------------------------------
// OpenAI-compatible chunked transcription with local VAD
// ---------------------------------------------------------------------------------------------

/// Energy-based voice activity segmentation over 100 ms frames.
pub struct Segmenter {
    noise_floor: f32,
    speech_frames: usize,
    silence_frames: usize,
    in_speech: bool,
    preroll: Vec<i16>,
    current: Vec<i16>,
}

const PREROLL_FRAMES: usize = 3; // 300 ms kept before speech onset
const START_FRAMES: usize = 2; // 200 ms of speech to open a segment
const END_SILENCE_FRAMES: usize = 7; // 700 ms of silence closes it
const MIN_SPEECH_FRAMES: usize = 4; // ignore blips under 400 ms
const MAX_SEGMENT_SAMPLES: usize = TARGET_RATE * 20;

impl Default for Segmenter {
    fn default() -> Self {
        Self {
            noise_floor: 0.004,
            speech_frames: 0,
            silence_frames: 0,
            in_speech: false,
            preroll: Vec::new(),
            current: Vec::new(),
        }
    }
}

impl Segmenter {
    /// Feed one frame; returns a finished utterance when one closes.
    pub fn push(&mut self, frame: &[i16]) -> Option<Vec<i16>> {
        let rms = (frame
            .iter()
            .map(|&s| (s as f32 / 32768.0).powi(2))
            .sum::<f32>()
            / frame.len().max(1) as f32)
            .sqrt();
        let threshold = (self.noise_floor * 3.0).max(0.008);
        let voiced = rms > threshold;
        if !voiced {
            // Track background noise slowly so the threshold adapts to the room.
            self.noise_floor = self.noise_floor * 0.95 + rms * 0.05;
        }

        if !self.in_speech {
            self.preroll.extend_from_slice(frame);
            let keep = frame.len() * PREROLL_FRAMES;
            if self.preroll.len() > keep {
                let excess = self.preroll.len() - keep;
                self.preroll.drain(..excess);
            }
            self.speech_frames = if voiced { self.speech_frames + 1 } else { 0 };
            if self.speech_frames >= START_FRAMES {
                self.in_speech = true;
                self.silence_frames = 0;
                self.current = std::mem::take(&mut self.preroll);
            }
            return None;
        }

        self.current.extend_from_slice(frame);
        if voiced {
            self.speech_frames += 1;
            self.silence_frames = 0;
        } else {
            self.silence_frames += 1;
        }
        let too_long = self.current.len() >= MAX_SEGMENT_SAMPLES;
        if self.silence_frames >= END_SILENCE_FRAMES || too_long {
            let speech = self.speech_frames;
            self.in_speech = false;
            self.speech_frames = 0;
            self.silence_frames = 0;
            let seg = std::mem::take(&mut self.current);
            return (speech >= MIN_SPEECH_FRAMES).then_some(seg);
        }
        None
    }

    pub fn in_speech(&self) -> bool {
        self.in_speech
    }

    /// Return whatever is in progress (used when capture stops).
    pub fn finish(&mut self) -> Option<Vec<i16>> {
        let seg = std::mem::take(&mut self.current);
        let ok = self.in_speech && self.speech_frames >= MIN_SPEECH_FRAMES;
        self.in_speech = false;
        ok.then_some(seg)
    }
}

pub fn wav_bytes(samples: &[i16]) -> Result<Vec<u8>> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_RATE as u32,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut cursor = Cursor::new(Vec::with_capacity(samples.len() * 2 + 44));
    {
        let mut w =
            hound::WavWriter::new(&mut cursor, spec).map_err(|e| AppError::Audio(e.to_string()))?;
        for &s in samples {
            w.write_sample(s)
                .map_err(|e| AppError::Audio(e.to_string()))?;
        }
        w.finalize().map_err(|e| AppError::Audio(e.to_string()))?;
    }
    Ok(cursor.into_inner())
}

/// Whisper-family models invent these on near-silent audio.
fn is_hallucination(text: &str) -> bool {
    const JUNK: &[&str] = &[
        "thank you.",
        "thank you",
        "thanks for watching!",
        "thanks for watching.",
        "you",
        "bye.",
        ".",
        "subtitles by the amara.org community",
    ];
    let t = text.trim().to_lowercase();
    t.is_empty() || JUNK.contains(&t.as_str())
}

async fn transcribe(cfg: &SttConfig, http: &reqwest::Client, samples: &[i16]) -> Result<String> {
    use reqwest::multipart::{Form, Part};
    let wav = wav_bytes(samples)?;
    let part = Part::bytes(wav)
        .file_name("audio.wav")
        .mime_str("audio/wav")?;
    let mut form = Form::new()
        .part("file", part)
        .text("model", cfg.model.clone())
        .text("response_format", "json");
    let lang = cfg.language.trim();
    if !lang.is_empty() && lang != "multi" {
        form = form.text("language", lang.to_owned());
    }
    let mut rb = http
        .post(format!(
            "{}/audio/transcriptions",
            cfg.provider.base_url.trim_end_matches('/')
        ))
        .multipart(form)
        .timeout(Duration::from_secs(30));
    if let Some(key) = cfg.api_key.as_deref().filter(|k| !k.is_empty()) {
        rb = rb.bearer_auth(key);
    }
    for (k, v) in &cfg.provider.extra_headers {
        rb = rb.header(k.as_str(), v.as_str());
    }
    let resp = rb.send().await?;
    let status = resp.status();
    let body = resp.text().await?;
    if !status.is_success() {
        return Err(provider_error(&cfg.provider.label, status.as_u16(), &body));
    }
    let v: Value = serde_json::from_str(&body)?;
    Ok(v.get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_owned())
}

async fn chunked<F>(
    cfg: SttConfig,
    http: reqwest::Client,
    mut audio: mpsc::Receiver<Vec<i16>>,
    emit: F,
) where
    F: Fn(SttEvent) + Send + Sync + 'static,
{
    let emit = std::sync::Arc::new(emit);
    let cfg = std::sync::Arc::new(cfg);
    emit(SttEvent::Status(SourceState::Live, None));

    // Upload utterances in order on a separate task so capture never waits on the network.
    let (seg_tx, mut seg_rx) = mpsc::channel::<Vec<i16>>(16);
    let uploader = {
        let emit = emit.clone();
        let cfg = cfg.clone();
        tokio::spawn(async move {
            while let Some(seg) = seg_rx.recv().await {
                match transcribe(&cfg, &http, &seg).await {
                    Ok(text) if !is_hallucination(&text) => {
                        emit(SttEvent::Final(text));
                        emit(SttEvent::Status(SourceState::Live, None));
                    }
                    Ok(_) => emit(SttEvent::Interim(String::new())),
                    Err(e) => {
                        tracing::warn!("transcription failed: {e}");
                        emit(SttEvent::Interim(String::new()));
                        emit(SttEvent::Status(SourceState::Error, Some(e.to_string())));
                    }
                }
            }
        })
    };

    let mut seg = Segmenter::default();
    let mut was_speaking = false;
    while let Some(frame) = audio.recv().await {
        if let Some(utterance) = seg.push(&frame) {
            emit(SttEvent::Interim("…".into()));
            let _ = seg_tx.send(utterance).await;
        }
        let speaking = seg.in_speech();
        if speaking && !was_speaking {
            emit(SttEvent::Interim("…".into()));
        }
        was_speaking = speaking;
    }
    if let Some(utterance) = seg.finish() {
        let _ = seg_tx.send(utterance).await;
    }
    drop(seg_tx);
    let _ = uploader.await;
    emit(SttEvent::Status(SourceState::Off, None));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(amplitude: f32) -> Vec<i16> {
        (0..1600)
            .map(|i| ((i as f32 * 0.3).sin() * amplitude * 32767.0) as i16)
            .collect()
    }

    #[test]
    fn segments_speech_between_silence() {
        let mut s = Segmenter::default();
        let mut out = Vec::new();
        for _ in 0..10 {
            out.extend(s.push(&frame(0.001)));
        }
        for _ in 0..12 {
            out.extend(s.push(&frame(0.3)));
        }
        for _ in 0..10 {
            out.extend(s.push(&frame(0.001)));
        }
        assert_eq!(out.len(), 1);
        // preroll + speech + trailing silence until close
        let secs = out[0].len() as f32 / TARGET_RATE as f32;
        assert!(secs > 1.2 && secs < 2.5, "{secs}");
    }

    #[test]
    fn ignores_short_blips() {
        let mut s = Segmenter::default();
        let mut out = Vec::new();
        for _ in 0..5 {
            out.extend(s.push(&frame(0.001)));
        }
        for _ in 0..2 {
            out.extend(s.push(&frame(0.3)));
        }
        for _ in 0..10 {
            out.extend(s.push(&frame(0.001)));
        }
        assert!(out.is_empty());
    }

    #[test]
    fn wav_has_header() {
        let wav = wav_bytes(&[0i16; 160]).unwrap();
        assert_eq!(&wav[..4], b"RIFF");
        assert_eq!(wav.len(), 44 + 320);
    }

    #[test]
    fn deepgram_url_is_wss() {
        let cfg = SttConfig {
            provider: crate::config::preset_providers()
                .into_iter()
                .find(|p| p.id == "deepgram")
                .unwrap(),
            api_key: None,
            model: "nova-3".into(),
            language: "en".into(),
        };
        let url = deepgram_url(&cfg);
        assert!(url.starts_with("wss://api.deepgram.com/v1/listen?model=nova-3"));
        assert!(url.contains("sample_rate=16000"));
        assert!(url.ends_with("&language=en"));
    }
}
