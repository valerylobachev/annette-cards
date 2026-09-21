use std::sync::Arc;

use axum::{
    Json,
    extract::{Query, State},
    http::header,
};

use crate::{
    app::AppState,
    auth::extractor::CurrentUser,
    clock::now_ms,
    error::{AppError, ErrorBody},
    json::AppJson,
    sync::{
        backup,
        dto::{
            Backup, PullParams, PullResponse, PushRequest, PushResponse, RestoreResponse,
            SummaryResponse,
        },
        pull, push,
    },
};

/// Largest accepted push body (architecture.md §9): 500 rows with long texts fit easily.
pub const PUSH_BODY_LIMIT: usize = 2 * 1024 * 1024;
/// Largest accepted backup for restore: a whole account in one request.
pub const RESTORE_BODY_LIMIT: usize = 20 * 1024 * 1024;

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

/// Downloads the user's rows changed after `cursor`, in `server_seq` order; repeat with the returned cursor while
/// `has_more`.
#[utoipa::path(
    get,
    path = "/api/sync/pull",
    tag = "sync",
    security(("session" = [])),
    params(PullParams),
    responses(
        (status = 200, description = "One page of changes", body = PullResponse),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
    )
)]
pub async fn pull(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Query(params): Query<PullParams>,
) -> Result<Json<PullResponse>, AppError> {
    let cursor = params.cursor.unwrap_or(0);
    let limit = params.limit.unwrap_or(pull::DEFAULT_PULL_LIMIT);
    Ok(Json(
        pull::pull(&state.pool, &user.user_id, cursor, limit).await?,
    ))
}

/// Counts of the account's decks and cards, for the first sign-in choice (S-03).
#[utoipa::path(
    get,
    path = "/api/sync/summary",
    tag = "sync",
    security(("session" = [])),
    responses(
        (status = 200, description = "Decks and cards that are not deleted", body = SummaryResponse),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
    )
)]
pub async fn summary(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
) -> Result<Json<SummaryResponse>, AppError> {
    Ok(Json(backup::summary(&state.pool, &user.user_id).await?))
}

/// The whole account as a backup file (architecture.md §6.5), the same format as the app's local backup.
#[utoipa::path(
    get,
    path = "/api/export",
    tag = "backup",
    security(("session" = [])),
    responses(
        (status = 200, description = "Backup JSON, sent as the attachment `annette-export-YYYY-MM-DD.json` (UTC date)",
            body = Backup),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
    )
)]
pub async fn export(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
) -> Result<([(header::HeaderName, String); 1], Json<Backup>), AppError> {
    let now = now_ms();
    let backup = backup::export(&state.pool, &user.user_id, now).await?;
    let disposition = format!(
        "attachment; filename=\"annette-export-{}.json\"",
        utc_date(now)
    );
    Ok(([(header::CONTENT_DISPOSITION, disposition)], Json(backup)))
}

/// Restores a backup into an account that has no decks. Rows get new ids and sync to every device.
#[utoipa::path(
    post,
    path = "/api/import/json",
    tag = "backup",
    security(("session" = [])),
    request_body = Backup,
    responses(
        (status = 200, description = "Rows written", body = RestoreResponse),
        (status = 400, description = "`invalid_format` (not a backup, bad rows or references) or \
            `unsupported_version` (written by a newer app)", body = ErrorBody),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 409, description = "`account_not_empty`: the account has decks", body = ErrorBody),
        (status = 413, description = "`payload_too_large`: over 20 MB", body = ErrorBody),
    )
)]
pub async fn restore(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    AppJson(body): AppJson<serde_json::Value>,
) -> Result<Json<RestoreResponse>, AppError> {
    let backup = backup::parse_backup(body)?;
    Ok(Json(
        backup::restore(&state.pool, &user.user_id, backup, now_ms()).await?,
    ))
}

/// `YYYY-MM-DD` in UTC. (`time` comes with the `cookie` crate.)
fn utc_date(ms: i64) -> String {
    let date = cookie::time::OffsetDateTime::from_unix_timestamp(ms / 1000)
        .map_or(cookie::time::OffsetDateTime::UNIX_EPOCH, |time| time)
        .date();
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn utc_date_formats_the_day() {
        assert_eq!(super::utc_date(1_758_441_600_000), "2025-09-21");
        assert_eq!(super::utc_date(0), "1970-01-01");
    }
}
