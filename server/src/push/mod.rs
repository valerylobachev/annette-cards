//! Daily study reminders over Web Push (architecture.md §11, UC-23): push subscriptions, the VAPID-signed sender
//! behind a trait (a fake in tests) and the minute task that picks whom to remind.

use async_trait::async_trait;

pub mod dto;
pub mod handlers;
pub mod reminders;
pub mod sender;
pub mod store;

#[cfg(test)]
mod tests;

/// A browser's push subscription as stored: where to send and the keys that encrypt the message for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Subscription {
    pub id: String,
    pub endpoint: String,
    /// The browser's P-256 public key (base64url, uncompressed point).
    pub p256dh: String,
    /// The browser's 16-byte auth secret (base64url).
    pub auth: String,
}

/// What the push service did with a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Delivery {
    Accepted,
    /// The subscription no longer exists (404 or 410): the caller deletes it.
    Gone,
}

#[derive(Debug, thiserror::Error)]
pub enum PushError {
    /// The stored keys cannot encrypt a message (they were checked on subscribe, so this is unexpected).
    #[error("invalid subscription: {0}")]
    InvalidSubscription(String),
    /// The push service could not be reached or answered with an error. The message is for the log only.
    #[error("push service failed: {0}")]
    Service(String),
}

/// Sends one encrypted message to one subscription. `Send + Sync` because one instance is shared through `AppState`
/// and the reminder task.
#[async_trait]
pub trait PushSender: Send + Sync {
    async fn send(
        &self,
        subscription: &Subscription,
        payload: &[u8],
    ) -> Result<Delivery, PushError>;
}
