use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

use crate::{clock::DAY_MS, error::AppError};

pub const CODE_LEN: usize = 12;
/// Upper-case letters and digits without look-alikes (0/O, 1/I/L), so a code read aloud or retyped survives.
const CODE_ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
pub const MAX_INVITE_DAYS: i64 = 90;
const MAX_NOTE_CHARS: usize = 200;

/// A newly created invite.
#[derive(Debug, Clone)]
pub struct Invite {
    pub code: String,
    pub note: Option<String>,
    pub expires_at: i64,
}

/// An invite as the admin list shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct InviteSummary {
    pub code: String,
    pub note: Option<String>,
    pub expires_at: i64,
    /// Email of the account registered with this invite.
    pub used_by_email: Option<String>,
    pub used_at: Option<i64>,
    pub status: InviteStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum InviteStatus {
    Active,
    Used,
    Expired,
}

impl InviteStatus {
    pub fn of(used_at: Option<i64>, expires_at: i64, now: i64) -> Self {
        if used_at.is_some() {
            InviteStatus::Used
        } else if expires_at <= now {
            InviteStatus::Expired
        } else {
            InviteStatus::Active
        }
    }
}

/// The part of an invite registration needs.
#[derive(Debug)]
pub struct InviteForRegistration {
    pub used_at: Option<i64>,
    pub expires_at: i64,
}

pub fn generate_code() -> String {
    (0..CODE_LEN)
        .map(|_| char::from(CODE_ALPHABET[rand::random_range(0..CODE_ALPHABET.len())]))
        .collect()
}

/// Creates a single-use invite that expires `days` (1–90) days from `now`.
pub async fn create_invite(
    pool: &SqlitePool,
    created_by: &str,
    note: Option<&str>,
    days: i64,
    now: i64,
) -> Result<Invite, AppError> {
    if !(1..=MAX_INVITE_DAYS).contains(&days) {
        return Err(AppError::BadRequest("validation_failed"));
    }
    let note = note.map(str::trim).filter(|note| !note.is_empty());
    if note.is_some_and(|note| note.chars().count() > MAX_NOTE_CHARS) {
        return Err(AppError::BadRequest("validation_failed"));
    }

    let invite = Invite {
        code: generate_code(),
        note: note.map(str::to_string),
        expires_at: now + days * DAY_MS,
    };
    sqlx::query!(
        "INSERT INTO invites (code, created_by, note, expires_at) VALUES (?, ?, ?, ?)",
        invite.code,
        created_by,
        invite.note,
        invite.expires_at,
    )
    .execute(pool)
    .await?;
    Ok(invite)
}

/// Codes are shown in upper case; accept them however they were typed.
pub fn normalize_code(code: &str) -> String {
    code.trim().to_ascii_uppercase()
}

pub async fn find_for_registration(
    conn: &mut SqliteConnection,
    code: &str,
) -> Result<Option<InviteForRegistration>, AppError> {
    let invite = sqlx::query_as!(
        InviteForRegistration,
        "SELECT used_at, expires_at FROM invites WHERE code = ?",
        code,
    )
    .fetch_optional(conn)
    .await?;
    Ok(invite)
}

pub async fn mark_used(
    conn: &mut SqliteConnection,
    code: &str,
    user_id: &str,
    now: i64,
) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?",
        user_id,
        now,
        code,
    )
    .execute(conn)
    .await?;
    Ok(())
}

/// All invites, newest expiry first.
pub async fn list_invites(pool: &SqlitePool, now: i64) -> Result<Vec<InviteSummary>, AppError> {
    let rows = sqlx::query!(
        r#"SELECT i.code AS "code!", i.note, i.expires_at, i.used_at, u.email AS "used_by_email?"
           FROM invites i LEFT JOIN users u ON u.id = i.used_by
           ORDER BY i.expires_at DESC, i.code"#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| InviteSummary {
            status: InviteStatus::of(row.used_at, row.expires_at, now),
            code: row.code,
            note: row.note,
            expires_at: row.expires_at,
            used_by_email: row.used_by_email,
            used_at: row.used_at,
        })
        .collect())
}

/// Deletes an unused invite (invites are not synced, so there is nothing to soft-delete). A used invite is
/// `invite_used`: it records who registered with it.
pub async fn revoke_invite(pool: &SqlitePool, code: &str) -> Result<(), AppError> {
    let deleted = sqlx::query!(
        "DELETE FROM invites WHERE code = ? AND used_by IS NULL",
        code
    )
    .execute(pool)
    .await?;
    if deleted.rows_affected() > 0 {
        return Ok(());
    }
    let exists = sqlx::query_scalar!("SELECT 1 FROM invites WHERE code = ?", code)
        .fetch_optional(pool)
        .await?;
    match exists {
        Some(_) => Err(AppError::Conflict("invite_used")),
        None => Err(AppError::NotFound),
    }
}

/// The registration link for an invite, e.g. `https://cards.example.com/register?invite=ABCD…`.
pub fn invite_link(public_url: &str, code: &str) -> String {
    format!(
        "{}/register?invite={code}",
        public_url.trim_end_matches('/')
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::users::{NewUser, create_user};

    const NOW: i64 = 1_758_441_600_000;

    async fn admin_id(pool: &SqlitePool) -> String {
        let mut conn = pool.acquire().await.unwrap();
        let new = NewUser {
            email: "admin@example.com",
            display_name: "Admin",
            password: "long enough password",
            is_admin: true,
        };
        create_user(&mut conn, new).await.unwrap().id
    }

    #[test]
    fn codes_are_twelve_unambiguous_characters() {
        let code = generate_code();
        assert_eq!(code.len(), CODE_LEN);
        assert!(code.bytes().all(|byte| CODE_ALPHABET.contains(&byte)));
        assert!(!code.contains(['0', 'O', '1', 'I', 'L']));
        assert_ne!(generate_code(), code);
    }

    #[sqlx::test]
    async fn create_invite_stores_an_unused_invite(pool: SqlitePool) {
        let admin = admin_id(&pool).await;
        let invite = create_invite(&pool, &admin, Some(" Anna "), 7, NOW)
            .await
            .unwrap();
        assert_eq!(invite.note.as_deref(), Some("Anna"));
        assert_eq!(invite.expires_at, NOW + 7 * DAY_MS);

        let row = sqlx::query!(
            "SELECT created_by, used_by, expires_at FROM invites WHERE code = ?",
            invite.code
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.created_by, admin);
        assert_eq!(row.used_by, None);
        assert_eq!(row.expires_at, invite.expires_at);
    }

    #[sqlx::test]
    async fn invite_days_must_be_between_1_and_90(pool: SqlitePool) {
        let admin = admin_id(&pool).await;
        for days in [0, 91] {
            let error = create_invite(&pool, &admin, None, days, NOW)
                .await
                .unwrap_err();
            assert!(matches!(error, AppError::BadRequest("validation_failed")));
        }
        assert!(create_invite(&pool, &admin, None, 90, NOW).await.is_ok());
    }

    #[test]
    fn status_is_computed_from_use_and_expiry() {
        assert_eq!(InviteStatus::of(None, NOW + 1, NOW), InviteStatus::Active);
        assert_eq!(InviteStatus::of(None, NOW, NOW), InviteStatus::Expired);
        assert_eq!(
            InviteStatus::of(Some(NOW - 1), NOW - 1, NOW),
            InviteStatus::Used
        );
    }

    #[test]
    fn codes_are_normalized_to_upper_case() {
        assert_eq!(normalize_code(" abcd2345efgh\n"), "ABCD2345EFGH");
    }

    #[test]
    fn invite_link_joins_the_public_url() {
        assert_eq!(
            invite_link("https://cards.example.com/", "ABC"),
            "https://cards.example.com/register?invite=ABC"
        );
    }
}
