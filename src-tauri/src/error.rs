use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),

    #[error("no API key saved for provider '{0}'")]
    MissingKey(String),

    #[error("unknown provider '{0}'")]
    UnknownProvider(String),

    #[error("{provider} returned HTTP {status}: {message}")]
    Provider {
        provider: String,
        status: u16,
        message: String,
    },

    #[error("network error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("keychain error: {0}")]
    Keyring(String),

    #[error("audio error: {0}")]
    Audio(String),

    #[error("screen capture error: {0}")]
    Capture(String),

    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

impl AppError {
    pub fn msg(m: impl Into<String>) -> Self {
        AppError::Msg(m.into())
    }
}

// Commands return errors to the webview as plain strings.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T, E = AppError> = std::result::Result<T, E>;

/// Pull a human-readable message out of a provider's JSON error body.
/// Handles the OpenAI / Anthropic / Gemini / Deepgram shapes; falls back to the raw body.
pub fn provider_error(provider: &str, status: u16, body: &str) -> AppError {
    let parsed: Option<serde_json::Value> = serde_json::from_str(body).ok();
    let message = parsed
        .as_ref()
        .and_then(|v| {
            v.pointer("/error/message")
                .or_else(|| v.pointer("/err_msg"))
                .or_else(|| v.pointer("/message"))
                .or_else(|| v.pointer("/error"))
                .and_then(|m| m.as_str().map(str::to_owned))
        })
        .unwrap_or_else(|| {
            let trimmed = body.trim();
            if trimmed.is_empty() {
                "empty response".to_owned()
            } else {
                trimmed.chars().take(400).collect()
            }
        });
    AppError::Provider {
        provider: provider.to_owned(),
        status,
        message,
    }
}
