//! OpenAI-compatible `/chat/completions` (OpenAI, Groq, OpenRouter, DeepSeek, xAI, Mistral,
//! Ollama, LM Studio, vLLM, ...).

use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde_json::{Value, json};

use super::{ChatRequest, LlmClient, Part, Role, TextStream};
use crate::error::{AppError, Result};

fn message_json(role: &str, msg: &super::Message) -> Value {
    // Plain-string content is the most widely supported shape; only use the
    // content-parts array when there is an image to send.
    if !msg.has_images() {
        return json!({ "role": role, "content": msg.text() });
    }
    let parts: Vec<Value> = msg
        .parts
        .iter()
        .map(|p| match p {
            Part::Text(t) => json!({ "type": "text", "text": t }),
            Part::Image { mime, data_b64 } => json!({
                "type": "image_url",
                "image_url": { "url": format!("data:{mime};base64,{data_b64}") }
            }),
        })
        .collect();
    json!({ "role": role, "content": parts })
}

pub async fn stream(client: &LlmClient, req: ChatRequest) -> Result<TextStream> {
    let mut messages = vec![json!({ "role": "system", "content": req.system })];
    for m in &req.messages {
        let role = match m.role {
            Role::User => "user",
            Role::Assistant => "assistant",
        };
        messages.push(message_json(role, m));
    }
    let mut body = json!({
        "model": req.model,
        "stream": true,
        "messages": messages,
    });
    client.apply_extra_body(&mut body);

    let mut rb = client
        .http
        .post(format!("{}/chat/completions", client.base()))
        .headers(client.extra_headers())
        .json(&body);
    if !client.key().is_empty() {
        rb = rb.bearer_auth(client.key());
    }
    let resp = client.check(rb.send().await?).await?;
    let label = client.provider.label.clone();

    let stream = resp
        .bytes_stream()
        .eventsource()
        .take_while(|ev| {
            let done = matches!(ev, Ok(e) if e.data.trim() == "[DONE]");
            futures_util::future::ready(!done)
        })
        .filter_map(move |ev| {
            let label = label.clone();
            async move {
                let ev = match ev {
                    Ok(ev) => ev,
                    Err(e) => {
                        return Some(Err(AppError::msg(format!("{label} stream error: {e}"))));
                    }
                };
                let v: Value = match serde_json::from_str(&ev.data) {
                    Ok(v) => v,
                    Err(_) => return None, // keep-alive comments etc.
                };
                if let Some(err) = v.get("error") {
                    let msg = err
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown error")
                        .to_owned();
                    return Some(Err(AppError::msg(format!("{label}: {msg}"))));
                }
                v.pointer("/choices/0/delta/content")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .map(|s| Ok(s.to_owned()))
            }
        });
    Ok(Box::pin(stream))
}

pub async fn list_models(client: &LlmClient) -> Result<Vec<String>> {
    let mut rb = client
        .http
        .get(format!("{}/models", client.base()))
        .headers(client.extra_headers());
    if !client.key().is_empty() {
        rb = rb.bearer_auth(client.key());
    }
    let resp = client.check(rb.send().await?).await?;
    let v: Value = resp.json().await?;
    Ok(v.get("data")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_owned))
                .collect()
        })
        .unwrap_or_default())
}
