//! Global hotkeys, re-registered whenever settings change.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

use crate::config::Hotkeys;
use crate::prompt::Trigger;
use crate::session;
use crate::state::{state, toast};
use crate::window;

/// Registers all hotkeys; returns human-readable problems (bad syntax, taken by another app).
pub fn register(app: &AppHandle, hotkeys: &Hotkeys) -> Vec<String> {
    let gs = app.global_shortcut();
    if let Err(e) = gs.unregister_all() {
        tracing::warn!("unregister hotkeys: {e}");
    }
    let mut problems = Vec::new();
    for (action, accel) in hotkeys.entries() {
        let accel = accel.trim();
        if accel.is_empty() {
            continue;
        }
        let res = gs.on_shortcut(accel, move |app, _shortcut, event| {
            if action == "push_to_talk" {
                session::hold_mic(app, event.state == ShortcutState::Pressed);
            } else if event.state == ShortcutState::Pressed {
                handle(app, action);
            }
        });
        if let Err(e) = res {
            problems.push(format!("{accel} ({action}): {e}"));
        }
    }
    problems
}

fn handle(app: &AppHandle, action: &'static str) {
    match action {
        "toggle_overlay" => window::toggle_overlay(app),
        "ask" => {
            window::show_overlay(app);
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                let with_screen = state(&app).settings.read().behavior.screen_on_ask;
                if let Err(e) = session::ask(&app, Trigger::Assist, with_screen, false).await {
                    tracing::warn!("ask: {e}");
                }
            });
        }
        "toggle_listen" => {
            if let Err(e) = session::toggle_listening(app) {
                window::show_overlay(app);
                toast(app, "error", e.to_string());
            }
        }
        "focus_input" => window::focus_input(app),
        "click_through" => window::toggle_click_through(app),
        "move_up" => window::move_overlay(app, 0, -1),
        "move_down" => window::move_overlay(app, 0, 1),
        "move_left" => window::move_overlay(app, -1, 0),
        "move_right" => window::move_overlay(app, 1, 0),
        _ => {}
    }
}
