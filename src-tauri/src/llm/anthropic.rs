//! Anthropic Messages API (`POST /v1/messages`, SSE streaming).

use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde_json::{Value, json};

use super::{ChatRequest, LlmClient, Part, Role, TextStream};
use crate::error::{AppError, Result};

const API_VERSION: &str = "2023-06-01";

pub async fn stream(client: &LlmClient, req: ChatRequest) -> Result<TextStream> {
    let messages: Vec<Value> = req
        .messages
        .iter()
        .map(|m| {
            let role = match m.role {
                Role::User => "user",
                Role::Assistant => "assistant",
            };
            // Images first, then text: Claude reads the screen before the question.
            let mut content: Vec<Value> = Vec::new();
            for p in &m.parts {
                if let Part::Image { mime, data_b64 } = p {
                    content.push(json!({
                        "type": "image",
                        "source": { "type": "base64", "media_type": mime, "data": data_b64 }
                    }));
                }
            }
            for p in &m.parts {
                if let Part::Text(t) = p {
                    content.push(json!({ "type": "text", "text": t }));
                }
            }
            json!({ "role": role, "content": content })
        })
        .collect();

    let mut body = json!({
        "model": req.model,
        "max_tokens": req.max_tokens,
        "stream": true,
        // The system prompt carries the stable context (profile, documents, meeting notes);
        // caching it makes every follow-up question in a meeting cheaper and faster.
        "system": [{
            "type": "text",
            "text": req.system,
            "cache_control": { "type": "ephemeral" }
        }],
        "messages": messages,
    });
    if let Some(effort) = req.effort.as_deref().filter(|e| !e.is_empty()) {
        body["output_config"] = json!({ "effort": effort });
    }
    client.apply_extra_body(&mut body);

    let resp = client
        .http
        .post(format!("{}/v1/messages", client.base()))
        .headers(client.extra_headers())
        .header("x-api-key", client.key())
        .header("anthropic-version", API_VERSION)
        .json(&body)
        .send()
        .await?;
    let resp = client.check(resp).await?;

    let stream = resp.bytes_stream().eventsource().filter_map(|ev| async move {
        let ev = match ev {
            Ok(ev) => ev,
            Err(e) => return Some(Err(AppError::msg(format!("Anthropic stream error: {e}")))),
        };
        let v: Value = serde_json::from_str(&ev.data).ok()?;
        match v.get("type").and_then(Value::as_str) {
            Some("content_block_delta") => {
                // Only visible text; thinking deltas are skipped.
                if v.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") {
                    v.pointer("/delta/text")
                        .and_then(Value::as_str)
                        .map(|s| Ok(s.to_owned()))
                } else {
                    None
                }
            }
            Some("message_delta") => match v.pointer("/delta/stop_reason").and_then(Value::as_str) {
                Some("refusal") => Some(Err(AppError::msg(
                    "Claude declined to answer this one (refusal). Try rephrasing or another model.",
                ))),
                Some("max_tokens") => Some(Ok(
                    "\n\n_(answer cut off: max output tokens reached — raise it in Settings)_".into(),
                )),
                _ => None,
            },
            Some("error") => {
                let msg = v
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown error");
                Some(Err(AppError::msg(format!("Anthropic: {msg}"))))
            }
            _ => None,
        }
    });
    Ok(Box::pin(stream))
}

pub async fn list_models(client: &LlmClient) -> Result<Vec<String>> {
    let resp = client
        .http
        .get(format!("{}/v1/models?limit=1000", client.base()))
        .headers(client.extra_headers())
        .header("x-api-key", client.key())
        .header("anthropic-version", API_VERSION)
        .send()
        .await?;
    let v: Value = client.check(resp).await?.json().await?;
    Ok(v.get("data")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default())
}
