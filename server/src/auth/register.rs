use sqlx::SqlitePool;

use crate::{
    admin::invites,
    auth::{
        dto::RegisterRequest,
        session,
        users::{self, NewUser, User},
    },
    error::AppError,
};

/// Creates an account with a single-use invite and signs it in. Returns the user and the session token.
///
/// The invite check, the user, the invite's `used_by` and the session are written in one transaction: either the
/// account exists and the invite is used, or nothing changed and the invite still works.
pub async fn register(
    pool: &SqlitePool,
    request: &RegisterRequest,
    now: i64,
    ttl_ms: i64,
) -> Result<(User, String), AppError> {
    let new = NewUser {
        email: &request.email,
        display_name: &request.display_name,
        password: &request.password,
        is_admin: false,
    };
    let user = users::prepare_user(new).await?;
    let code = invites::normalize_code(&request.invite_code);

    // IMMEDIATE takes the write lock up front: two registrations with one code cannot both read it as unused.
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let invite = invites::find_for_registration(&mut tx, &code)
        .await?
        .ok_or(AppError::BadRequest("invite_invalid"))?;
    if invite.used_at.is_some() {
        return Err(AppError::BadRequest("invite_invalid"));
    }
    if invite.expires_at <= now {
        return Err(AppError::BadRequest("invite_expired"));
    }

    users::insert_user(&mut tx, &user).await?;
    invites::mark_used(&mut tx, &code, &user.id, now).await?;
    let label = request.device_label.as_deref();
    let (token, _) = session::create_session(&mut tx, &user.id, label, now, ttl_ms).await?;
    tx.commit().await?;
    Ok((user, token))
}
