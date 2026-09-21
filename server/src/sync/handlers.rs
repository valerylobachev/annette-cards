use std::sync::Arc;

use axum::{Json, extract::State};

use crate::{
    app::AppState,
    auth::extractor::CurrentUser,
    clock::now_ms,
    error::{AppError, ErrorBody},
    json::AppJson,
    sync::{
        dto::{PushRequest, PushResponse},
        push,
    },
};

/// Largest accepted push body (architecture.md §9): 500 rows with long texts fit easily.
pub const PUSH_BODY_LIMIT: usize = 2 * 1024 * 1024;

/// Uploads local changes: each row is applied, skipped (the server's row wins last-write-wins) or rejected.
#[utoipa::path(
    post,
    path = "/api/sync/push",
    tag = "sync",
    security(("session" = [])),
    request_body = PushRequest,
    responses(
        (status = 200, description = "Every row is listed in `applied`, `skipped` or `rejected`", body = PushResponse),
        (status = 400, description = "`validation_failed`: malformed body or more than 500 rows", body = ErrorBody),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 413, description = "`payload_too_large`: body over 2 MB", body = ErrorBody),
    )
)]
pub async fn push(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    AppJson(request): AppJson<PushRequest>,
) -> Result<Json<PushResponse>, AppError> {
    tracing::debug!(device_id = %request.device_id, rows = request.changes.row_count(), "push");
    let response = push::push(&state.pool, &user.user_id, &request.changes, now_ms()).await?;
    if !response.rejected.is_empty() {
        let codes: Vec<&str> = response
            .rejected
            .iter()
            .map(|row| row.code.as_str())
            .collect();
        tracing::warn!(?codes, "push rows rejected");
    }
    Ok(Json(response))
}
