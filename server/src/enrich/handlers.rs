use std::sync::Arc;

use axum::{Json, extract::State};

use crate::{
    app::AppState,
    auth::extractor::CurrentUser,
    clock::now_ms,
    enrich::{
        dto::{EnrichRequest, EnrichResponse},
        service,
    },
    error::{AppError, ErrorBody},
    json::AppJson,
};

/// Suggests the translation, an example, IPA and notes for a word. Nothing is saved: the learner accepts the
/// suggestions in the card editor.
#[utoipa::path(
    post,
    path = "/api/enrich",
    tag = "enrich",
    security(("session" = [])),
    request_body = EnrichRequest,
    responses(
        (status = 200, description = "Suggestions", body = EnrichResponse),
        (status = 400, description = "`validation_failed`", body = ErrorBody),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 409, description = "`enrich_disabled`: no LLM key on this server", body = ErrorBody),
        (status = 429, description = "`enrich_quota_exceeded` (daily quota, resets at 00:00 UTC) or \
            `rate_limited` (more than 20 requests a minute)", body = ErrorBody),
        (status = 502, description = "`provider_error`: the model failed or gave no valid answer twice",
            body = ErrorBody),
        (status = 504, description = "`provider_timeout`: no answer within 10 s", body = ErrorBody),
    )
)]
pub async fn enrich(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    AppJson(request): AppJson<EnrichRequest>,
) -> Result<Json<EnrichResponse>, AppError> {
    let enricher = state
        .enricher
        .as_deref()
        .ok_or(AppError::Conflict("enrich_disabled"))?;
    let request = request.validated()?;
    let now = now_ms();
    state.enrich_limit.check(&user.user_id, now)?;
    let suggestion = service::enrich(
        &state.pool,
        enricher,
        state.config.enrich_daily_limit,
        &user.user_id,
        &request,
        now,
    )
    .await?;
    Ok(Json(suggestion))
}
