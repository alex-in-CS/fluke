//! Profile context files: extract plain text locally from documents the user attaches.
//! Files stay linked: if one changes on disk, the next answer picks up the new text.

use std::io::Read;
use std::path::Path;

use crate::error::{AppError, Result};
use crate::storage::{ContextDoc, Db};

/// Per-document cap (~100k tokens). Keeps one huge PDF from swamping every request.
pub const MAX_DOC_CHARS: usize = 400_000;

const TEXT_EXTS: &[&str] = &[
    "txt", "md", "markdown", "mdx", "csv", "tsv", "json", "jsonl", "log", "yaml", "yml", "toml",
    "xml", "html", "htm", "rst", "org", "tex", "ini", "sql", "py", "js", "ts", "tsx", "rs", "go",
    "java", "kt", "c", "cpp", "h", "cs", "rb", "php", "swift", "sh", "ps1",
];

pub const SUPPORTED: &str = "Text, Markdown, PDF, Word (.docx), CSV, JSON and source files";

fn ext(path: &Path) -> String {
    path.extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

pub fn extract(path: &Path) -> Result<String> {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
    let raw = match ext(path).as_str() {
        "pdf" => pdf_extract::extract_text(path)
            .map_err(|e| AppError::msg(format!("{name}: couldn't read PDF ({e})")))?,
        "docx" => docx_text(path)
            .map_err(|e| AppError::msg(format!("{name}: couldn't read .docx ({e})")))?,
        e if TEXT_EXTS.contains(&e) => {
            let bytes = std::fs::read(path)?;
            String::from_utf8_lossy(&bytes).into_owned()
        }
        "doc" => {
            return Err(AppError::msg(format!(
                "{name}: old .doc files aren't supported; save it as .docx or PDF"
            )));
        }
        _ => {
            return Err(AppError::msg(format!(
                "{name}: unsupported file type. Supported: {SUPPORTED}"
            )));
        }
    };
    let text = normalize(&raw);
    if text.trim().is_empty() {
        return Err(AppError::msg(format!(
            "{name}: no text found (scanned PDFs need OCR first)"
        )));
    }
    Ok(truncate(text))
}

fn truncate(text: String) -> String {
    if text.chars().count() <= MAX_DOC_CHARS {
        return text;
    }
    let mut t: String = text.chars().take(MAX_DOC_CHARS).collect();
    t.push_str("\n\n[… truncated: document too long]");
    t
}

/// Collapse runs of blank lines and trailing spaces left by PDF/DOCX extraction.
fn normalize(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut blank = 0;
    for line in raw.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim().to_owned()
}

fn docx_text(path: &Path) -> std::result::Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut xml = String::new();
    zip.by_name("word/document.xml")
        .map_err(|e| e.to_string())?
        .read_to_string(&mut xml)
        .map_err(|e| e.to_string())?;
    Ok(docx_xml_to_text(&xml))
}

/// Minimal WordprocessingML → text: paragraphs become lines, tabs and breaks are kept.
fn docx_xml_to_text(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len() / 4);
    let mut i = 0;
    let bytes = xml.as_bytes();
    while i < bytes.len() {
        if bytes[i] == b'<' {
            let end = xml[i..].find('>').map(|e| i + e).unwrap_or(bytes.len() - 1);
            let tag = &xml[i + 1..end];
            let name = tag
                .trim_start_matches('/')
                .split([' ', '/'])
                .next()
                .unwrap_or("");
            match name {
                "w:p" if tag.starts_with('/') => out.push('\n'),
                "w:tab" => out.push('\t'),
                "w:br" | "w:cr" => out.push('\n'),
                _ => {}
            }
            i = end + 1;
        } else {
            let next = xml[i..].find('<').map(|n| i + n).unwrap_or(bytes.len());
            out.push_str(&unescape(&xml[i..next]));
            i = next;
        }
    }
    out
}

fn unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

fn modified_ms(path: &Path) -> Option<i64> {
    let m = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(m.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as i64)
}

/// Re-extract any linked file that changed on disk since it was added. Returns fresh docs.
/// Missing files keep their last extracted text.
pub fn sync(db: &Db, docs: Vec<ContextDoc>) -> Vec<ContextDoc> {
    docs.into_iter()
        .map(|mut d| {
            let path = Path::new(&d.path);
            if let Some(mtime) = modified_ms(path)
                && mtime > d.added_at
            {
                match extract(path) {
                    Ok(text) => {
                        let now = crate::state::now_ms();
                        let _ = db.update_doc_text(d.id, &text, now);
                        d.chars = text.chars().count() as i64;
                        d.text = text;
                        d.added_at = now;
                    }
                    Err(e) => tracing::warn!("refresh {}: {e}", d.name),
                }
            }
            d
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn docx_paragraphs_and_entities() {
        let xml = r#"<w:document><w:body><w:p><w:r><w:t>Q3 plan</w:t></w:r></w:p><w:p><w:r><w:t>A &amp; B</w:t><w:tab/><w:t>&lt;ok&gt;</w:t></w:r></w:p></w:body></w:document>"#;
        assert_eq!(normalize(&docx_xml_to_text(xml)), "Q3 plan\nA & B\t<ok>");
    }

    #[test]
    fn normalize_collapses_blank_runs() {
        assert_eq!(normalize("a  \r\n\r\n\r\n\r\nb\n"), "a\n\nb");
    }

    #[test]
    fn extracts_text_files_and_rejects_unknown() {
        let dir = std::env::temp_dir().join(format!("fluke-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let md = dir.join("notes.md");
        std::fs::write(&md, "# Notes\n\n\n\n- ship it").unwrap();
        assert_eq!(extract(&md).unwrap(), "# Notes\n\n- ship it");
        let bin = dir.join("x.exe");
        std::fs::write(&bin, [0u8, 1, 2]).unwrap();
        assert!(extract(&bin).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
