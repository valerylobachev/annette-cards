use std::sync::Arc;

use axum::{extract::State, http::StatusCode};

use crate::{
    app::AppState,
    auth::extractor::CurrentUser,
    clock::now_ms,
    error::{AppError, ErrorBody},
    json::AppJson,
    push::{
        dto::{PushSubscriptionDto, UnsubscribeRequest},
        store,
    },
};

/// Stores this browser's push subscription for the daily reminder. Subscribing the same endpoint again replaces
/// its keys (and moves it to the current user when another account had it).
#[utoipa::path(
    post,
    path = "/api/push/subscribe",
    tag = "push",
    security(("session" = [])),
    request_body = PushSubscriptionDto,
    responses(
        (status = 204, description = "Stored"),
        (status = 400, description = "`validation_failed`: not a known push service or malformed keys",
            body = ErrorBody),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 409, description = "`push_disabled`: no VAPID keys on this server", body = ErrorBody),
    )
)]
pub async fn subscribe(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    AppJson(subscription): AppJson<PushSubscriptionDto>,
) -> Result<StatusCode, AppError> {
    require_push(&state)?;
    let subscription = subscription.validated()?;
    store::upsert(&state.pool, &user.user_id, &subscription, now_ms()).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Removes this browser's subscription (reminders turned off, or sign-out).
#[utoipa::path(
    delete,
    path = "/api/push/subscribe",
    tag = "push",
    security(("session" = [])),
    request_body = UnsubscribeRequest,
    responses(
        (status = 204, description = "Removed"),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 404, description = "`not_found`: the user has no subscription with this endpoint",
            body = ErrorBody),
        (status = 409, description = "`push_disabled`: no VAPID keys on this server", body = ErrorBody),
    )
)]
pub async fn unsubscribe(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    AppJson(request): AppJson<UnsubscribeRequest>,
) -> Result<StatusCode, AppError> {
    require_push(&state)?;
    if store::delete(&state.pool, &user.user_id, &request.endpoint).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(AppError::NotFound)
    }
}

fn require_push(state: &AppState) -> Result<(), AppError> {
    state
        .push
        .as_ref()
        .map(|_| ())
        .ok_or(AppError::Conflict("push_disabled"))
}
