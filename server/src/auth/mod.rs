//! Accounts and sessions: password hashing, the session cookie, the `CurrentUser` extractor and `/api/auth/*`.

pub mod dto;
pub mod extractor;
pub mod handlers;
pub mod password;
pub mod session;
pub mod users;

use std::time::Duration;

use sqlx::SqlitePool;

use crate::clock::now_ms;

/// Name of the session cookie (architecture.md §9).
pub const SESSION_COOKIE: &str = "ac_session";

/// Deletes expired sessions once an hour (architecture.md §11). The pool is cloned into the task: a pool is a
/// cheap handle to shared connections, and the task must own what it uses because it outlives this function.
pub fn spawn_session_cleanup(pool: SqlitePool) {
    tokio::spawn(async move {
        let mut hourly = tokio::time::interval(Duration::from_secs(60 * 60));
        loop {
            // The first tick completes immediately, so a cleanup also runs at startup.
            hourly.tick().await;
            match session::delete_expired(&pool, now_ms()).await {
                Ok(count) => tracing::info!(count, "expired sessions deleted"),
                Err(err) => tracing::warn!(error = %err, "session cleanup failed"),
            }
        }
    });
}

#[cfg(test)]
mod tests;
