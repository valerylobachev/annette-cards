use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::{
    admin::invites::{self, InviteStatus, InviteSummary},
    app::AppState,
    auth::extractor::AdminUser,
    clock::now_ms,
    error::{AppError, ErrorBody},
};

const DEFAULT_INVITE_DAYS: i64 = 7;

#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateInviteRequest {
    /// Who the invite is for, e.g. "Anna"; at most 200 characters.
    pub note: Option<String>,
    /// Days until the invite expires, 1–90 (default 7).
    pub days: Option<i64>,
}

/// All invites with their status.
#[utoipa::path(
    get,
    path = "/api/admin/invites",
    tag = "admin",
    security(("session" = [])),
    responses(
        (status = 200, description = "Invites, newest expiry first", body = Vec<InviteSummary>),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 403, description = "`forbidden`: not an admin", body = ErrorBody),
    )
)]
pub async fn list_invites(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
) -> Result<Json<Vec<InviteSummary>>, AppError> {
    Ok(Json(invites::list_invites(&state.pool, now_ms()).await?))
}

/// Creates a single-use invite.
#[utoipa::path(
    post,
    path = "/api/admin/invites",
    tag = "admin",
    security(("session" = [])),
    request_body = CreateInviteRequest,
    responses(
        (status = 201, description = "The new invite", body = InviteSummary),
        (status = 400, description = "`validation_failed`: days outside 1–90 or note too long", body = ErrorBody),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 403, description = "`forbidden`: not an admin", body = ErrorBody),
    )
)]
pub async fn create_invite(
    State(state): State<Arc<AppState>>,
    AdminUser(admin): AdminUser,
    Json(request): Json<CreateInviteRequest>,
) -> Result<(StatusCode, Json<InviteSummary>), AppError> {
    let days = request.days.unwrap_or(DEFAULT_INVITE_DAYS);
    let note = request.note.as_deref();
    let invite = invites::create_invite(&state.pool, &admin.user_id, note, days, now_ms()).await?;
    let summary = InviteSummary {
        code: invite.code,
        note: invite.note,
        expires_at: invite.expires_at,
        used_by_email: None,
        used_at: None,
        status: InviteStatus::Active,
    };
    Ok((StatusCode::CREATED, Json(summary)))
}

/// Revokes (deletes) an unused invite.
#[utoipa::path(
    delete,
    path = "/api/admin/invites/{code}",
    tag = "admin",
    security(("session" = [])),
    params(("code" = String, Path, description = "Invite code")),
    responses(
        (status = 204, description = "Revoked"),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 403, description = "`forbidden`: not an admin", body = ErrorBody),
        (status = 404, description = "`not_found`", body = ErrorBody),
        (status = 409, description = "`invite_used`: used invites stay as a record", body = ErrorBody),
    )
)]
pub async fn revoke_invite(
    State(state): State<Arc<AppState>>,
    _admin: AdminUser,
    Path(code): Path<String>,
) -> Result<StatusCode, AppError> {
    invites::revoke_invite(&state.pool, &invites::normalize_code(&code)).await?;
    Ok(StatusCode::NO_CONTENT)
}
