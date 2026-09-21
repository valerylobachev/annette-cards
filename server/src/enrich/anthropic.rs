//! Anthropic Messages API (https://docs.anthropic.com/en/api/messages).

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

use crate::{
    config::Secret,
    enrich::{EnrichError, EnrichPrompt, Enricher},
};

const MESSAGES_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
/// A suggestion is a small JSON object; this leaves room for long notes in Cyrillic.
const MAX_TOKENS: u32 = 800;

pub struct AnthropicEnricher {
    client: reqwest::Client,
    key: Secret,
    model: String,
}

impl AnthropicEnricher {
    /// `client` is the app's shared HTTP client (connection pool, 10 s timeout).
    pub fn new(client: reqwest::Client, key: Secret, model: String) -> Self {
        Self { client, key, model }
    }
}

#[derive(Serialize)]
struct MessagesRequest<'a> {
    model: &'a str,
    max_tokens: u32,
    system: &'a str,
    messages: [Message<'a>; 1],
}

#[derive(Serialize)]
struct Message<'a> {
    role: &'static str,
    content: &'a str,
}

/// Only the parts of the answer that are used; other fields are ignored.
#[derive(Deserialize)]
struct MessagesResponse {
    content: Vec<ContentBlock>,
}

#[derive(Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    text: String,
}

#[async_trait]
impl Enricher for AnthropicEnricher {
    async fn complete(&self, prompt: &EnrichPrompt) -> Result<String, EnrichError> {
        let body = MessagesRequest {
            model: &self.model,
            max_tokens: MAX_TOKENS,
            system: &prompt.system,
            messages: [Message {
                role: "user",
                content: &prompt.user,
            }],
        };
        let response = self
            .client
            .post(MESSAGES_URL)
            .header("x-api-key", self.key.expose())
            .header("anthropic-version", API_VERSION)
            .json(&body)
            .send()
            .await
            .map_err(request_error)?;

        let status = response.status();
        if !status.is_success() {
            return Err(EnrichError::Provider(format!(
                "anthropic answered {status}"
            )));
        }
        let answer: MessagesResponse = response.json().await.map_err(request_error)?;
        Ok(text_of(answer))
    }
}

/// The text blocks of an answer, joined.
fn text_of(answer: MessagesResponse) -> String {
    answer
        .content
        .into_iter()
        .filter(|block| block.kind == "text")
        .map(|block| block.text)
        .collect()
}

fn request_error(error: reqwest::Error) -> EnrichError {
    if error.is_timeout() {
        EnrichError::Timeout
    } else {
        EnrichError::Provider(error.without_url().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_body_matches_the_messages_api() {
        let body = MessagesRequest {
            model: "claude-haiku-4-5",
            max_tokens: MAX_TOKENS,
            system: "rules",
            messages: [Message {
                role: "user",
                content: "Word: kot",
            }],
        };
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            serde_json::json!({
                "model": "claude-haiku-4-5",
                "max_tokens": 800,
                "system": "rules",
                "messages": [{ "role": "user", "content": "Word: kot" }],
            })
        );
    }

    #[test]
    fn answer_text_joins_the_text_blocks() {
        let answer: MessagesResponse = serde_json::from_value(serde_json::json!({
            "id": "msg_01",
            "type": "message",
            "role": "assistant",
            "model": "claude-haiku-4-5",
            "content": [
                { "type": "text", "text": "{\"back\": " },
                { "type": "thinking", "thinking": "…" },
                { "type": "text", "text": "\"кот\"}" },
            ],
            "stop_reason": "end_turn",
            "usage": { "input_tokens": 10, "output_tokens": 5 },
        }))
        .unwrap();
        assert_eq!(text_of(answer), "{\"back\": \"кот\"}");
    }
}
