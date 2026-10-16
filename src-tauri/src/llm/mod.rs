//! Provider-agnostic chat streaming. Each adapter turns a [`ChatRequest`] into the provider's
//! wire format and yields plain text deltas.

mod anthropic;
mod gemini;
mod openai;

use std::pin::Pin;

use futures_util::Stream;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

use crate::config::{ProviderConfig, ProviderKind};
use crate::error::{AppError, Result, provider_error};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    User,
    #[allow(dead_code)] // follow-up turns
    Assistant,
}

#[derive(Debug, Clone)]
pub enum Part {
    Text(String),
    Image { mime: String, data_b64: String },
}

#[derive(Debug, Clone)]
pub struct Message {
    pub role: Role,
    pub parts: Vec<Part>,
}

impl Message {
    pub fn has_images(&self) -> bool {
        self.parts.iter().any(|p| matches!(p, Part::Image { .. }))
    }

    pub fn text(&self) -> String {
        self.parts
            .iter()
            .filter_map(|p| match p {
                Part::Text(t) => Some(t.as_str()),
                Part::Image { .. } => None,
            })
            .collect::<Vec<_>>()
            .join("\n\n")
    }
}

#[derive(Debug, Clone)]
pub struct ChatRequest {
    pub model: String,
    pub system: String,
    pub messages: Vec<Message>,
    pub max_tokens: u32,
    /// Anthropic only: `output_config.effort`.
    pub effort: Option<String>,
}

pub type TextStream = Pin<Box<dyn Stream<Item = Result<String>> + Send>>;

/// A configured provider plus its key, ready to make requests.
pub struct LlmClient {
    pub provider: ProviderConfig,
    pub api_key: Option<String>,
    pub http: reqwest::Client,
}

impl LlmClient {
    pub fn new(
        provider: ProviderConfig,
        api_key: Option<String>,
        http: reqwest::Client,
    ) -> Result<Self> {
        if provider.needs_key && api_key.as_deref().unwrap_or("").is_empty() {
            return Err(AppError::MissingKey(provider.id.clone()));
        }
        Ok(Self {
            provider,
            api_key,
            http,
        })
    }

    pub async fn stream(&self, req: ChatRequest) -> Result<TextStream> {
        match self.provider.kind {
            ProviderKind::OpenaiCompat => openai::stream(self, req).await,
            ProviderKind::Anthropic => anthropic::stream(self, req).await,
            ProviderKind::Gemini => gemini::stream(self, req).await,
            ProviderKind::Deepgram => Err(AppError::msg(format!(
                "{} is a speech-to-text provider and can't answer questions",
                self.provider.label
            ))),
        }
    }

    /// Lists model ids. Doubles as a "test this key" call.
    pub async fn list_models(&self) -> Result<Vec<String>> {
        let mut models = match self.provider.kind {
            ProviderKind::OpenaiCompat => openai::list_models(self).await?,
            ProviderKind::Anthropic => anthropic::list_models(self).await?,
            ProviderKind::Gemini => gemini::list_models(self).await?,
            ProviderKind::Deepgram => crate::stt::deepgram_list_models(self).await?,
        };
        models.sort();
        models.dedup();
        Ok(models)
    }

    pub(crate) fn base(&self) -> &str {
        self.provider.base_url.trim_end_matches('/')
    }

    pub(crate) fn key(&self) -> &str {
        self.api_key.as_deref().unwrap_or("")
    }

    pub(crate) fn extra_headers(&self) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (k, v) in &self.provider.extra_headers {
            if let (Ok(name), Ok(value)) =
                (HeaderName::try_from(k.as_str()), HeaderValue::from_str(v))
            {
                map.insert(name, value);
            }
        }
        map
    }

    /// Merge the provider's `extra_body` object into a request body.
    pub(crate) fn apply_extra_body(&self, body: &mut serde_json::Value) {
        if let (Some(serde_json::Value::Object(extra)), Some(obj)) =
            (&self.provider.extra_body, body.as_object_mut())
        {
            for (k, v) in extra {
                obj.insert(k.clone(), v.clone());
            }
        }
    }

    /// Turn a non-2xx response into a readable error.
    pub(crate) async fn check(&self, resp: reqwest::Response) -> Result<reqwest::Response> {
        let status = resp.status();
        if status.is_success() {
            return Ok(resp);
        }
        let body = resp.text().await.unwrap_or_default();
        Err(provider_error(&self.provider.label, status.as_u16(), &body))
    }
}
