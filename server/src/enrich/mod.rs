//! AI enrichment (architecture.md §8): suggested translation, example, IPA and notes for a word, from an LLM behind
//! a trait (Anthropic in production, a fake in tests), limited by a daily quota per user. Suggestions are never
//! stored; the learner confirms them in the card editor.

use async_trait::async_trait;

pub mod anthropic;
pub mod dto;
pub mod handlers;
pub mod prompt;
pub mod service;

#[cfg(test)]
mod tests;

/// The two parts of a request to the model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnrichPrompt {
    /// Instructions: the role, the JSON format and the language-specific rules.
    pub system: String,
    /// The word itself.
    pub user: String,
}

#[derive(Debug, thiserror::Error)]
pub enum EnrichError {
    /// No answer within the provider timeout (10 s).
    #[error("provider timed out")]
    Timeout,
    /// The provider could not be reached or answered with an error. The message is for the log only.
    #[error("provider failed: {0}")]
    Provider(String),
}

/// A language model. It returns the raw text of the answer; parsing and the retry live in `service`, so they are
/// tested without a network. `Send + Sync` because one instance is shared by all requests through `AppState`.
#[async_trait]
pub trait Enricher: Send + Sync {
    async fn complete(&self, prompt: &EnrichPrompt) -> Result<String, EnrichError>;
}
