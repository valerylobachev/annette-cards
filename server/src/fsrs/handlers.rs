use std::sync::Arc;

use axum::{Json, extract::State};

use crate::{
    app::AppState,
    auth::extractor::CurrentUser,
    clock::now_ms,
    error::{AppError, ErrorBody},
    fsrs::{MIN_REVIEWS, dto::OptimizeResponse, items::training_items, service},
};

/// Fits FSRS parameters to the user's review history (UC-30). Only answers that are not undone and not practice
/// count; at least 1 000 are needed. Returns the weights and log losses; the client decides whether to apply them.
#[utoipa::path(
    post,
    path = "/api/fsrs/optimize",
    tag = "fsrs",
    security(("session" = [])),
    responses(
        (status = 200, description = "Fitted parameters", body = OptimizeResponse),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 422, description = "`not_enough_reviews`, `details: { count, required }`", body = ErrorBody),
        (status = 429, description = "`rate_limited`: more than 3 optimizations an hour", body = ErrorBody),
    )
)]
pub async fn optimize(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
) -> Result<Json<OptimizeResponse>, AppError> {
    let count = service::review_count(&state.pool, &user.user_id).await?;
    let not_enough = AppError::NotEnoughReviews {
        count,
        required: MIN_REVIEWS,
    };
    if count < MIN_REVIEWS {
        return Err(not_enough);
    }
    state.fsrs_limit.check(&user.user_id, now_ms())?;

    let rows = service::review_rows(&state.pool, &user.user_id).await?;
    let days = service::study_days(&state.pool, &user.user_id).await?;
    let items = training_items(&rows, days);
    if items.is_empty() {
        // Enough answers, but none on a later day than the one before: nothing to learn intervals from.
        return Err(not_enough);
    }
    // Training takes seconds of CPU: on the async threads it would stall every other request meanwhile.
    let result = tokio::task::spawn_blocking(move || service::optimize(items, count))
        .await
        .map_err(|err| AppError::Internal(anyhow::anyhow!("optimizer task failed: {err}")))?;
    let response = result.map_err(|err| match err {
        ::fsrs::FSRSError::NotEnoughData => not_enough,
        err => AppError::Internal(anyhow::anyhow!("optimizer failed: {err:?}")),
    })?;
    Ok(Json(response))
}
