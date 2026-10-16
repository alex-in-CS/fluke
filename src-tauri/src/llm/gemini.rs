//! Google Gemini API (`streamGenerateContent?alt=sse`).

use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde_json::{Value, json};

use super::{ChatRequest, LlmClient, Part, Role, TextStream};
use crate::error::{AppError, Result};

pub async fn stream(client: &LlmClient, req: ChatRequest) -> Result<TextStream> {
    let contents: Vec<Value> = req
        .messages
        .iter()
        .map(|m| {
            let role = match m.role {
                Role::User => "user",
                Role::Assistant => "model",
            };
            let parts: Vec<Value> = m
                .parts
                .iter()
                .map(|p| match p {
                    Part::Text(t) => json!({ "text": t }),
                    Part::Image { mime, data_b64 } => {
                        json!({ "inlineData": { "mimeType": mime, "data": data_b64 } })
                    }
                })
                .collect();
            json!({ "role": role, "parts": parts })
        })
        .collect();

    let mut body = json!({
        "systemInstruction": { "parts": [{ "text": req.system }] },
        "contents": contents,
        "generationConfig": { "maxOutputTokens": req.max_tokens },
    });
    client.apply_extra_body(&mut body);

    let model = req.model.trim_start_matches("models/");
    let resp = client
        .http
        .post(format!(
            "{}/v1beta/models/{model}:streamGenerateContent?alt=sse",
            client.base()
        ))
        .headers(client.extra_headers())
        .header("x-goog-api-key", client.key())
        .json(&body)
        .send()
        .await?;
    let resp = client.check(resp).await?;

    let stream = resp
        .bytes_stream()
        .eventsource()
        .filter_map(|ev| async move {
            let ev = match ev {
                Ok(ev) => ev,
                Err(e) => return Some(Err(AppError::msg(format!("Gemini stream error: {e}")))),
            };
            let v: Value = serde_json::from_str(&ev.data).ok()?;
            if let Some(msg) = v.pointer("/error/message").and_then(Value::as_str) {
                return Some(Err(AppError::msg(format!("Gemini: {msg}"))));
            }
            if let Some(reason) = v
                .pointer("/promptFeedback/blockReason")
                .and_then(Value::as_str)
            {
                return Some(Err(AppError::msg(format!(
                    "Gemini blocked the request ({reason})"
                ))));
            }
            let text: String = v
                .pointer("/candidates/0/content/parts")
                .and_then(Value::as_array)
                .map(|parts| {
                    parts
                        .iter()
                        // Skip thought summaries; keep visible text only.
                        .filter(|p| !p.get("thought").and_then(Value::as_bool).unwrap_or(false))
                        .filter_map(|p| p.get("text").and_then(Value::as_str))
                        .collect()
                })
                .unwrap_or_default();
            (!text.is_empty()).then_some(Ok(text))
        });
    Ok(Box::pin(stream))
}

pub async fn list_models(client: &LlmClient) -> Result<Vec<String>> {
    let resp = client
        .http
        .get(format!("{}/v1beta/models?pageSize=1000", client.base()))
        .headers(client.extra_headers())
        .header("x-goog-api-key", client.key())
        .send()
        .await?;
    let v: Value = client.check(resp).await?.json().await?;
    Ok(v.get("models")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter(|m| {
                    m.get("supportedGenerationMethods")
                        .and_then(Value::as_array)
                        .is_some_and(|ms| ms.iter().any(|x| x.as_str() == Some("generateContent")))
                })
                .filter_map(|m| m.get("name").and_then(Value::as_str))
                .map(|n| n.trim_start_matches("models/").to_owned())
                .collect()
        })
        .unwrap_or_default())
}
