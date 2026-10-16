//! Shared application state and the event payloads sent to the webview.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::audio::CaptureHandle;
use crate::config::Settings;
use crate::storage::{AnswerRecord, Db, Segment, Speaker};

pub const EV_TRANSCRIPT: &str = "fluke://transcript";
pub const EV_ANSWER: &str = "fluke://answer";
pub const EV_STATUS: &str = "fluke://status";
pub const EV_LEVELS: &str = "fluke://levels";
pub const EV_SETTINGS: &str = "fluke://settings";
pub const EV_ACTION: &str = "fluke://action";
pub const EV_TOAST: &str = "fluke://toast";
/// A stored session changed (e.g. its summary was written); payload is the session id.
pub const EV_HISTORY: &str = "fluke://history";

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SourceState {
    Off,
    Connecting,
    Live,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceStatus {
    pub state: SourceState,
    pub message: Option<String>,
}

impl SourceStatus {
    pub fn off() -> Self {
        Self {
            state: SourceState::Off,
            message: None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct StatusEvent {
    pub listening: bool,
    pub me: SourceStatus,
    pub them: SourceStatus,
    pub click_through: bool,
    pub session_id: String,
    pub answering: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptEvent {
    pub speaker: Speaker,
    pub text: String,
    #[serde(rename = "final")]
    pub is_final: bool,
    pub id: Option<i64>,
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AnswerEvent {
    Start {
        id: String,
        question: String,
        model: String,
        with_screen: bool,
        auto: bool,
        created_at: i64,
    },
    Delta {
        id: String,
        text: String,
    },
    Done {
        id: String,
    },
    Error {
        id: String,
        message: String,
    },
    Cancelled {
        id: String,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct LevelsEvent {
    pub me: f32,
    pub them: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ToastEvent {
    pub level: &'static str,
    pub message: String,
}

/// Everything that belongs to one listening/asking session.
pub struct SessionState {
    pub id: String,
    pub started_at: i64,
    pub segments: Vec<Segment>,
    pub answers: Vec<AnswerRecord>,
    pub me: SourceStatus,
    pub them: SourceStatus,
    /// Running capture + STT pipeline, if listening.
    pub live: Option<LivePipeline>,
    /// Answer currently streaming: (answer id, task).
    pub answering: Option<(String, tauri::async_runtime::JoinHandle<()>)>,
}

impl SessionState {
    pub fn new() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            started_at: now_ms(),
            segments: Vec::new(),
            answers: Vec::new(),
            me: SourceStatus::off(),
            them: SourceStatus::off(),
            live: None,
            answering: None,
        }
    }
}

pub struct LivePipeline {
    /// Dropping these stops the audio threads.
    pub captures: Vec<CaptureHandle>,
    pub tasks: Vec<tauri::async_runtime::JoinHandle<()>>,
}

impl LivePipeline {
    pub fn stop(self) {
        drop(self.captures);
        for t in self.tasks {
            t.abort();
        }
    }
}

pub struct AppState {
    pub settings: RwLock<Settings>,
    pub settings_path: PathBuf,
    pub db: Mutex<Db>,
    pub http: reqwest::Client,
    pub session: Mutex<SessionState>,
    pub click_through: AtomicBool,
}

impl AppState {
    pub fn settings(&self) -> Settings {
        self.settings.read().clone()
    }
}

pub fn state(app: &AppHandle) -> tauri::State<'_, AppState> {
    app.state::<AppState>()
}

pub fn status_of(app: &AppHandle) -> StatusEvent {
    let st = state(app);
    let s = st.session.lock();
    StatusEvent {
        listening: s.live.is_some(),
        me: s.me.clone(),
        them: s.them.clone(),
        click_through: st.click_through.load(std::sync::atomic::Ordering::Relaxed),
        session_id: s.id.clone(),
        answering: s.answering.is_some(),
    }
}

pub fn emit_status(app: &AppHandle) {
    let _ = app.emit(EV_STATUS, status_of(app));
}

pub fn toast(app: &AppHandle, level: &'static str, message: impl Into<String>) {
    let _ = app.emit(
        EV_TOAST,
        ToastEvent {
            level,
            message: message.into(),
        },
    );
}
