//! Local storage (SQLite): sessions, transcripts, answers, meeting summaries and profile
//! context documents. Nothing here ever leaves the machine.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Speaker {
    Me,
    Them,
}

impl Speaker {
    pub fn as_str(self) -> &'static str {
        match self {
            Speaker::Me => "me",
            Speaker::Them => "them",
        }
    }
    fn parse(s: &str) -> Self {
        if s == "me" {
            Speaker::Me
        } else {
            Speaker::Them
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub title: String,
    pub profile_id: String,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub segment_count: i64,
    pub answer_count: i64,
    /// LLM-written recap (decisions, action items...). None until summarized.
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Segment {
    pub id: i64,
    pub speaker: Speaker,
    pub text: String,
    /// Unix millis.
    pub ts: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AnswerRecord {
    pub id: String,
    pub question: String,
    pub answer: String,
    pub model: String,
    pub with_screen: bool,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionDetail {
    pub session: SessionSummary,
    pub segments: Vec<Segment>,
    pub answers: Vec<AnswerRecord>,
}

/// A past meeting's recap, fed back in as memory.
#[derive(Debug, Clone)]
pub struct Memory {
    pub title: String,
    pub started_at: i64,
    pub summary: String,
}

/// A file attached to a profile; `text` is the extracted plain text.
#[derive(Debug, Clone, Serialize)]
pub struct ContextDoc {
    pub id: i64,
    pub profile_id: String,
    pub name: String,
    pub path: String,
    pub chars: i64,
    pub added_at: i64,
    #[serde(skip)]
    pub text: String,
}

/// Each entry upgrades the schema by one version (tracked in `PRAGMA user_version`).
const MIGRATIONS: &[&str] = &[
    // 1: base schema
    "CREATE TABLE IF NOT EXISTS sessions (
         id         TEXT PRIMARY KEY,
         title      TEXT NOT NULL DEFAULT '',
         started_at INTEGER NOT NULL,
         ended_at   INTEGER
     );
     CREATE TABLE IF NOT EXISTS segments (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
         speaker    TEXT NOT NULL,
         text       TEXT NOT NULL,
         ts         INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS segments_session ON segments(session_id, ts);
     CREATE TABLE IF NOT EXISTS answers (
         id          TEXT PRIMARY KEY,
         session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
         question    TEXT NOT NULL,
         answer      TEXT NOT NULL,
         model       TEXT NOT NULL,
         with_screen INTEGER NOT NULL DEFAULT 0,
         created_at  INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS answers_session ON answers(session_id, created_at);",
    // 2: meeting memory + profile context documents
    "ALTER TABLE sessions ADD COLUMN profile_id TEXT NOT NULL DEFAULT '';
     ALTER TABLE sessions ADD COLUMN summary TEXT;
     ALTER TABLE sessions ADD COLUMN summary_at INTEGER;
     CREATE INDEX IF NOT EXISTS sessions_profile ON sessions(profile_id, started_at);
     CREATE TABLE IF NOT EXISTS context_docs (
         id         INTEGER PRIMARY KEY AUTOINCREMENT,
         profile_id TEXT NOT NULL,
         name       TEXT NOT NULL,
         path       TEXT NOT NULL,
         text       TEXT NOT NULL,
         added_at   INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS context_docs_profile ON context_docs(profile_id);",
    // 3: quick notes typed into the overlay during a meeting
    "ALTER TABLE sessions ADD COLUMN notes TEXT NOT NULL DEFAULT '';",
];

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")?;
        migrate(&mut conn)?;
        Ok(Self { conn })
    }

    #[cfg(test)]
    fn memory() -> Result<Self> {
        let mut conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        migrate(&mut conn)?;
        Ok(Self { conn })
    }

    // --- sessions -----------------------------------------------------------------------------

    pub fn create_session(&self, id: &str, started_at: i64, profile_id: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO sessions (id, started_at, profile_id) VALUES (?1, ?2, ?3)",
            params![id, started_at, profile_id],
        )?;
        Ok(())
    }

    pub fn end_session(&self, id: &str, ended_at: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions SET ended_at = ?2 WHERE id = ?1",
            params![id, ended_at],
        )?;
        Ok(())
    }

    pub fn set_title_if_empty(&self, id: &str, title: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions SET title = ?2 WHERE id = ?1 AND title = ''",
            params![id, title],
        )?;
        Ok(())
    }

    pub fn set_title(&self, id: &str, title: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions SET title = ?2 WHERE id = ?1",
            params![id, title],
        )?;
        Ok(())
    }

    pub fn set_summary(&self, id: &str, summary: &str, at: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions SET summary = ?2, summary_at = ?3 WHERE id = ?1",
            params![id, summary, at],
        )?;
        Ok(())
    }

    pub fn set_notes(&self, id: &str, notes: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE sessions SET notes = ?2 WHERE id = ?1",
            params![id, notes],
        )?;
        Ok(())
    }

    pub fn add_segment(
        &self,
        session_id: &str,
        speaker: Speaker,
        text: &str,
        ts: i64,
    ) -> Result<i64> {
        self.conn.execute(
            "INSERT INTO segments (session_id, speaker, text, ts) VALUES (?1, ?2, ?3, ?4)",
            params![session_id, speaker.as_str(), text, ts],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn add_answer(&self, session_id: &str, a: &AnswerRecord) -> Result<()> {
        self.conn.execute(
            "INSERT OR REPLACE INTO answers (id, session_id, question, answer, model, with_screen, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![a.id, session_id, a.question, a.answer, a.model, a.with_screen, a.created_at],
        )?;
        Ok(())
    }

    fn query_sessions(
        &self,
        where_clause: &str,
        args: &[&dyn rusqlite::ToSql],
    ) -> Result<Vec<SessionSummary>> {
        let sql = format!(
            "SELECT s.id, s.title, s.profile_id, s.started_at, s.ended_at,
                    (SELECT COUNT(*) FROM segments g WHERE g.session_id = s.id),
                    (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id),
                    s.summary
             FROM sessions s {where_clause} ORDER BY s.started_at DESC"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(args, |r| {
            Ok(SessionSummary {
                id: r.get(0)?,
                title: r.get(1)?,
                profile_id: r.get(2)?,
                started_at: r.get(3)?,
                ended_at: r.get(4)?,
                segment_count: r.get(5)?,
                answer_count: r.get(6)?,
                summary: r.get(7)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionSummary>> {
        Ok(self
            .query_sessions("", &[])?
            .into_iter()
            // Sessions opened but never used are noise.
            .filter(|s| s.segment_count > 0 || s.answer_count > 0)
            .collect())
    }

    pub fn get_session(&self, id: &str) -> Result<Option<SessionDetail>> {
        let Some(session) = self
            .query_sessions("WHERE s.id = ?1", &[&id])?
            .into_iter()
            .next()
        else {
            return Ok(None);
        };

        let mut stmt = self.conn.prepare(
            "SELECT id, speaker, text, ts FROM segments WHERE session_id = ?1 ORDER BY ts, id",
        )?;
        let segments = stmt
            .query_map([id], |r| {
                let speaker: String = r.get(1)?;
                Ok(Segment {
                    id: r.get(0)?,
                    speaker: Speaker::parse(&speaker),
                    text: r.get(2)?,
                    ts: r.get(3)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        let mut stmt = self.conn.prepare(
            "SELECT id, question, answer, model, with_screen, created_at
             FROM answers WHERE session_id = ?1 ORDER BY created_at",
        )?;
        let answers = stmt
            .query_map([id], |r| {
                Ok(AnswerRecord {
                    id: r.get(0)?,
                    question: r.get(1)?,
                    answer: r.get(2)?,
                    model: r.get(3)?,
                    with_screen: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;

        Ok(Some(SessionDetail {
            session,
            segments,
            answers,
        }))
    }

    /// Ended sessions with enough content to be worth summarizing, oldest first.
    pub fn sessions_needing_summary(&self, exclude: &str) -> Result<Vec<String>> {
        let mut found: Vec<SessionSummary> = self
            .query_sessions("WHERE s.summary IS NULL AND s.id != ?1", &[&exclude])?
            .into_iter()
            .filter(|s| s.segment_count >= 4 || s.answer_count >= 1)
            .collect();
        found.reverse();
        Ok(found.into_iter().map(|s| s.id).collect())
    }

    /// The most recent summarized meetings for a profile (newest first).
    pub fn recent_memories(
        &self,
        profile_id: &str,
        limit: u32,
        exclude: &str,
    ) -> Result<Vec<Memory>> {
        let mut stmt = self.conn.prepare(
            "SELECT title, started_at, summary FROM sessions
             WHERE profile_id = ?1 AND summary IS NOT NULL AND summary != '' AND id != ?2
             ORDER BY started_at DESC LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![profile_id, exclude, limit], |r| {
            Ok(Memory {
                title: r.get(0)?,
                started_at: r.get(1)?,
                summary: r.get(2)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn delete_session(&self, id: &str) -> Result<()> {
        self.conn
            .execute("DELETE FROM sessions WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn delete_all(&self) -> Result<()> {
        self.conn.execute_batch("DELETE FROM sessions;")?;
        Ok(())
    }

    // --- context documents --------------------------------------------------------------------

    pub fn add_doc(
        &self,
        profile_id: &str,
        name: &str,
        path: &str,
        text: &str,
        at: i64,
    ) -> Result<ContextDoc> {
        self.conn.execute(
            "INSERT INTO context_docs (profile_id, name, path, text, added_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![profile_id, name, path, text, at],
        )?;
        Ok(ContextDoc {
            id: self.conn.last_insert_rowid(),
            profile_id: profile_id.to_owned(),
            name: name.to_owned(),
            path: path.to_owned(),
            chars: text.chars().count() as i64,
            added_at: at,
            text: text.to_owned(),
        })
    }

    pub fn docs(&self, profile_id: &str) -> Result<Vec<ContextDoc>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, profile_id, name, path, text, added_at FROM context_docs
             WHERE profile_id = ?1 ORDER BY added_at, id",
        )?;
        let rows = stmt.query_map([profile_id], |r| {
            let text: String = r.get(4)?;
            Ok(ContextDoc {
                id: r.get(0)?,
                profile_id: r.get(1)?,
                name: r.get(2)?,
                path: r.get(3)?,
                chars: text.chars().count() as i64,
                added_at: r.get(5)?,
                text,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    pub fn update_doc_text(&self, id: i64, text: &str, at: i64) -> Result<()> {
        self.conn.execute(
            "UPDATE context_docs SET text = ?2, added_at = ?3 WHERE id = ?1",
            params![id, text, at],
        )?;
        Ok(())
    }

    pub fn doc(&self, id: i64) -> Result<Option<ContextDoc>> {
        let profile: Option<String> = self
            .conn
            .query_row(
                "SELECT profile_id FROM context_docs WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .optional()?;
        match profile {
            Some(p) => Ok(self.docs(&p)?.into_iter().find(|d| d.id == id)),
            None => Ok(None),
        }
    }

    pub fn remove_doc(&self, id: i64) -> Result<()> {
        self.conn
            .execute("DELETE FROM context_docs WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Drop documents that belong to profiles that no longer exist.
    pub fn prune_docs(&self, profile_ids: &[String]) -> Result<()> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT profile_id FROM context_docs")?;
        let existing = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        for p in existing.iter().filter(|p| !profile_ids.contains(p)) {
            self.conn
                .execute("DELETE FROM context_docs WHERE profile_id = ?1", [p])?;
        }
        Ok(())
    }
}

fn migrate(conn: &mut Connection) -> Result<()> {
    let version: usize =
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))? as usize;
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(version) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute_batch(&format!("PRAGMA user_version = {}", i + 1))?;
        tx.commit()?;
        tracing::info!("database migrated to v{}", i + 1);
    }
    Ok(())
}

fn fmt_local(ms: i64, pattern: &str) -> String {
    use chrono::{Local, TimeZone};
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|t| t.format(pattern).to_string())
        .unwrap_or_default()
}

pub fn memory_date(ms: i64) -> String {
    fmt_local(ms, "%a %d %b %Y, %H:%M")
}

/// Plain transcript used for summarizing.
pub fn transcript_text(d: &SessionDetail) -> String {
    let mut out = String::new();
    for s in &d.segments {
        let who = if s.speaker == Speaker::Me {
            "Me"
        } else {
            "Them"
        };
        out.push_str(&format!("{who}: {}\n", s.text));
    }
    if !d.answers.is_empty() {
        out.push_str("\nNotes the assistant gave me during the meeting:\n");
        for a in &d.answers {
            let answer: String = a.answer.chars().take(600).collect();
            out.push_str(&format!(
                "- Q: {}\n  A: {}\n",
                a.question,
                answer.replace('\n', " ")
            ));
        }
    }
    out
}

/// Render a session as Markdown for export.
pub fn session_markdown(d: &SessionDetail) -> String {
    let title = if d.session.title.is_empty() {
        "Fluke session"
    } else {
        &d.session.title
    };
    let mut out = format!(
        "# {title}\n\nStarted: {}\n\n",
        fmt_local(d.session.started_at, "%Y-%m-%d %H:%M:%S")
    );
    if let Some(summary) = d.session.summary.as_deref().filter(|s| !s.is_empty()) {
        out.push_str("## Summary\n\n");
        out.push_str(summary);
        out.push_str("\n\n");
    }

    // Interleave transcript and answers by time.
    enum Item<'a> {
        Seg(&'a Segment),
        Ans(&'a AnswerRecord),
    }
    let mut items: Vec<(i64, Item)> = d
        .segments
        .iter()
        .map(|s| (s.ts, Item::Seg(s)))
        .chain(d.answers.iter().map(|a| (a.created_at, Item::Ans(a))))
        .collect();
    items.sort_by_key(|(t, _)| *t);

    out.push_str("## Timeline\n\n");
    for (_, item) in items {
        match item {
            Item::Seg(s) => {
                let who = if s.speaker == Speaker::Me {
                    "Me"
                } else {
                    "Them"
                };
                out.push_str(&format!("**{who}:** {}\n\n", s.text));
            }
            Item::Ans(a) => {
                out.push_str(&format!(
                    "> **Fluke** ({}) — _{}_\n>\n{}\n\n",
                    a.model,
                    a.question.replace('\n', " "),
                    a.answer
                        .lines()
                        .map(|l| format!("> {l}"))
                        .collect::<Vec<_>>()
                        .join("\n")
                ));
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memories_are_scoped_to_profile_and_skip_unsummarized() {
        let db = Db::memory().unwrap();
        db.create_session("a", 1_000, "sales").unwrap();
        db.create_session("b", 2_000, "sales").unwrap();
        db.create_session("c", 3_000, "meeting").unwrap();
        db.create_session("d", 4_000, "sales").unwrap();
        db.set_summary("a", "first call", 10).unwrap();
        db.set_summary("b", "second call", 20).unwrap();
        db.set_summary("c", "other profile", 30).unwrap();

        let m = db.recent_memories("sales", 5, "").unwrap();
        assert_eq!(
            m.iter().map(|x| x.summary.as_str()).collect::<Vec<_>>(),
            ["second call", "first call"]
        );
        assert_eq!(db.recent_memories("sales", 1, "").unwrap().len(), 1);
        assert_eq!(db.recent_memories("sales", 5, "b").unwrap().len(), 1);
    }

    #[test]
    fn needs_summary_requires_content() {
        let db = Db::memory().unwrap();
        db.create_session("empty", 1, "p").unwrap();
        db.create_session("talky", 2, "p").unwrap();
        db.create_session("current", 3, "p").unwrap();
        for i in 0..4 {
            db.add_segment("talky", Speaker::Them, "hello", i).unwrap();
            db.add_segment("current", Speaker::Them, "hello", i)
                .unwrap();
        }
        assert_eq!(db.sessions_needing_summary("current").unwrap(), ["talky"]);
        db.set_summary("talky", "done", 5).unwrap();
        assert!(db.sessions_needing_summary("current").unwrap().is_empty());
    }

    #[test]
    fn docs_roundtrip_and_prune() {
        let db = Db::memory().unwrap();
        let d = db
            .add_doc("p1", "notes.md", "C:/notes.md", "héllo", 1)
            .unwrap();
        assert_eq!(d.chars, 5);
        db.add_doc("p2", "x.txt", "C:/x.txt", "x", 2).unwrap();
        assert_eq!(db.docs("p1").unwrap()[0].text, "héllo");
        db.prune_docs(&["p1".to_owned()]).unwrap();
        assert!(db.docs("p2").unwrap().is_empty());
        db.remove_doc(d.id).unwrap();
        assert!(db.docs("p1").unwrap().is_empty());
    }

    #[test]
    fn migration_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        migrate(&mut conn).unwrap();
        migrate(&mut conn).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v as usize, MIGRATIONS.len());
    }
}
