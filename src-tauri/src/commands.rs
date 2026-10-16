//! IPC commands exposed to the webview. Keep these thin; logic lives in the modules.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::audio::{self, DeviceList};
use crate::config::{ProviderConfig, Settings};
use crate::error::{AppError, Result};
use crate::llm::LlmClient;
use crate::prompt::Trigger;
use crate::secrets;
use crate::session;
use crate::state::{self, AppState, EV_SETTINGS, StatusEvent, status_of};
use crate::storage::{self, AnswerRecord, ContextDoc, Segment, SessionDetail, SessionSummary};
use crate::{context, hotkeys, memory, window};

#[derive(Serialize)]
pub struct Snapshot {
    pub status: StatusEvent,
    pub started_at: i64,
    pub segments: Vec<Segment>,
    pub answers: Vec<AnswerRecord>,
    pub notes: String,
}

#[derive(Serialize)]
pub struct AddDocsResult {
    pub added: Vec<ContextDoc>,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
pub struct KeyInfo {
    pub provider_id: String,
    pub has_key: bool,
    pub hint: Option<String>,
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings()
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Settings> {
    let settings = settings.sanitized();
    settings.save(&state.settings_path)?;
    *state.settings.write() = settings.clone();

    let profile_ids: Vec<String> = settings.profiles.iter().map(|p| p.id.clone()).collect();
    if let Err(e) = state.db.lock().prune_docs(&profile_ids) {
        tracing::warn!("prune context docs: {e}");
    }

    let problems = hotkeys::register(&app, &settings.hotkeys);
    window::apply_capture_protection(&app);
    let _ = app.emit(EV_SETTINGS, &settings);
    if !problems.is_empty() {
        return Err(AppError::msg(format!(
            "Saved, but some hotkeys couldn't be registered: {}",
            problems.join("; ")
        )));
    }
    Ok(settings)
}

/// End of the first-run setup: remember it, close the setup window and bring up the overlay.
#[tauri::command]
pub fn finish_onboarding(app: AppHandle, state: State<'_, AppState>) -> Result<()> {
    let settings = {
        let mut s = state.settings.write();
        s.onboarded = true;
        s.clone()
    };
    settings.save(&state.settings_path)?;
    let _ = app.emit(EV_SETTINGS, &settings);
    window::show_overlay(&app);
    let _ = app.emit_to(window::OVERLAY, state::EV_ACTION, "welcome");
    if let Some(w) = app.get_webview_window(window::SETTINGS) {
        let _ = w.close();
    }
    Ok(())
}

#[tauri::command]
pub fn key_status(state: State<'_, AppState>) -> Vec<KeyInfo> {
    state
        .settings
        .read()
        .providers
        .iter()
        .map(|p| {
            let hint = secrets::hint(&p.id);
            KeyInfo {
                provider_id: p.id.clone(),
                has_key: hint.is_some(),
                hint,
            }
        })
        .collect()
}

#[tauri::command]
pub fn set_api_key(app: AppHandle, provider_id: String, key: String) -> Result<()> {
    secrets::set(&provider_id, &key)?;
    let _ = app.emit(EV_SETTINGS, app.state::<AppState>().settings());
    Ok(())
}

#[tauri::command]
pub fn delete_api_key(app: AppHandle, provider_id: String) -> Result<()> {
    secrets::delete(&provider_id)?;
    let _ = app.emit(EV_SETTINGS, app.state::<AppState>().settings());
    Ok(())
}

/// Lists models for a provider config (possibly unsaved), using its stored key.
/// Doubles as the "Test connection" button.
#[tauri::command]
pub async fn list_models(
    state: State<'_, AppState>,
    provider: ProviderConfig,
) -> Result<Vec<String>> {
    let key = secrets::get(&provider.id)?;
    let client = LlmClient::new(provider, key, state.http.clone())?;
    client.list_models().await
}

#[tauri::command]
pub async fn list_audio_devices() -> Result<DeviceList> {
    tauri::async_runtime::spawn_blocking(audio::list_devices)
        .await
        .map_err(|e| AppError::Audio(e.to_string()))
}

#[tauri::command]
pub fn start_listening(app: AppHandle) -> Result<StatusEvent> {
    session::start_listening(&app)?;
    Ok(status_of(&app))
}

#[tauri::command]
pub fn stop_listening(app: AppHandle) -> StatusEvent {
    session::stop_listening(&app);
    status_of(&app)
}

#[tauri::command]
pub async fn ask(
    app: AppHandle,
    prompt: Option<String>,
    with_screen: Option<bool>,
) -> Result<String> {
    let screen_default = app
        .state::<AppState>()
        .settings
        .read()
        .behavior
        .screen_on_ask;
    let trigger = match prompt
        .map(|p| p.trim().to_owned())
        .filter(|p| !p.is_empty())
    {
        Some(p) => Trigger::Typed(p),
        None => Trigger::Assist,
    };
    session::ask(&app, trigger, with_screen.unwrap_or(screen_default), false).await
}

#[tauri::command]
pub fn cancel_answer(app: AppHandle) {
    session::cancel_answer(&app);
}

#[tauri::command]
pub fn new_session(app: AppHandle) -> StatusEvent {
    session::new_session(&app);
    status_of(&app)
}

#[tauri::command]
pub fn get_snapshot(app: AppHandle) -> Snapshot {
    let status = status_of(&app);
    let st = app.state::<AppState>();
    let s = st.session.lock();
    Snapshot {
        status,
        started_at: s.started_at,
        segments: s.segments.clone(),
        answers: s.answers.clone(),
        notes: s.notes.clone(),
    }
}

/// Quick notes for the current meeting, typed into the overlay. Sent with every answer.
#[tauri::command]
pub fn set_session_notes(app: AppHandle, notes: String) -> Result<()> {
    let st = app.state::<AppState>();
    let id = {
        let mut s = st.session.lock();
        s.notes = notes.clone();
        s.id.clone()
    };
    session::persist_session_start(&app);
    st.db.lock().set_notes(&id, &notes)
}

/// The overlay's mic button.
#[tauri::command]
pub fn set_mic(app: AppHandle, on: bool) {
    session::set_mic(&app, on);
}

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionSummary>> {
    state.db.lock().list_sessions()
}

#[tauri::command]
pub fn get_session(state: State<'_, AppState>, id: String) -> Result<Option<SessionDetail>> {
    state.db.lock().get_session(&id)
}

#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, id: String) -> Result<()> {
    state.db.lock().delete_session(&id)
}

#[tauri::command]
pub fn delete_all_sessions(state: State<'_, AppState>) -> Result<()> {
    state.db.lock().delete_all()
}

#[tauri::command]
pub fn session_markdown(state: State<'_, AppState>, id: String) -> Result<String> {
    let detail = state
        .db
        .lock()
        .get_session(&id)?
        .ok_or_else(|| AppError::msg("session not found"))?;
    Ok(storage::session_markdown(&detail))
}

/// Writes the session to Documents/Fluke/<date> <title>.md and returns the path.
#[tauri::command]
pub fn export_session(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<String> {
    let detail = state
        .db
        .lock()
        .get_session(&id)?
        .ok_or_else(|| AppError::msg("session not found"))?;
    let dir = app
        .path()
        .document_dir()
        .map_err(|e| AppError::msg(e.to_string()))?
        .join("Fluke");
    std::fs::create_dir_all(&dir)?;
    let date = chrono::DateTime::from_timestamp_millis(detail.session.started_at)
        .map(|d| {
            d.with_timezone(&chrono::Local)
                .format("%Y-%m-%d %H%M")
                .to_string()
        })
        .unwrap_or_default();
    let title: String = detail
        .session
        .title
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '-')
        .take(60)
        .collect();
    let name = format!(
        "{date} {}.md",
        if title.trim().is_empty() {
            "session"
        } else {
            title.trim()
        }
    );
    let path = dir.join(name);
    std::fs::write(&path, storage::session_markdown(&detail))?;
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn open_settings(app: AppHandle, section: Option<String>) -> Result<()> {
    window::open_settings(&app, section)
}

#[tauri::command]
pub fn hide_overlay(app: AppHandle) {
    window::hide_overlay(&app);
}

#[tauri::command]
pub fn set_click_through(app: AppHandle, on: bool) {
    window::set_click_through(&app, on);
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

// --- context documents & meeting memory ------------------------------------------------------

#[tauri::command]
pub fn list_context_docs(
    state: State<'_, AppState>,
    profile_id: String,
) -> Result<Vec<ContextDoc>> {
    state.db.lock().docs(&profile_id)
}

/// Extract text from the picked files and attach them to a profile.
#[tauri::command]
pub async fn add_context_files(
    app: AppHandle,
    profile_id: String,
    paths: Vec<String>,
) -> Result<AddDocsResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<AppState>();
        let mut result = AddDocsResult {
            added: vec![],
            errors: vec![],
        };
        for p in paths {
            let path = std::path::PathBuf::from(&p);
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| p.clone());
            match context::extract(&path) {
                Ok(text) => {
                    match st
                        .db
                        .lock()
                        .add_doc(&profile_id, &name, &p, &text, state::now_ms())
                    {
                        Ok(doc) => result.added.push(doc),
                        Err(e) => result.errors.push(format!("{name}: {e}")),
                    }
                }
                Err(e) => result.errors.push(e.to_string()),
            }
        }
        result
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))
}

#[tauri::command]
pub fn remove_context_doc(state: State<'_, AppState>, id: i64) -> Result<()> {
    state.db.lock().remove_doc(id)
}

/// Re-read a linked file now (it also refreshes automatically when it changes on disk).
#[tauri::command]
pub async fn reload_context_doc(app: AppHandle, id: i64) -> Result<ContextDoc> {
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<AppState>();
        let doc = st
            .db
            .lock()
            .doc(id)?
            .ok_or_else(|| AppError::msg("document not found"))?;
        let text = context::extract(std::path::Path::new(&doc.path))?;
        st.db.lock().update_doc_text(id, &text, state::now_ms())?;
        st.db
            .lock()
            .doc(id)?
            .ok_or_else(|| AppError::msg("document not found"))
    })
    .await
    .map_err(|e| AppError::msg(e.to_string()))?
}

#[tauri::command]
pub fn context_file_types() -> &'static str {
    context::SUPPORTED
}

/// Write (or rewrite) the meeting notes for a session with the current model.
#[tauri::command]
pub async fn summarize_session(app: AppHandle, id: String) -> Result<String> {
    memory::summarize(&app, &id).await
}

/// Save notes the user edited by hand.
#[tauri::command]
pub fn set_session_summary(state: State<'_, AppState>, id: String, summary: String) -> Result<()> {
    state
        .db
        .lock()
        .set_summary(&id, summary.trim(), state::now_ms())
}
