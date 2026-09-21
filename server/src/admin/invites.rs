use sqlx::SqlitePool;

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
    fn invite_link_joins_the_public_url() {
        assert_eq!(
            invite_link("https://cards.example.com/", "ABC"),
            "https://cards.example.com/register?invite=ABC"
        );
    }
}
