use std::sync::Arc;

use axum::{Json, extract::State, http::StatusCode};
use axum_extra::extract::{
    CookieJar,
    cookie::{Cookie, SameSite},
};

use crate::{
    app::AppState,
    auth::{
        SESSION_COOKIE,
        dto::{ChangePasswordRequest, LoginRequest, MeResponse, RegisterRequest},
        extractor::CurrentUser,
        password, register, session, users,
    },
    clock::now_ms,
    error::{AppError, ErrorBody},
};

const MAX_DEVICE_LABEL_CHARS: usize = 100;

/// Signs in with email and password and sets the `ac_session` cookie.
#[utoipa::path(
    post,
    path = "/api/auth/login",
    tag = "auth",
    request_body = LoginRequest,
    responses(
        (status = 200, description = "Signed in; the response sets the session cookie", body = MeResponse),
        (status = 401, description = "`invalid_credentials`: unknown email or wrong password", body = ErrorBody),
        (status = 429, description = "`rate_limited`: more than 10 attempts a minute from this address",
            body = ErrorBody),
    )
)]
pub async fn login(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Json(request): Json<LoginRequest>,
) -> Result<(CookieJar, Json<MeResponse>), AppError> {
    let Some(user) = users::find_by_email(&state.pool, &request.email).await? else {
        password::verify_dummy_password(&request.password).await?;
        return Err(AppError::InvalidCredentials);
    };
    if !password::verify_password(&request.password, &user.password_hash).await? {
        return Err(AppError::InvalidCredentials);
    }

    let label = device_label(request.device_label);
    let ttl_ms = state.config.session_ttl_ms();
    let mut conn = state.pool.acquire().await?;
    let (token, _) =
        session::create_session(&mut conn, &user.id, label.as_deref(), now_ms(), ttl_ms).await?;
    Ok((jar.add(session_cookie(token, &state)), Json(user.into())))
}

/// Creates an account with an invite code and signs it in (sets the `ac_session` cookie like login).
#[utoipa::path(
    post,
    path = "/api/auth/register",
    tag = "auth",
    request_body = RegisterRequest,
    responses(
        (status = 200, description = "Registered and signed in; the response sets the session cookie",
            body = MeResponse),
        (status = 400, description = "`invite_invalid` (unknown or used code), `invite_expired`, \
            `password_too_short` or `validation_failed` (email, or display name empty or over 100 characters)",
            body = ErrorBody),
        (status = 409, description = "`email_taken`", body = ErrorBody),
        (status = 429, description = "`rate_limited`: more than 10 attempts a minute from this address",
            body = ErrorBody),
    )
)]
pub async fn register(
    State(state): State<Arc<AppState>>,
    jar: CookieJar,
    Json(mut request): Json<RegisterRequest>,
) -> Result<(CookieJar, Json<MeResponse>), AppError> {
    request.device_label = device_label(request.device_label.take());
    let ttl_ms = state.config.session_ttl_ms();
    let (user, token) = register::register(&state.pool, &request, now_ms(), ttl_ms).await?;
    Ok((jar.add(session_cookie(token, &state)), Json(user.into())))
}

/// Signs out: revokes the current session and clears the cookie.
#[utoipa::path(
    post,
    path = "/api/auth/logout",
    tag = "auth",
    security(("session" = [])),
    responses(
        (status = 204, description = "Signed out"),
        (status = 401, description = "`unauthorized`: no valid session", body = ErrorBody),
    )
)]
pub async fn logout(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), AppError> {
    session::revoke(&state.pool, &user.session_hash).await?;
    Ok((jar.add(removal_cookie()), StatusCode::NO_CONTENT))
}

/// Revokes all sessions of the user except the current one.
#[utoipa::path(
    post,
    path = "/api/auth/logout-others",
    tag = "auth",
    security(("session" = [])),
    responses(
        (status = 204, description = "Other sessions revoked"),
        (status = 401, description = "`unauthorized`: no valid session", body = ErrorBody),
    )
)]
pub async fn logout_others(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
) -> Result<StatusCode, AppError> {
    session::revoke_others(&state.pool, &user.user_id, &user.session_hash).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The signed-in user. Also renews the cookie's lifetime, which keeps the sliding session alive in the browser.
#[utoipa::path(
    get,
    path = "/api/auth/me",
    tag = "auth",
    security(("session" = [])),
    responses(
        (status = 200, description = "Current user", body = MeResponse),
        (status = 401, description = "`unauthorized`: no valid session", body = ErrorBody),
    )
)]
pub async fn me(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    jar: CookieJar,
) -> (CookieJar, Json<MeResponse>) {
    let jar = match jar.get(SESSION_COOKIE) {
        Some(cookie) => {
            let token = cookie.value().to_string();
            jar.add(session_cookie(token, &state))
        }
        None => jar,
    };
    (jar, Json(user.into()))
}

/// Changes the password and signs out all other sessions.
#[utoipa::path(
    post,
    path = "/api/auth/password",
    tag = "auth",
    security(("session" = [])),
    request_body = ChangePasswordRequest,
    responses(
        (status = 204, description = "Password changed; other sessions revoked"),
        (status = 400, description = "`invalid_credentials` (wrong current password) or `password_too_short`",
            body = ErrorBody),
        (status = 401, description = "`unauthorized`: no valid session", body = ErrorBody),
    )
)]
pub async fn change_password(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Json(request): Json<ChangePasswordRequest>,
) -> Result<StatusCode, AppError> {
    password::check_password_policy(&request.new_password)?;
    let stored = users::find_by_id(&state.pool, &user.user_id)
        .await?
        .ok_or(AppError::Unauthorized)?;
    if !password::verify_password(&request.current_password, &stored.password_hash).await? {
        return Err(AppError::BadRequest("invalid_credentials"));
    }

    let new_hash = password::hash_password(&request.new_password).await?;
    users::update_password_hash(&state.pool, &user.user_id, &new_hash).await?;
    session::revoke_others(&state.pool, &user.user_id, &user.session_hash).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Trimmed, at most 100 characters, `None` when blank.
fn device_label(label: Option<String>) -> Option<String> {
    label
        .map(|label| {
            label
                .trim()
                .chars()
                .take(MAX_DEVICE_LABEL_CHARS)
                .collect::<String>()
        })
        .filter(|label| !label.is_empty())
}

/// `ac_session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=<ttl>`. JavaScript cannot read it, and
/// browsers send it only to this origin.
fn session_cookie(token: String, state: &AppState) -> Cookie<'static> {
    let max_age = cookie::time::Duration::days(i64::from(state.config.session_ttl_days));
    base_cookie(token).max_age(max_age).build()
}

/// An expired, empty `ac_session` cookie that makes the browser delete it.
fn removal_cookie() -> Cookie<'static> {
    base_cookie(String::new()).removal().build()
}

fn base_cookie(value: String) -> cookie::CookieBuilder<'static> {
    Cookie::build((SESSION_COOKIE, value))
        .http_only(true)
        .secure(true)
        .same_site(SameSite::Strict)
        .path("/")
}
