use std::sync::Arc;

use axum::{extract::FromRequestParts, http::request::Parts};
use axum_extra::extract::CookieJar;
use sha2::{Digest, Sha256};

use crate::{
    app::AppState,
    auth::{SESSION_COOKIE, session, users::User},
    clock::now_ms,
    error::AppError,
};

/// The user behind the request's session cookie. Adding `user: CurrentUser` to a handler's arguments makes the
/// route require sign-in: without a valid, unexpired session the handler never runs and the client gets
/// 401 `unauthorized`.
#[derive(Debug, Clone)]
pub struct CurrentUser {
    pub user_id: String,
    pub email: String,
    pub display_name: String,
    pub is_admin: bool,
    pub created_at: i64,
    /// Identifies the current session (logout, "sign out other devices").
    pub session_hash: String,
}

impl CurrentUser {
    fn new(user: User, session_hash: String) -> Self {
        Self {
            user_id: user.id,
            email: user.email,
            display_name: user.display_name,
            is_admin: user.is_admin,
            created_at: user.created_at,
            session_hash,
        }
    }
}

impl FromRequestParts<Arc<AppState>> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, AppError> {
        let jar = CookieJar::from_headers(&parts.headers);
        let token = jar
            .get(SESSION_COOKIE)
            .ok_or(AppError::Unauthorized)?
            .value();

        let now = now_ms();
        let (user, found) = session::find_user_by_token(&state.pool, token, now)
            .await?
            .ok_or(AppError::Unauthorized)?;
        if session::needs_touch(&found, now) {
            session::touch(
                &state.pool,
                &found.token_hash,
                now,
                state.config.session_ttl_ms(),
            )
            .await?;
        }
        tracing::Span::current().record("user", user_log_id(&user.id));
        Ok(Self::new(user, found.token_hash))
    }
}

/// A signed-in admin. Built on `CurrentUser`: first the session is checked (401 `unauthorized`), then the role
/// (403 `forbidden`).
#[derive(Debug, Clone)]
pub struct AdminUser(pub CurrentUser);

impl FromRequestParts<Arc<AppState>> for AdminUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, AppError> {
        let user = CurrentUser::from_request_parts(parts, state).await?;
        if !user.is_admin {
            return Err(AppError::Forbidden);
        }
        Ok(Self(user))
    }
}

/// How a user appears in logs: the first 12 hex characters of `sha256(user_id)`. Enough to follow one user's
/// requests without writing the id or email into the log.
pub fn user_log_id(user_id: &str) -> String {
    Sha256::digest(user_id.as_bytes())
        .iter()
        .take(6)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
