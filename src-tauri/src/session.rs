//! Orchestration: listening (audio → STT → transcript → question detection) and answering
//! (transcript + screen → LLM → streamed answer).

use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;
use tokio::time::Instant;

use crate::audio;
use crate::capture;
use crate::context;
use crate::error::{AppError, Result};
use crate::llm::{ChatRequest, LlmClient, Message, Part, Role};
use crate::prompt::{self, Trigger};
use crate::secrets;
use crate::state::{
    AnswerEvent, EV_ANSWER, EV_LEVELS, EV_TRANSCRIPT, LevelsEvent, LivePipeline, SessionState,
    SourceState, SourceStatus, TranscriptEvent, emit_status, now_ms, state, toast,
};
use crate::storage::{AnswerRecord, ContextDoc, Memory, Segment, Speaker};
use crate::stt::{self, SttConfig, SttEvent};

/// How long the other side must stay quiet after a question before we auto-answer. Deepgram
/// already waits for end of speech before sending a final, so this only catches run-on follow-ups.
const QUESTION_SETTLE: Duration = Duration::from_millis(350);
/// Screen text older than this isn't sent with answers.
const SCREEN_FRESH_MS: i64 = 15_000;

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

/// Make sure the current session has a row (tagged with the active profile, for memory).
pub fn persist_session_start(app: &AppHandle) {
    let st = state(app);
    let (id, started) = {
        let s = st.session.lock();
        (s.id.clone(), s.started_at)
    };
    let profile_id = st
        .settings
        .read()
        .active_profile()
        .map(|p| p.id.clone())
        .unwrap_or_default();
    if let Err(e) = st.db.lock().create_session(&id, started, &profile_id) {
        tracing::error!("create session: {e}");
    }
}

/// Close the current session and start an empty one. The finished one gets summarized
/// into meeting memory in the background.
pub fn new_session(app: &AppHandle) {
    stop_listening(app);
    cancel_answer(app);
    let st = state(app);
    let old_id = {
        let mut s = st.session.lock();
        let old = s.id.clone();
        *s = SessionState::new();
        old
    };
    let _ = st.db.lock().end_session(&old_id, now_ms());
    persist_session_start(app);
    emit_status(app);
    crate::memory::summarize_pending(app);
}

/// Profile knowledge for the next answer: linked documents (refreshed if they changed on
/// disk) and recent meeting notes.
fn load_knowledge(app: &AppHandle, session_id: &str) -> (Vec<ContextDoc>, Vec<Memory>) {
    let st = state(app);
    let settings = st.settings();
    let Some(profile) = settings.active_profile() else {
        return (vec![], vec![]);
    };
    let db = st.db.lock();
    let docs = db
        .docs(&profile.id)
        .map(|d| context::sync(&db, d))
        .unwrap_or_else(|e| {
            tracing::warn!("load docs: {e}");
            vec![]
        });
    let memories = if profile.memory_enabled {
        db.recent_memories(&profile.id, profile.memory_count, session_id)
            .unwrap_or_default()
    } else {
        vec![]
    };
    (docs, memories)
}

// ---------------------------------------------------------------------------------------------
// Listening
// ---------------------------------------------------------------------------------------------

fn set_source_status(
    app: &AppHandle,
    speaker: Speaker,
    state_: SourceState,
    message: Option<String>,
) {
    {
        let st = state(app);
        let mut s = st.session.lock();
        let status = SourceStatus {
            state: state_,
            message,
        };
        match speaker {
            Speaker::Me => s.me = status,
            Speaker::Them => s.them = status,
        }
    }
    emit_status(app);
}

pub fn start_listening(app: &AppHandle) -> Result<()> {
    let st = state(app);
    if st.session.lock().live.is_some() {
        return Ok(());
    }
    let settings = st.settings();
    let provider = settings
        .provider(&settings.stt.provider_id)
        .cloned()
        .ok_or_else(|| AppError::UnknownProvider(settings.stt.provider_id.clone()))?;
    if !provider.kind.supports_stt() {
        return Err(AppError::msg(format!(
            "{} can't do speech-to-text. Pick Deepgram or an OpenAI-compatible provider in Settings → Models.",
            provider.label
        )));
    }
    let api_key = secrets::get(&provider.id)?;
    if provider.needs_key && api_key.is_none() {
        return Err(AppError::MissingKey(provider.id.clone()));
    }
    if settings.stt.model.trim().is_empty() {
        return Err(AppError::msg(
            "Pick a speech-to-text model in Settings → Models.",
        ));
    }
    let b = &settings.behavior;
    if !b.capture_mic && !b.capture_system {
        return Err(AppError::msg(
            "Both microphone and system audio are turned off in Settings.",
        ));
    }

    persist_session_start(app);

    let (ev_tx, ev_rx) = mpsc::unbounded_channel::<(Speaker, SttEvent)>();
    let mut captures = Vec::new();
    let mut tasks = Vec::new();
    let mut levels = Vec::new();
    let mut errors = Vec::new();

    let sources = [
        (Speaker::Me, b.capture_mic, b.mic_device.clone()),
        (Speaker::Them, b.capture_system, b.output_device.clone()),
    ];
    st.mic.latched.store(b.mic_default_on, Ordering::Relaxed);
    st.mic.held.store(false, Ordering::Relaxed);
    for (speaker, enabled, device) in sources {
        if !enabled {
            continue;
        }
        match audio::start(speaker, device.as_deref()) {
            Ok((handle, audio_rx)) => {
                levels.push((speaker, handle.level.clone()));
                captures.push(handle);
                // The mic keeps running so opening it is instant, but its audio only reaches
                // speech-to-text while the gate is open.
                let audio_rx = if speaker == Speaker::Me {
                    let (gated_tx, gated_rx) = mpsc::channel::<Vec<i16>>(64);
                    let gate = st.mic.clone();
                    let mut raw = audio_rx;
                    tasks.push(tauri::async_runtime::spawn(async move {
                        while let Some(frame) = raw.recv().await {
                            if gate.is_open() && gated_tx.send(frame).await.is_err() {
                                break;
                            }
                        }
                    }));
                    gated_rx
                } else {
                    audio_rx
                };
                let cfg = SttConfig {
                    provider: provider.clone(),
                    api_key: api_key.clone(),
                    model: settings.stt.model.clone(),
                    language: settings.stt.language.clone(),
                };
                let http = st.http.clone();
                let tx = ev_tx.clone();
                set_source_status(app, speaker, SourceState::Connecting, None);
                tasks.push(tauri::async_runtime::spawn(async move {
                    stt::run(cfg, http, audio_rx, move |ev| {
                        let _ = tx.send((speaker, ev));
                    })
                    .await;
                }));
            }
            Err(e) => {
                let label = if speaker == Speaker::Me {
                    "Microphone"
                } else {
                    "System audio"
                };
                errors.push(format!("{label}: {e}"));
                set_source_status(app, speaker, SourceState::Error, Some(e.to_string()));
            }
        }
    }
    drop(ev_tx);

    if captures.is_empty() {
        return Err(AppError::Audio(errors.join("; ")));
    }
    for e in &errors {
        toast(app, "warn", e.clone());
    }

    tasks.push(tauri::async_runtime::spawn(consume_transcript(
        app.clone(),
        ev_rx,
    )));
    tasks.push(tauri::async_runtime::spawn(emit_levels(
        app.clone(),
        levels,
    )));
    if b.watch_screen {
        tasks.push(tauri::async_runtime::spawn(crate::screen::watch(app.clone())));
    }
    warm_up_llm(app);

    {
        let mut s = st.session.lock();
        s.live = Some(LivePipeline { captures, tasks });
        s.watching = b.watch_screen;
    }
    emit_status(app);
    Ok(())
}

/// Open the connection to the answering provider now (DNS, TLS, HTTP/2), so the first answer
/// doesn't pay for the handshake. The client pool keeps it alive with pings.
fn warm_up_llm(app: &AppHandle) {
    let st = state(app);
    let settings = st.settings();
    let Some(provider) = settings.provider(&settings.llm.provider_id).cloned() else {
        return;
    };
    let Ok(key) = secrets::get(&provider.id) else {
        return;
    };
    let Ok(client) = LlmClient::new(provider, key, st.http.clone()) else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        if let Err(e) = client.list_models().await {
            tracing::debug!("warm-up: {e}");
        }
    });
}

/// Push-to-talk: the user's voice is transcribed only while the key is held.
pub fn hold_mic(app: &AppHandle, down: bool) {
    let st = state(app);
    let was = st.mic.held.swap(down, Ordering::Relaxed);
    if was == down {
        return; // key repeat
    }
    if !down {
        st.mic
            .tail_until
            .store(now_ms() + crate::state::MicGate::TAIL_MS, Ordering::Relaxed);
    }
    emit_status(app);
}

/// The overlay's mic button: keep the user's mic open until turned off.
pub fn set_mic(app: &AppHandle, on: bool) {
    let st = state(app);
    st.mic.latched.store(on, Ordering::Relaxed);
    if !on {
        st.mic
            .tail_until
            .store(now_ms() + crate::state::MicGate::TAIL_MS, Ordering::Relaxed);
    }
    emit_status(app);
}

pub fn stop_listening(app: &AppHandle) {
    let st = state(app);
    let live = {
        let mut s = st.session.lock();
        s.me = SourceStatus::off();
        s.them = SourceStatus::off();
        s.watching = false;
        s.screen = None;
        s.live.take()
    };
    if let Some(live) = live {
        live.stop();
    }
    let _ = app.emit(EV_LEVELS, LevelsEvent { me: 0.0, them: 0.0 });
    emit_status(app);
}

pub fn toggle_listening(app: &AppHandle) -> Result<bool> {
    if state(app).session.lock().live.is_some() {
        stop_listening(app);
        Ok(false)
    } else {
        start_listening(app)?;
        Ok(true)
    }
}

async fn emit_levels(app: AppHandle, levels: Vec<(Speaker, Arc<std::sync::atomic::AtomicU32>)>) {
    let mut tick = tokio::time::interval(Duration::from_millis(80));
    loop {
        tick.tick().await;
        let mut ev = LevelsEvent { me: 0.0, them: 0.0 };
        for (speaker, level) in &levels {
            let v = f32::from_bits(level.load(Ordering::Relaxed));
            match speaker {
                Speaker::Me => ev.me = v,
                Speaker::Them => ev.them = v,
            }
        }
        let _ = app.emit(EV_LEVELS, ev);
    }
}

/// Receives STT events from both sources: updates the transcript, persists finals, and
/// schedules an automatic answer when the other side finishes asking a question.
async fn consume_transcript(app: AppHandle, mut rx: mpsc::UnboundedReceiver<(Speaker, SttEvent)>) {
    // (accumulated question text, fire at)
    let mut pending: Option<(String, Instant)> = None;

    loop {
        let deadline = pending.as_ref().map(|(_, at)| *at);
        let next = tokio::select! {
            ev = rx.recv() => match ev {
                Some(ev) => Some(ev),
                None => break,
            },
            _ = async {
                match deadline {
                    Some(at) => tokio::time::sleep_until(at).await,
                    None => std::future::pending::<()>().await,
                }
            } => None,
        };

        let Some((speaker, ev)) = next else {
            // Settle timer fired.
            if let Some((question, _)) = pending.take() {
                let auto = state(&app).settings.read().behavior.auto_answer;
                if auto && let Err(e) = ask(&app, Trigger::Detected(question), false, true).await {
                    tracing::warn!("auto answer failed: {e}");
                }
            }
            continue;
        };

        match ev {
            SttEvent::Status(s, msg) => set_source_status(&app, speaker, s, msg),
            SttEvent::Interim(text) => {
                // They're still talking: hold the auto-answer.
                if speaker == Speaker::Them
                    && let Some((_, at)) = pending.as_mut()
                {
                    *at = Instant::now() + QUESTION_SETTLE;
                }
                let _ = app.emit(
                    EV_TRANSCRIPT,
                    TranscriptEvent {
                        speaker,
                        text,
                        is_final: false,
                        id: None,
                        ts: now_ms(),
                    },
                );
            }
            SttEvent::Final(text) => {
                let text = text.trim().to_owned();
                if text.is_empty() {
                    continue;
                }
                let ts = now_ms();
                let st = state(&app);
                let session_id = st.session.lock().id.clone();
                let id = st
                    .db
                    .lock()
                    .add_segment(&session_id, speaker, &text, ts)
                    .unwrap_or_else(|e| {
                        tracing::error!("save segment: {e}");
                        -ts
                    });
                st.session.lock().segments.push(Segment {
                    id,
                    speaker,
                    text: text.clone(),
                    ts,
                });
                let _ = app.emit(
                    EV_TRANSCRIPT,
                    TranscriptEvent {
                        speaker,
                        text: text.clone(),
                        is_final: true,
                        id: Some(id),
                        ts,
                    },
                );

                if speaker == Speaker::Them {
                    match pending.as_mut() {
                        // Follow-on sentence of the same question: merge it in.
                        Some((q, at)) => {
                            q.push(' ');
                            q.push_str(&text);
                            *at = Instant::now() + QUESTION_SETTLE;
                        }
                        None if prompt::looks_like_question(&text) => {
                            pending = Some((text, Instant::now() + QUESTION_SETTLE));
                        }
                        None => {}
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------------------------

pub fn cancel_answer(app: &AppHandle) {
    let st = state(app);
    let running = st.session.lock().answering.take();
    if let Some((id, task)) = running {
        task.abort();
        let _ = app.emit(EV_ANSWER, AnswerEvent::Cancelled { id });
        emit_status(app);
    }
}

async fn screenshot_for(app: &AppHandle) -> Result<Part> {
    let hide_overlay = !state(app).settings.read().behavior.hide_from_capture;
    let overlay = app.get_webview_window("overlay");
    // Point inside the monitor the overlay is on, so we capture the screen the user is using.
    let point = overlay.as_ref().and_then(|w| {
        let pos = w.outer_position().ok()?;
        let size = w.outer_size().ok()?;
        Some((
            pos.x + size.width as i32 / 2,
            pos.y + size.height as i32 / 2,
        ))
    });

    // If the overlay isn't excluded from capture, hide it so it isn't in the shot.
    let was_visible = overlay
        .as_ref()
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if hide_overlay && was_visible {
        if let Some(w) = &overlay {
            let _ = w.hide();
        }
        tokio::time::sleep(Duration::from_millis(160)).await;
    }
    let shot = tokio::task::spawn_blocking(move || capture::screenshot(point))
        .await
        .map_err(|e| AppError::Capture(e.to_string()))?;
    if hide_overlay
        && was_visible
        && let Some(w) = &overlay
    {
        let _ = w.show();
    }
    let (mime, data_b64) = shot?;
    Ok(Part::Image { mime, data_b64 })
}

/// Start streaming an answer. Returns the answer id immediately; output arrives as events.
pub async fn ask(
    app: &AppHandle,
    trigger: Trigger,
    with_screen: bool,
    auto: bool,
) -> Result<String> {
    let st = state(app);
    let settings = st.settings();
    let answer_id = uuid::Uuid::new_v4().to_string();
    let created_at = now_ms();
    let question = trigger.label();

    // Resolve provider + key first so config problems surface immediately.
    let client = (|| -> Result<LlmClient> {
        let provider = settings
            .provider(&settings.llm.provider_id)
            .cloned()
            .ok_or_else(|| AppError::UnknownProvider(settings.llm.provider_id.clone()))?;
        if settings.llm.model.trim().is_empty() {
            return Err(AppError::msg("Pick a model in Settings → Models."));
        }
        let key = secrets::get(&provider.id)?;
        LlmClient::new(provider, key, st.http.clone())
    })();

    cancel_answer(app);
    persist_session_start(app);

    let model_label = format!("{} · {}", settings.llm.provider_id, settings.llm.model);
    let _ = app.emit(
        EV_ANSWER,
        AnswerEvent::Start {
            id: answer_id.clone(),
            question: question.clone(),
            model: model_label.clone(),
            with_screen,
            auto,
            source: trigger.source(),
            created_at,
        },
    );
    let client = match client {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit(
                EV_ANSWER,
                AnswerEvent::Error {
                    id: answer_id,
                    message: e.to_string(),
                },
            );
            return Err(e);
        }
    };

    let app2 = app.clone();
    let id2 = answer_id.clone();
    let task = tauri::async_runtime::spawn(async move {
        let app = app2;
        let id = id2;
        let result: Result<String> = async {
            let mut parts = Vec::new();
            if with_screen {
                match screenshot_for(&app).await {
                    Ok(img) => parts.push(img),
                    Err(e) => toast(&app, "warn", format!("Screenshot skipped: {e}")),
                }
            }
            let (segments, previous, session_id, notes, screen_text) = {
                let st = state(&app);
                let s = st.session.lock();
                let screen = s
                    .screen
                    .as_ref()
                    .filter(|t| s.watching && now_ms() - t.at <= SCREEN_FRESH_MS)
                    .map(|t| t.text.clone());
                (s.segments.clone(), s.answers.clone(), s.id.clone(), s.notes.clone(), screen)
            };
            // File reads / PDF re-extraction stay off the async runtime.
            let (docs, memories) = {
                let app = app.clone();
                tauri::async_runtime::spawn_blocking(move || load_knowledge(&app, &session_id))
                    .await
                    .unwrap_or_default()
            };
            let system = prompt::system_prompt(&prompt::Knowledge {
                profile: settings.active_profile(),
                docs: &docs,
                memories: &memories,
            });
            let text = prompt::user_turn(
                &segments,
                settings.behavior.transcript_window_secs as i64 * 1000,
                now_ms(),
                &previous,
                &trigger,
                &prompt::Live {
                    notes: &notes,
                    screen_text: screen_text.as_deref(),
                    has_screenshot: !parts.is_empty(),
                },
            );
            parts.push(Part::Text(text));
            let req = ChatRequest {
                model: settings.llm.model.clone(),
                system,
                messages: vec![Message {
                    role: Role::User,
                    parts,
                }],
                max_tokens: settings.behavior.max_output_tokens,
                effort: settings.behavior.anthropic_effort.clone(),
            };

            let mut stream = client.stream(req).await?;
            let mut full = String::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk?;
                full.push_str(&chunk);
                let _ = app.emit(
                    EV_ANSWER,
                    AnswerEvent::Delta {
                        id: id.clone(),
                        text: chunk,
                    },
                );
            }
            Ok(full)
        }
        .await;

        let st = state(&app);
        match result {
            Ok(full) => {
                let record = AnswerRecord {
                    id: id.clone(),
                    question: question.clone(),
                    answer: full,
                    model: model_label,
                    with_screen,
                    created_at,
                };
                let session_id = {
                    let mut s = st.session.lock();
                    s.answers.push(record.clone());
                    s.id.clone()
                };
                {
                    let db = st.db.lock();
                    if let Err(e) = db.add_answer(&session_id, &record) {
                        tracing::error!("save answer: {e}");
                    }
                    let title: String = question.chars().take(80).collect();
                    let _ = db.set_title_if_empty(&session_id, &title);
                }
                let _ = app.emit(EV_ANSWER, AnswerEvent::Done { id: id.clone() });
            }
            Err(e) => {
                let _ = app.emit(
                    EV_ANSWER,
                    AnswerEvent::Error {
                        id: id.clone(),
                        message: e.to_string(),
                    },
                );
            }
        }
        {
            let mut s = st.session.lock();
            if s.answering.as_ref().is_some_and(|(a, _)| *a == id) {
                s.answering = None;
            }
        }
        emit_status(&app);
    });

    st.session.lock().answering = Some((answer_id.clone(), task));
    emit_status(app);
    Ok(answer_id)
}
