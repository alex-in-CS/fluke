//! Meeting memory: after a session ends, the configured model writes concise notes
//! (decisions, action items, open questions). Future sessions in the same profile get the
//! most recent notes as context, so Fluke remembers what was already discussed and promised.

use futures_util::StreamExt;
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, Result};
use crate::llm::{ChatRequest, LlmClient, Message, Part, Role};
use crate::secrets;
use crate::state::{EV_HISTORY, now_ms, state, toast};
use crate::storage;

/// Long meetings are trimmed from the middle so the start (agenda) and end (wrap-up) survive.
const MAX_TRANSCRIPT_CHARS: usize = 400_000;

const SYSTEM: &str = "\
You write meeting notes for the user's private records. The transcript comes from live \
speech-to-text: \"Me\" is the user, \"Them\" is everyone else. Expect transcription errors; \
infer intended words. Be factual and specific: names, numbers, dates, commitments. Never invent \
anything that isn't supported by the transcript.

Reply in exactly this format:
Title: <a specific 3-8 word title for the meeting>

**Summary:** <2-4 sentences>

**Decisions**
- ...

**Action items**
- <owner, or \"Me\"/\"Them\" if unclear>: <task> (<due date if mentioned>)

**Open questions**
- ...

**Details worth remembering**
- <facts, numbers, preferences, context that will matter next time>

Omit any section that would be empty.";

fn client_for_settings(app: &AppHandle) -> Result<(LlmClient, String, u32, Option<String>)> {
    let st = state(app);
    let s = st.settings();
    let provider = s
        .provider(&s.llm.provider_id)
        .cloned()
        .ok_or_else(|| AppError::UnknownProvider(s.llm.provider_id.clone()))?;
    let key = secrets::get(&provider.id)?;
    let client = LlmClient::new(provider, key, st.http.clone())?;
    Ok((
        client,
        s.llm.model.clone(),
        s.behavior.max_output_tokens.min(8000),
        s.behavior.anthropic_effort.clone(),
    ))
}

fn clip_middle(text: &str, max: usize) -> String {
    let n = text.chars().count();
    if n <= max {
        return text.to_owned();
    }
    let head: String = text.chars().take(max / 3).collect();
    let tail: String = text.chars().skip(n - (max - max / 3)).collect();
    format!("{head}\n\n[… middle of the meeting omitted for length …]\n\n{tail}")
}

/// Splits "Title: ..." off the model output.
fn split_title(output: &str) -> (Option<String>, String) {
    let trimmed = output.trim();
    if let Some(first) = trimmed.lines().next()
        && let Some(title) = first.strip_prefix("Title:")
    {
        let title = title.trim().trim_matches('"').to_owned();
        let rest = trimmed[first.len()..].trim().to_owned();
        return ((!title.is_empty()).then_some(title), rest);
    }
    (None, trimmed.to_owned())
}

/// Summarize one session and store the notes (and a better title). Returns the notes.
pub async fn summarize(app: &AppHandle, session_id: &str) -> Result<String> {
    let detail = state(app)
        .db
        .lock()
        .get_session(session_id)?
        .ok_or_else(|| AppError::msg("session not found"))?;
    let transcript = storage::transcript_text(&detail);
    if transcript.trim().is_empty() {
        return Err(AppError::msg(
            "This session has no transcript to summarize.",
        ));
    }

    let (client, model, max_tokens, effort) = client_for_settings(app)?;
    let profile_name = state(app)
        .settings()
        .profiles
        .iter()
        .find(|p| p.id == detail.session.profile_id)
        .map(|p| p.name.clone())
        .unwrap_or_default();
    let user = format!(
        "<meeting date=\"{}\" profile=\"{}\">\n{}\n</meeting>\n\nWrite the notes.",
        storage::memory_date(detail.session.started_at),
        profile_name,
        clip_middle(&transcript, MAX_TRANSCRIPT_CHARS)
    );
    let req = ChatRequest {
        model,
        system: SYSTEM.into(),
        messages: vec![Message {
            role: Role::User,
            parts: vec![Part::Text(user)],
        }],
        max_tokens,
        effort,
    };

    let mut stream = client.stream(req).await?;
    let mut out = String::new();
    while let Some(chunk) = stream.next().await {
        out.push_str(&chunk?);
    }
    let (title, notes) = split_title(&out);
    if notes.trim().is_empty() {
        return Err(AppError::msg("The model returned empty notes."));
    }
    {
        let st = state(app);
        let db = st.db.lock();
        db.set_summary(session_id, &notes, now_ms())?;
        if let Some(t) = title {
            db.set_title(session_id, &t)?;
        }
    }
    let _ = app.emit(EV_HISTORY, session_id);
    Ok(notes)
}

/// Summarize finished sessions that don't have notes yet, for profiles with memory on.
/// Runs in the background; stops at the first failure (usually a missing key or no network).
pub fn summarize_pending(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let (current, settings) = {
            let st = state(&app);
            let current = st.session.lock().id.clone();
            (current, st.settings())
        };
        let ids = match state(&app).db.lock().sessions_needing_summary(&current) {
            Ok(ids) => ids,
            Err(e) => return tracing::warn!("pending summaries: {e}"),
        };
        for id in ids {
            let profile_id = state(&app)
                .db
                .lock()
                .get_session(&id)
                .ok()
                .flatten()
                .map(|d| d.session.profile_id)
                .unwrap_or_default();
            let enabled = settings
                .profiles
                .iter()
                .find(|p| p.id == profile_id)
                .map(|p| p.memory_enabled)
                .unwrap_or(true);
            if !enabled {
                continue;
            }
            match summarize(&app, &id).await {
                Ok(_) => toast(
                    &app,
                    "info",
                    "Saved notes from your last meeting to memory.",
                ),
                Err(e) => {
                    tracing::info!("summary for {id} skipped: {e}");
                    break;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_title_line() {
        let (t, rest) = split_title("Title: Acme renewal call\n\n**Summary:** ok");
        assert_eq!(t.as_deref(), Some("Acme renewal call"));
        assert_eq!(rest, "**Summary:** ok");
        let (t, rest) = split_title("**Summary:** no title");
        assert!(t.is_none());
        assert_eq!(rest, "**Summary:** no title");
    }

    #[test]
    fn clips_long_transcripts_from_the_middle() {
        let s = "a".repeat(100) + &"b".repeat(100);
        let c = clip_middle(&s, 60);
        assert!(c.starts_with("aaaa") && c.ends_with("bbbb") && c.contains("omitted"));
        assert_eq!(clip_middle("short", 60), "short");
    }
}
