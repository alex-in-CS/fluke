//! Prompt assembly and live question detection.

use crate::config::Profile;
use crate::storage::{AnswerRecord, ContextDoc, Memory, Segment, Speaker, memory_date};

const BASE_SYSTEM: &str = "\
You are Fluke, a real-time assistant that helps the user during live conversations: calls, \
meetings, interviews, demos. You receive a rolling transcript where \"Them\" is the other \
participants (system audio) and \"Me\" is the user (microphone). Speech-to-text can mishear \
words; infer the intended meaning. Sometimes you also get a screenshot of the user's screen.

How to respond:
- Lead with what the user can say or do right now. No preamble, no restating the question.
- Write in the user's voice (first person) when giving something to say out loud.
- Keep it scannable: a short direct answer first, then a few tight bullets only if they add value.
- If the screen shows code, a problem, a document or a form, work from it directly. For code, \
state the approach in one or two lines, then give the code.
- If the latest question is ambiguous, answer the most likely interpretation.
- Use the background context, reference documents and notes from previous meetings when they \
are relevant. Stay consistent with what was already discussed, decided or promised. Never invent \
facts about the user.";

/// Everything the user has given Fluke to know, beyond the live conversation.
pub struct Knowledge<'a> {
    pub profile: Option<&'a Profile>,
    pub docs: &'a [ContextDoc],
    pub memories: &'a [Memory],
}

/// The system prompt holds the stable context (instructions, documents, past meetings) so
/// providers with prompt caching can reuse it across questions; the transcript goes last.
pub fn system_prompt(k: &Knowledge) -> String {
    let mut s = String::from(BASE_SYSTEM);
    if let Some(p) = k.profile {
        if !p.instructions.trim().is_empty() {
            s.push_str("\n\n## The user's instructions\n");
            s.push_str(p.instructions.trim());
        }
        if !p.context.trim().is_empty() {
            s.push_str("\n\n## Background context\n");
            s.push_str(p.context.trim());
        }
    }
    if !k.docs.is_empty() {
        s.push_str("\n\n## Reference documents\n");
        for d in k.docs {
            s.push_str(&format!(
                "<document name=\"{}\">\n{}\n</document>\n",
                d.name.replace('"', "'"),
                d.text.trim()
            ));
        }
    }
    if !k.memories.is_empty() {
        s.push_str("\n\n## Notes from previous meetings (most recent first)\n");
        for m in k.memories {
            s.push_str(&format!(
                "<meeting date=\"{}\" title=\"{}\">\n{}\n</meeting>\n",
                memory_date(m.started_at),
                m.title.replace('"', "'"),
                m.summary.trim()
            ));
        }
    }
    s
}

/// What prompted this answer.
#[derive(Debug, Clone)]
pub enum Trigger {
    /// The user typed a question / instruction.
    Typed(String),
    /// Hotkey or Ask button with nothing typed.
    Assist,
    /// Auto-detected question from the other side.
    Detected(String),
}

impl Trigger {
    /// Short label stored with the answer and shown in the UI.
    pub fn label(&self) -> String {
        match self {
            Trigger::Typed(q) | Trigger::Detected(q) => q.clone(),
            Trigger::Assist => "What should I say?".into(),
        }
    }
}

/// Builds the user turn: transcript, recent answers, then the actual request.
pub fn user_turn(
    transcript: &[Segment],
    window_ms: i64,
    now_ms: i64,
    previous: &[AnswerRecord],
    trigger: &Trigger,
    has_screen: bool,
) -> String {
    const MAX_TRANSCRIPT_CHARS: usize = 24_000;

    let start = transcript.first().map(|s| s.ts).unwrap_or(now_ms);
    let mut lines: Vec<String> = transcript
        .iter()
        .filter(|s| now_ms - s.ts <= window_ms)
        .map(|s| {
            let secs = ((s.ts - start).max(0) / 1000) as u64;
            let who = if s.speaker == Speaker::Me {
                "Me"
            } else {
                "Them"
            };
            format!("[{:02}:{:02}] {who}: {}", secs / 60, secs % 60, s.text)
        })
        .collect();
    // Keep the most recent lines within the char budget.
    let mut total = 0usize;
    let mut keep_from = lines.len();
    for (i, l) in lines.iter().enumerate().rev() {
        total += l.len() + 1;
        if total > MAX_TRANSCRIPT_CHARS {
            break;
        }
        keep_from = i;
    }
    lines.drain(..keep_from);

    let mut out = String::new();
    if lines.is_empty() {
        out.push_str("<transcript>\n(no speech captured yet)\n</transcript>\n\n");
    } else {
        out.push_str("<transcript>\n");
        out.push_str(&lines.join("\n"));
        out.push_str("\n</transcript>\n\n");
    }

    let recent: Vec<&AnswerRecord> = previous.iter().rev().take(3).collect();
    if !recent.is_empty() {
        out.push_str("<your_previous_answers>\n");
        for a in recent.into_iter().rev() {
            let answer: String = a.answer.chars().take(1200).collect();
            out.push_str(&format!("Q: {}\nA: {}\n\n", a.question, answer));
        }
        out.push_str("</your_previous_answers>\n\n");
    }

    let screen = if has_screen {
        " The attached screenshot is my screen right now."
    } else {
        ""
    };
    match trigger {
        Trigger::Typed(q) => out.push_str(&format!("{q}{screen}")),
        Trigger::Detected(q) => out.push_str(&format!(
            "They just asked: \"{q}\"\nGive me the answer to say.{screen}"
        )),
        Trigger::Assist => out.push_str(&format!(
            "Help me with what's happening right now. If there's an open question in the \
             conversation, answer it. Otherwise, help with what's on my screen or suggest what \
             I should say next.{screen}"
        )),
    }
    out
}

const QUESTION_STARTERS: &[&str] = &[
    "what",
    "why",
    "how",
    "when",
    "where",
    "who",
    "whom",
    "whose",
    "which",
    "can",
    "could",
    "would",
    "will",
    "should",
    "shall",
    "do",
    "does",
    "did",
    "is",
    "are",
    "was",
    "were",
    "have",
    "has",
    "had",
    "may",
    "might",
    "am",
    "isn't",
    "aren't",
    "don't",
    "doesn't",
    "didn't",
    "won't",
    "wouldn't",
    "couldn't",
    "shouldn't",
];

const REQUEST_PHRASES: &[&str] = &[
    "tell me about",
    "tell me how",
    "tell me why",
    "walk me through",
    "talk me through",
    "explain",
    "describe",
    "give me an example",
    "give us an example",
    "share an example",
    "can you share",
    "help me understand",
    "what about",
    "how about",
    "i'd love to hear",
    "i'm curious",
    "i am curious",
];

/// Heuristic: does this finalized utterance from the other side ask something the user
/// should answer? Tuned for precision; the user can always press Ask manually.
pub fn looks_like_question(text: &str) -> bool {
    let t = text.trim();
    let words: Vec<&str> = t.split_whitespace().collect();
    if words.len() < 3 {
        return false;
    }
    let lower = t.to_lowercase();

    if t.ends_with('?') {
        return true;
    }
    if REQUEST_PHRASES.iter().any(|p| lower.contains(p)) {
        return true;
    }
    // Speech-to-text often drops the '?'. Check the last sentence's first word.
    let last_sentence = lower
        .rsplit(['.', '!'])
        .find(|s| !s.trim().is_empty())
        .unwrap_or(&lower);
    let first = last_sentence
        .split_whitespace()
        .next()
        .unwrap_or("")
        .trim_matches(|c: char| !c.is_alphanumeric() && c != '\'');
    let sentence_words = last_sentence.split_whitespace().count();
    sentence_words >= 4 && QUESTION_STARTERS.contains(&first)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_questions() {
        assert!(looks_like_question(
            "What is your experience with Kubernetes?"
        ));
        assert!(looks_like_question(
            "So tell me about a time you led a project."
        ));
        assert!(looks_like_question(
            "Okay. How would you design a rate limiter for this"
        ));
        assert!(looks_like_question("Could you walk me through the pricing"));
        assert!(looks_like_question(
            "Can you explain how the integration works"
        ));
    }

    #[test]
    fn ignores_statements_and_fragments() {
        assert!(!looks_like_question("Yeah."));
        assert!(!looks_like_question("Right?"));
        assert!(!looks_like_question("That sounds great, thanks."));
        assert!(!looks_like_question("We shipped the release last week."));
        assert!(!looks_like_question("Is it"));
    }

    #[test]
    fn user_turn_includes_transcript_and_request() {
        let segs = vec![
            Segment {
                id: 1,
                speaker: Speaker::Them,
                text: "Hi there".into(),
                ts: 1_000,
            },
            Segment {
                id: 2,
                speaker: Speaker::Me,
                text: "Hello".into(),
                ts: 65_000,
            },
        ];
        let t = user_turn(
            &segs,
            600_000,
            70_000,
            &[],
            &Trigger::Typed("Summarize".into()),
            true,
        );
        assert!(t.contains("[00:00] Them: Hi there"));
        assert!(t.contains("[01:04] Me: Hello"));
        assert!(t.ends_with("Summarize The attached screenshot is my screen right now."));
    }

    #[test]
    fn system_prompt_includes_docs_and_memories() {
        let profile = Profile {
            id: "sales".into(),
            name: "Sales".into(),
            instructions: "Be brief.".into(),
            ..Default::default()
        };
        let docs = vec![ContextDoc {
            id: 1,
            profile_id: "sales".into(),
            name: "pricing.md".into(),
            path: String::new(),
            chars: 9,
            added_at: 0,
            text: "Pro: $49".into(),
        }];
        let memories = vec![Memory {
            title: "Acme kickoff".into(),
            started_at: 0,
            summary: "Promised a demo Friday.".into(),
        }];
        let s = system_prompt(&Knowledge {
            profile: Some(&profile),
            docs: &docs,
            memories: &memories,
        });
        assert!(s.contains("## The user's instructions\nBe brief."));
        assert!(s.contains("<document name=\"pricing.md\">\nPro: $49\n</document>"));
        assert!(s.contains("title=\"Acme kickoff\">\nPromised a demo Friday.\n</meeting>"));

        let bare = system_prompt(&Knowledge {
            profile: None,
            docs: &[],
            memories: &[],
        });
        assert!(!bare.contains("## Reference documents"));
        assert!(!bare.contains("previous meetings (most"));
    }

    #[test]
    fn user_turn_respects_window() {
        let segs = vec![
            Segment {
                id: 1,
                speaker: Speaker::Them,
                text: "old".into(),
                ts: 0,
            },
            Segment {
                id: 2,
                speaker: Speaker::Them,
                text: "new".into(),
                ts: 590_000,
            },
        ];
        let t = user_turn(&segs, 60_000, 600_000, &[], &Trigger::Assist, false);
        assert!(!t.contains("old"));
        assert!(t.contains("new"));
    }
}
