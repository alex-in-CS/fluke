//! Screen watching: while listening, read the text on the user's screen with Windows' built-in
//! OCR (on-device, free, nothing uploaded just for watching), then answer questions that appear
//! and brief the user when the content changes a lot.

use std::collections::HashSet;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};
use xcap::image::RgbaImage;
use xcap::image::imageops::{self, FilterType};

use crate::capture;
use crate::error::{AppError, Result};
use crate::prompt::{self, Trigger};
use crate::session;
use crate::state::{ScreenText, emit_status, now_ms, state, toast};

const TICK: Duration = Duration::from_millis(1200);
/// Share of text lines that must differ for "the screen changed a lot".
const BIG_CHANGE: f32 = 0.55;
/// Ignore near-empty screens (desktop, video) for briefings.
const MIN_BRIEFING_CHARS: usize = 160;
const BRIEFING_COOLDOWN: Duration = Duration::from_secs(20);
/// A screen question waits this long at most for a running answer to finish.
const PENDING_TTL: Duration = Duration::from_secs(20);
/// Screen text kept for prompts.
const MAX_SCREEN_CHARS: usize = 6000;

/// A rectangle in image pixels.
#[derive(Debug, Clone, Copy)]
struct Area {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

impl Area {
    fn overlaps(&self, o: &Area) -> bool {
        self.x < o.x + o.w && o.x < self.x + self.w && self.y < o.y + o.h && o.y < self.y + self.h
    }

    fn union(self, o: Area) -> Area {
        let x = self.x.min(o.x);
        let y = self.y.min(o.y);
        Area {
            x,
            y,
            w: (self.x + self.w).max(o.x + o.w) - x,
            h: (self.y + self.h).max(o.y + o.h) - y,
        }
    }
}

/// Coarse thumbnail used to skip OCR when nothing on screen moved.
fn fingerprint(img: &RgbaImage) -> Vec<u8> {
    imageops::resize(img, 64, 36, FilterType::Triangle)
        .pixels()
        .map(|p| ((p[0] as u16 + p[1] as u16 + p[2] as u16) / 24) as u8)
        .collect()
}

/// Recognize text lines, dropping any that overlap `exclude` (Fluke's own overlay).
fn ocr(img: &RgbaImage, exclude: Option<Area>) -> Result<Vec<String>> {
    use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;

    let err = |e: windows::core::Error| AppError::Capture(format!("text recognition: {}", e.message()));

    let max = OcrEngine::MaxImageDimension().map_err(err)? as f32;
    let (w, h) = img.dimensions();
    let scale = (max / w.max(h) as f32).min(1.0);
    let img = if scale < 1.0 {
        imageops::resize(img, (w as f32 * scale) as u32, (h as f32 * scale) as u32, FilterType::Triangle)
    } else {
        img.clone()
    };
    let (w, h) = img.dimensions();
    let mut bgra = img.into_raw();
    for px in bgra.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
    }

    let writer = DataWriter::new().map_err(err)?;
    writer.WriteBytes(&bgra).map_err(err)?;
    let buffer = writer.DetachBuffer().map_err(err)?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w as i32, h as i32)
        .map_err(err)?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|_| AppError::Capture("Windows has no text-recognition language installed".into()))?;
    let result = engine.RecognizeAsync(&bitmap).map_err(err)?.join().map_err(err)?;

    let exclude = exclude.map(|a| Area {
        x: a.x * scale,
        y: a.y * scale,
        w: a.w * scale,
        h: a.h * scale,
    });
    let lines = result.Lines().map_err(err)?;
    let mut out = Vec::new();
    for i in 0..lines.Size().map_err(err)? {
        let line = lines.GetAt(i).map_err(err)?;
        if let Some(ex) = exclude {
            let words = line.Words().map_err(err)?;
            let mut bbox: Option<Area> = None;
            for j in 0..words.Size().map_err(err)? {
                let r = words.GetAt(j).map_err(err)?.BoundingRect().map_err(err)?;
                let a = Area {
                    x: r.X,
                    y: r.Y,
                    w: r.Width,
                    h: r.Height,
                };
                bbox = Some(bbox.map_or(a, |b| b.union(a)));
            }
            if bbox.is_some_and(|b| b.overlaps(&ex)) {
                continue;
            }
        }
        let text = line.Text().map_err(err)?.to_string();
        if !text.trim().is_empty() {
            out.push(text);
        }
    }
    Ok(out)
}

fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// OCR breaks wrapped sentences into lines; glue a line onto the previous one when it reads
/// as a continuation.
fn merge_wrapped(lines: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in lines {
        let line = line.trim();
        let continues = line.chars().next().is_some_and(|c| c.is_lowercase())
            && out.last().is_some_and(|p| !p.ends_with(['.', '?', '!', ':']));
        match out.last_mut() {
            Some(prev) if continues => {
                prev.push(' ');
                prev.push_str(line);
            }
            _ => out.push(line.to_owned()),
        }
    }
    out
}

/// Stricter than the speech heuristic: screens are full of UI text like "How it works".
fn is_screen_question(line: &str) -> bool {
    let words = line.split_whitespace().count();
    if words < 3 || line.len() < 12 || line.len() > 600 {
        return false;
    }
    line.trim_end().ends_with('?') || (words >= 6 && prompt::looks_like_question(line))
}

#[derive(Debug, PartialEq)]
pub struct Change {
    /// Questions that weren't on screen before.
    pub questions: Vec<String>,
    /// 0 = same text, 1 = completely different.
    pub ratio: f32,
}

pub fn compare(prev: &[String], cur: &[String]) -> Change {
    let set = |lines: &[String]| -> HashSet<String> {
        lines.iter().map(|l| norm(l)).filter(|l| l.len() >= 3).collect()
    };
    let (p, c) = (set(prev), set(cur));
    let union = p.union(&c).count();
    let ratio = if union == 0 {
        0.0
    } else {
        1.0 - p.intersection(&c).count() as f32 / union as f32
    };

    let seen: HashSet<String> = merge_wrapped(prev).iter().map(|l| norm(l)).collect();
    let questions = merge_wrapped(cur)
        .into_iter()
        .filter(|l| !seen.contains(&norm(l)) && is_screen_question(l))
        .collect();
    Change { questions, ratio }
}

/// Desktop rectangle: x, y, width, height.
type DesktopRect = (i32, i32, u32, u32);

/// Where the overlay is (to pick its monitor) and, if it would show up in captures, its
/// rectangle so its own text isn't read back.
fn overlay_geometry(app: &AppHandle) -> (Option<(i32, i32)>, Option<DesktopRect>) {
    let Some(w) = app.get_webview_window("overlay") else {
        return (None, None);
    };
    let (Ok(pos), Ok(size)) = (w.outer_position(), w.outer_size()) else {
        return (None, None);
    };
    let center = Some((pos.x + size.width as i32 / 2, pos.y + size.height as i32 / 2));
    let protected = state(app).settings.read().behavior.hide_from_capture;
    let visible = w.is_visible().unwrap_or(false);
    let rect = (!protected && visible).then_some((pos.x, pos.y, size.width, size.height));
    (center, rect)
}

/// Runs while listening. Owned by the live pipeline, so it stops with it.
pub async fn watch(app: AppHandle) {
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_print: Option<Vec<u8>> = None;
    let mut prev: Option<Vec<String>> = None;
    let mut last_briefing: Option<Instant> = None;
    let mut pending: Option<(Trigger, Instant)> = None;

    loop {
        tick.tick().await;
        let (enabled, briefings) = {
            let st = state(&app);
            let s = st.settings.read();
            (s.behavior.watch_screen, s.behavior.screen_commentary)
        };
        if !enabled {
            continue;
        }

        let (point, overlay) = overlay_geometry(&app);
        let shot = tauri::async_runtime::spawn_blocking(move || capture::capture_raw(point)).await;
        let (img, origin) = match shot {
            Ok(Ok(v)) => v,
            Ok(Err(e)) => {
                tracing::debug!("screen capture: {e}");
                continue;
            }
            Err(_) => continue,
        };

        let print = fingerprint(&img);
        if last_print.as_ref() != Some(&print) {
            last_print = Some(print);
            let exclude = overlay.map(|(x, y, w, h)| Area {
                x: (x - origin.0) as f32,
                y: (y - origin.1) as f32,
                w: w as f32,
                h: h as f32,
            });
            let lines = match tauri::async_runtime::spawn_blocking(move || ocr(&img, exclude)).await {
                Ok(Ok(lines)) => lines,
                Ok(Err(e)) => {
                    // Without OCR there's nothing to watch; say so once and stand down.
                    tracing::warn!("screen watch disabled: {e}");
                    toast(&app, "warn", format!("Screen watching is off: {e}"));
                    state(&app).session.lock().watching = false;
                    emit_status(&app);
                    return;
                }
                Err(_) => continue,
            };

            let mut text = lines.join("\n");
            if text.len() > MAX_SCREEN_CHARS {
                let mut cut = MAX_SCREEN_CHARS;
                while !text.is_char_boundary(cut) {
                    cut -= 1;
                }
                text.truncate(cut);
            }
            let chars = text.len();
            state(&app).session.lock().screen = Some(ScreenText { text, at: now_ms() });

            // The first read is the baseline: only react to what changes after listening starts.
            if let Some(before) = prev.replace(lines) {
                let change = compare(&before, prev.as_deref().unwrap_or_default());
                if !change.questions.is_empty() {
                    let recent: Vec<String> = change.questions.iter().rev().take(2).rev().cloned().collect();
                    pending = Some((Trigger::OnScreen(recent.join(" ")), Instant::now()));
                } else if briefings
                    && pending.is_none()
                    && change.ratio >= BIG_CHANGE
                    && chars >= MIN_BRIEFING_CHARS
                    && last_briefing.is_none_or(|t| t.elapsed() >= BRIEFING_COOLDOWN)
                {
                    pending = Some((Trigger::ScreenChange, Instant::now()));
                }
            }
        }

        // Never cut off an answer that's still streaming; try again next tick.
        let Some((_, since)) = &pending else { continue };
        if since.elapsed() > PENDING_TTL {
            pending = None;
            continue;
        }
        if state(&app).session.lock().answering.is_some() {
            continue;
        }
        let Some((trigger, _)) = pending.take() else { continue };
        if matches!(trigger, Trigger::ScreenChange) {
            last_briefing = Some(Instant::now());
        }
        if let Err(e) = session::ask(&app, trigger, false, true).await {
            tracing::warn!("screen answer failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn finds_new_questions_only() {
        let before = lines(&["Sprint board", "How it works", "Is the API rate limited?"]);
        let after = lines(&[
            "Sprint board",
            "How it works",
            "Is the API rate limited?",
            "Priya: what's our plan if the vendor slips",
            "by two weeks?",
        ]);
        let c = compare(&before, &after);
        assert_eq!(c.questions, vec!["Priya: what's our plan if the vendor slips by two weeks?"]);
        assert!(c.ratio < 0.5);
    }

    #[test]
    fn ignores_ui_labels() {
        assert!(!is_screen_question("How it works"));
        assert!(!is_screen_question("Why?"));
        assert!(is_screen_question("Can you explain the retry logic?"));
    }

    #[test]
    fn detects_big_changes() {
        let a = lines(&["Q3 roadmap", "Launch in October", "Hiring two engineers"]);
        let b = lines(&["Pricing", "Pro plan $49", "Enterprise: contact sales"]);
        assert!(compare(&a, &b).ratio > 0.9);
        assert_eq!(compare(&a, &a).ratio, 0.0);
    }
}

#[cfg(test)]
mod live {
    /// Reads the real screen. Run by hand: `cargo test ocr_reads_the_screen -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn ocr_reads_the_screen() {
        let (img, _) = crate::capture::capture_raw(None).expect("capture");
        let started = std::time::Instant::now();
        let lines = super::ocr(&img, None).expect("ocr");
        println!("{} lines in {:?}", lines.len(), started.elapsed());
        for l in lines.iter().take(8) {
            println!("  {l}");
        }
    }
}
