//! Audio capture: microphone ("Me") and system output loopback ("Them").
//!
//! Each source runs on its own thread: cpal delivers interleaved samples, we downmix to mono,
//! resample to 16 kHz, convert to i16 and hand 100 ms frames to the STT task.
//! System audio uses loopback by opening an *output* device as an input stream
//! (WASAPI on Windows, a CoreAudio process tap on macOS 14.6+).

use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc as std_mpsc;
use std::thread;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SizedSample, StreamConfig};
use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler};
use serde::Serialize;
use tokio::sync::mpsc;

use crate::error::{AppError, Result};
use crate::storage::Speaker;

pub const TARGET_RATE: usize = 16_000;
/// 100 ms of 16 kHz audio per frame sent to STT.
const FRAME_SAMPLES: usize = TARGET_RATE / 10;

pub struct CaptureHandle {
    stop: Option<std_mpsc::Sender<()>>,
    thread: Option<thread::JoinHandle<()>>,
    /// Smoothed input level 0..1 (f32 bits), for the UI meter.
    pub level: Arc<AtomicU32>,
}

impl Drop for CaptureHandle {
    fn drop(&mut self) {
        drop(self.stop.take());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceList {
    pub inputs: Vec<String>,
    pub outputs: Vec<String>,
}

fn device_name(d: &cpal::Device) -> String {
    d.description()
        .map(|desc| desc.name().to_owned())
        .unwrap_or_else(|_| d.to_string())
}

pub fn list_devices() -> DeviceList {
    let host = cpal::default_host();
    let names = |it: std::result::Result<_, cpal::Error>| -> Vec<String> {
        match it {
            Ok(devs) => {
                let devs: Vec<cpal::Device> = devs;
                devs.iter().map(device_name).collect()
            }
            Err(_) => Vec::new(),
        }
    };
    DeviceList {
        inputs: names(host.input_devices().map(|d| d.collect())),
        outputs: names(host.output_devices().map(|d| d.collect())),
    }
}

fn pick_device(source: Speaker, wanted: Option<&str>) -> Result<cpal::Device> {
    let host = cpal::default_host();
    if let Some(name) = wanted.filter(|n| !n.is_empty()) {
        let found = match source {
            Speaker::Me => host
                .input_devices()
                .ok()
                .and_then(|mut it| it.find(|d| device_name(d) == name)),
            Speaker::Them => host
                .output_devices()
                .ok()
                .and_then(|mut it| it.find(|d| device_name(d) == name)),
        };
        match found {
            Some(d) => return Ok(d),
            None => tracing::warn!("audio device '{name}' not found, using the default"),
        }
    }
    match source {
        Speaker::Me => host.default_input_device(),
        Speaker::Them => host.default_output_device(),
    }
    .ok_or_else(|| {
        AppError::Audio(match source {
            Speaker::Me => "no microphone found".into(),
            Speaker::Them => "no audio output device found".into(),
        })
    })
}

/// Start capturing one source. Returns once the stream is running (or failed to start).
pub fn start(
    source: Speaker,
    device: Option<&str>,
) -> Result<(CaptureHandle, mpsc::Receiver<Vec<i16>>)> {
    let device = device.map(str::to_owned);
    let (out_tx, out_rx) = mpsc::channel::<Vec<i16>>(64);
    let (stop_tx, stop_rx) = std_mpsc::channel::<()>();
    let (ready_tx, ready_rx) = std_mpsc::sync_channel::<Result<()>>(1);
    let level = Arc::new(AtomicU32::new(0f32.to_bits()));
    let level2 = level.clone();

    let thread = thread::Builder::new()
        .name(format!("fluke-audio-{}", source.as_str()))
        .spawn(move || {
            if let Err(e) = run_capture(
                source,
                device.as_deref(),
                out_tx,
                stop_rx,
                level2,
                &ready_tx,
            ) {
                let _ = ready_tx.try_send(Err(e));
            }
        })
        .map_err(|e| AppError::Audio(e.to_string()))?;

    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => Ok((
            CaptureHandle {
                stop: Some(stop_tx),
                thread: Some(thread),
                level,
            },
            out_rx,
        )),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(AppError::Audio("audio device did not start in time".into())),
    }
}

fn run_capture(
    source: Speaker,
    device: Option<&str>,
    out_tx: mpsc::Sender<Vec<i16>>,
    stop_rx: std_mpsc::Receiver<()>,
    level: Arc<AtomicU32>,
    ready_tx: &std_mpsc::SyncSender<Result<()>>,
) -> Result<()> {
    let dev = pick_device(source, device)?;
    let supported = match source {
        Speaker::Me => dev.default_input_config(),
        // Loopback: the output device's own mix format.
        Speaker::Them => dev.default_output_config(),
    }
    .map_err(|e| AppError::Audio(format!("{}: {e}", device_name(&dev))))?;

    let config: StreamConfig = supported.config();
    let channels = config.channels as usize;
    let in_rate = config.sample_rate as usize;
    let (raw_tx, raw_rx) = std_mpsc::channel::<Vec<f32>>();

    let stream = match supported.sample_format() {
        SampleFormat::F32 => build::<f32>(&dev, config, channels, raw_tx),
        SampleFormat::I16 => build::<i16>(&dev, config, channels, raw_tx),
        SampleFormat::I32 => build::<i32>(&dev, config, channels, raw_tx),
        SampleFormat::U16 => build::<u16>(&dev, config, channels, raw_tx),
        SampleFormat::F64 => build::<f64>(&dev, config, channels, raw_tx),
        other => Err(AppError::Audio(format!(
            "unsupported sample format {other:?}"
        ))),
    }?;
    stream
        .play()
        .map_err(|e| AppError::Audio(format!("could not start {}: {e}", device_name(&dev))))?;
    tracing::info!(
        "capturing {} from '{}' ({} Hz, {} ch)",
        source.as_str(),
        device_name(&dev),
        in_rate,
        channels
    );
    let _ = ready_tx.try_send(Ok(()));

    let mut pipeline = Pipeline::new(in_rate)?;
    let mut smoothed = 0f32;
    // Runs until stop is requested or the handle is dropped.
    while let Err(std_mpsc::TryRecvError::Empty) = stop_rx.try_recv() {
        match raw_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(mono) => {
                for (frame, rms) in pipeline.push(&mono)? {
                    let db = 20.0 * rms.max(1e-6).log10();
                    let lvl = ((db + 60.0) / 60.0).clamp(0.0, 1.0);
                    smoothed = lvl.max(smoothed * 0.8);
                    level.store(smoothed.to_bits(), Ordering::Relaxed);
                    // Drop audio rather than block if STT falls behind.
                    if out_tx.try_send(frame).is_err() && out_tx.is_closed() {
                        return Ok(());
                    }
                }
            }
            Err(std_mpsc::RecvTimeoutError::Timeout) => {
                // Loopback delivers nothing while the system is silent; let the meter decay.
                smoothed *= 0.5;
                level.store(smoothed.to_bits(), Ordering::Relaxed);
            }
            Err(std_mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    drop(stream);
    level.store(0f32.to_bits(), Ordering::Relaxed);
    Ok(())
}

fn build<T>(
    dev: &cpal::Device,
    config: StreamConfig,
    channels: usize,
    raw_tx: std_mpsc::Sender<Vec<f32>>,
) -> Result<cpal::Stream>
where
    T: SizedSample + Send + 'static,
    f32: cpal::FromSample<T>,
{
    let name = device_name(dev);
    dev.build_input_stream::<T, _, _>(
        config,
        move |data: &[T], _: &cpal::InputCallbackInfo| {
            // Downmix interleaved frames to mono.
            let mono: Vec<f32> = data
                .chunks_exact(channels.max(1))
                .map(|frame| {
                    frame.iter().map(|s| s.to_sample::<f32>()).sum::<f32>() / channels.max(1) as f32
                })
                .collect();
            let _ = raw_tx.send(mono);
        },
        move |err| tracing::warn!("audio stream error on '{name}': {err}"),
        None,
    )
    .map_err(|e| AppError::Audio(format!("could not open {}: {e}", device_name(dev))))
}

/// Mono f32 at the device rate → 100 ms i16 frames at 16 kHz.
struct Pipeline {
    resampler: Option<Fft<f32>>,
    chunk_in: usize,
    pending_in: Vec<f32>,
    resampled: Vec<f32>,
    out_scratch: Vec<f32>,
}

impl Pipeline {
    fn new(in_rate: usize) -> Result<Self> {
        if in_rate == TARGET_RATE {
            return Ok(Self {
                resampler: None,
                chunk_in: 0,
                pending_in: Vec::new(),
                resampled: Vec::new(),
                out_scratch: Vec::new(),
            });
        }
        let chunk_in = in_rate / 50; // 20 ms
        let rs = Fft::<f32>::new(in_rate, TARGET_RATE, chunk_in, 1, FixedSync::Input)
            .map_err(|e| AppError::Audio(format!("resampler: {e}")))?;
        let out_scratch = vec![0.0; rs.output_frames_max()];
        Ok(Self {
            resampler: Some(rs),
            chunk_in,
            pending_in: Vec::with_capacity(chunk_in * 4),
            resampled: Vec::with_capacity(FRAME_SAMPLES * 2),
            out_scratch,
        })
    }

    /// Returns completed frames with their RMS (0..1 full scale).
    fn push(&mut self, mono: &[f32]) -> Result<Vec<(Vec<i16>, f32)>> {
        match self.resampler.as_mut() {
            None => self.resampled.extend_from_slice(mono),
            Some(rs) => {
                self.pending_in.extend_from_slice(mono);
                while self.pending_in.len() >= self.chunk_in {
                    let n = rs.input_frames_next();
                    let input = InterleavedSlice::new(&self.pending_in[..n], 1, n)
                        .map_err(|e| AppError::Audio(e.to_string()))?;
                    let cap = self.out_scratch.len();
                    let mut output = InterleavedSlice::new_mut(&mut self.out_scratch, 1, cap)
                        .map_err(|e| AppError::Audio(e.to_string()))?;
                    let (used, written) = rs
                        .process_into_buffer(&input, &mut output, None)
                        .map_err(|e| AppError::Audio(e.to_string()))?;
                    self.resampled
                        .extend_from_slice(&self.out_scratch[..written]);
                    self.pending_in.drain(..used);
                }
            }
        }

        let mut frames = Vec::new();
        while self.resampled.len() >= FRAME_SAMPLES {
            let chunk: Vec<f32> = self.resampled.drain(..FRAME_SAMPLES).collect();
            let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt();
            let pcm = chunk
                .iter()
                .map(|s| (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)
                .collect();
            frames.push((pcm, rms));
        }
        Ok(frames)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resamples_48k_to_16k_frames() {
        let mut p = Pipeline::new(48_000).unwrap();
        // 1 second of a 440 Hz tone at 48 kHz.
        let tone: Vec<f32> = (0..48_000)
            .map(|i| (i as f32 * 440.0 * std::f32::consts::TAU / 48_000.0).sin() * 0.5)
            .collect();
        let mut frames = Vec::new();
        for chunk in tone.chunks(480) {
            frames.extend(p.push(chunk).unwrap());
        }
        // ~1 s at 16 kHz in 100 ms frames (resampler delay eats a little).
        assert!(
            frames.len() >= 9 && frames.len() <= 10,
            "got {}",
            frames.len()
        );
        assert!(frames.iter().all(|(f, _)| f.len() == FRAME_SAMPLES));
        let (_, rms) = frames.last().unwrap();
        assert!((rms - 0.3535).abs() < 0.05, "rms {rms}");
    }

    #[test]
    fn passthrough_at_16k() {
        let mut p = Pipeline::new(16_000).unwrap();
        let frames = p.push(&vec![0.0; 3_200]).unwrap();
        assert_eq!(frames.len(), 2);
    }
}
