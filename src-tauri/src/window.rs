//! Overlay + settings window behaviour, and the tray icon.

use std::sync::atomic::Ordering;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

use crate::error::Result;
use crate::state::{EV_ACTION, emit_status, state, toast};

pub const OVERLAY: &str = "overlay";
pub const SETTINGS: &str = "settings";

pub fn overlay(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(OVERLAY)
}

/// Exclude (or include) every Fluke window from screen sharing / recording.
pub fn apply_capture_protection(app: &AppHandle) {
    let on = state(app).settings.read().behavior.hide_from_capture;
    for (_, w) in app.webview_windows() {
        if let Err(e) = w.set_content_protected(on) {
            tracing::warn!("content protection on '{}': {e}", w.label());
        }
    }
}

fn place_top_center(w: &WebviewWindow) {
    let monitor = w
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| w.primary_monitor().ok().flatten());
    let (Some(m), Ok(size)) = (monitor, w.outer_size()) else {
        return;
    };
    let x = m.position().x + (m.size().width as i32 - size.width as i32) / 2;
    let y = m.position().y + (28.0 * m.scale_factor()) as i32;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

pub fn setup_overlay(app: &AppHandle) -> Result<()> {
    if let Some(w) = overlay(app) {
        place_top_center(&w);
        w.set_always_on_top(true)?;
        w.set_skip_taskbar(true)?;
        w.set_visible_on_all_workspaces(true)?;
        apply_capture_protection(app);
        w.show()?;
    }
    Ok(())
}

pub fn show_overlay(app: &AppHandle) {
    if let Some(w) = overlay(app) {
        let _ = w.show();
        let _ = w.set_always_on_top(true);
    }
}

pub fn toggle_overlay(app: &AppHandle) {
    if let Some(w) = overlay(app) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            show_overlay(app);
        }
    }
}

pub fn hide_overlay(app: &AppHandle) {
    if let Some(w) = overlay(app) {
        let _ = w.hide();
    }
}

pub fn move_overlay(app: &AppHandle, dx: i32, dy: i32) {
    let Some(w) = overlay(app) else { return };
    let scale = w.scale_factor().unwrap_or(1.0);
    let step = (48.0 * scale) as i32;
    if let Ok(pos) = w.outer_position() {
        let _ = w.set_position(PhysicalPosition::new(pos.x + dx * step, pos.y + dy * step));
    }
}

pub fn set_click_through(app: &AppHandle, on: bool) {
    state(app).click_through.store(on, Ordering::Relaxed);
    if let Some(w) = overlay(app) {
        let _ = w.set_ignore_cursor_events(on);
    }
    emit_status(app);
    if on {
        let accel = state(app).settings.read().hotkeys.click_through.clone();
        toast(
            app,
            "info",
            format!("Click-through on. Press {accel} to interact again."),
        );
    }
}

pub fn toggle_click_through(app: &AppHandle) {
    let on = !state(app).click_through.load(Ordering::Relaxed);
    set_click_through(app, on);
}

/// Bring the overlay forward and put the cursor in the ask box.
pub fn focus_input(app: &AppHandle) {
    if state(app).click_through.load(Ordering::Relaxed) {
        set_click_through(app, false);
    }
    if let Some(w) = overlay(app) {
        let _ = w.show();
        let _ = w.set_focus();
    }
    let _ = app.emit_to(OVERLAY, EV_ACTION, "focus_input");
}

pub fn open_settings(app: &AppHandle, section: Option<String>) -> Result<()> {
    if let Some(w) = app.get_webview_window(SETTINGS) {
        w.unminimize()?;
        w.show()?;
        w.set_focus()?;
        if let Some(section) = section {
            let _ = app.emit_to(SETTINGS, EV_ACTION, format!("section:{section}"));
        }
    } else {
        // A new window isn't listening for events yet, so the section rides in the URL.
        let url = match &section {
            Some(s) => format!("index.html?section={s}"),
            None => "index.html".to_owned(),
        };
        let w = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App(url.into()))
            .title("Fluke")
            .inner_size(1040.0, 760.0)
            .min_inner_size(820.0, 600.0)
            .center()
            .build()?;
        // Closing setup half-way still leaves Fluke reachable (the overlay offers to finish it).
        let handle = app.clone();
        w.on_window_event(move |e| {
            if matches!(e, tauri::WindowEvent::Destroyed) && !state(&handle).settings.read().onboarded {
                show_overlay(&handle);
            }
        });
        let protect = state(app).settings.read().behavior.hide_from_capture;
        let _ = w.set_content_protected(protect);
    }
    Ok(())
}

pub fn setup_tray(app: &AppHandle) -> Result<()> {
    let toggle = MenuItem::with_id(app, "toggle", "Show / hide overlay", true, None::<&str>)?;
    let listen = MenuItem::with_id(app, "listen", "Start / stop listening", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Fluke", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&toggle, &listen, &settings, &sep, &quit])?;

    let mut builder = TrayIconBuilder::with_id("fluke")
        .tooltip("Fluke")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => toggle_overlay(app),
            "listen" => {
                if let Err(e) = crate::session::toggle_listening(app) {
                    toast(app, "error", e.to_string());
                    show_overlay(app);
                }
            }
            "settings" => {
                let _ = open_settings(app, None);
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_overlay(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
