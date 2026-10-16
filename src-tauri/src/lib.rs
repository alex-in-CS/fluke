mod audio;
mod capture;
mod commands;
mod config;
mod context;
mod error;
mod hotkeys;
mod llm;
mod memory;
mod prompt;
mod secrets;
mod session;
mod state;
mod storage;
mod stt;
mod window;

use std::sync::atomic::AtomicBool;
use std::time::Duration;

use parking_lot::{Mutex, RwLock};
use tauri::Manager;

use crate::config::Settings;
use crate::state::{AppState, SessionState};
use crate::storage::Db;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // reqwest and tokio-tungstenite both use rustls; pin one process-wide crypto provider.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    // RUST_LOG overrides; default keeps dependency chatter (keyring, tao) out of the log.
    let default_filter = if cfg!(debug_assertions) {
        "info,fluke_lib=debug"
    } else {
        "info"
    };
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(default_filter)),
        )
        .with_target(false)
        .init();

    tauri::Builder::default()
        // Must be first: a second launch just surfaces the running overlay.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::show_overlay(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;

            let settings_path = config_dir.join("settings.json");
            let settings = Settings::load(&settings_path);
            let db = Db::open(&data_dir.join("fluke.db"))?;
            let http = reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .user_agent(concat!("Fluke/", env!("CARGO_PKG_VERSION")))
                .build()?;

            let hotkeys = settings.hotkeys.clone();
            app.manage(AppState {
                settings: RwLock::new(settings),
                settings_path,
                db: Mutex::new(db),
                http,
                session: Mutex::new(SessionState::new()),
                click_through: AtomicBool::new(false),
            });

            window::setup_overlay(&handle)?;
            window::setup_tray(&handle)?;
            for problem in hotkeys::register(&handle, &hotkeys) {
                tracing::warn!("hotkey not registered: {problem}");
                state::toast(&handle, "warn", format!("Hotkey not registered: {problem}"));
            }
            // Catch up on meeting notes for sessions that ended while the app was closing.
            memory::summarize_pending(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::key_status,
            commands::set_api_key,
            commands::delete_api_key,
            commands::list_models,
            commands::list_audio_devices,
            commands::start_listening,
            commands::stop_listening,
            commands::ask,
            commands::cancel_answer,
            commands::new_session,
            commands::get_snapshot,
            commands::list_sessions,
            commands::get_session,
            commands::delete_session,
            commands::delete_all_sessions,
            commands::session_markdown,
            commands::export_session,
            commands::open_settings,
            commands::hide_overlay,
            commands::set_click_through,
            commands::quit,
            commands::list_context_docs,
            commands::add_context_files,
            commands::remove_context_doc,
            commands::reload_context_doc,
            commands::context_file_types,
            commands::summarize_session,
            commands::set_session_summary,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Fluke")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                // Stop capture threads cleanly and close the session record.
                session::stop_listening(app);
                let st = app.state::<AppState>();
                let id = st.session.lock().id.clone();
                let _ = st.db.lock().end_session(&id, state::now_ms());
            }
        });
}
