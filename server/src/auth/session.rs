use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;

use crate::{auth::users::User, clock::HOUR_MS, error::AppError};

/// A row of `sessions`. The cookie holds the token; the database only its hash.
#[derive(Debug, Clone)]
pub struct Session {
    pub token_hash: String,
    pub last_seen_at: i64,
}

/// A new cookie value: 32 random bytes, base64url without padding (43 characters).
pub fn new_token() -> String {
    let bytes: [u8; 32] = rand::random();
    URL_SAFE_NO_PAD.encode(bytes)
}

/// `hex(sha256(token))`: a leaked database does not reveal usable cookies.
pub fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Stores a new session and returns its token (for the cookie) and expiry.
pub async fn create_session(
    pool: &SqlitePool,
    user_id: &str,
    device_label: Option<&str>,
    now: i64,
    ttl_ms: i64,
) -> Result<(String, i64), AppError> {
    let token = new_token();
    let token_hash = hash_token(&token);
    let expires_at = now + ttl_ms;
    sqlx::query!(
        "INSERT INTO sessions (token_hash, user_id, device_label, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)",
        token_hash,
        user_id,
        device_label,
        now,
        now,
        expires_at,
    )
    .execute(pool)
    .await?;
    Ok((token, expires_at))
}

/// The user and session behind a cookie value, if the session exists and has not expired.
pub async fn find_user_by_token(
    pool: &SqlitePool,
    token: &str,
    now: i64,
) -> Result<Option<(User, Session)>, AppError> {
    let token_hash = hash_token(token);
    let row = sqlx::query!(
        r#"SELECT s.token_hash AS "token_hash!", s.last_seen_at,
                  u.id AS "id!", u.email, u.display_name, u.password_hash, u.is_admin AS "is_admin: bool",
                  u.created_at
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ? AND s.expires_at > ?"#,
        token_hash,
        now,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| {
        let session = Session {
            token_hash: row.token_hash,
            last_seen_at: row.last_seen_at,
        };
        let user = User {
            id: row.id,
            email: row.email,
            display_name: row.display_name,
            password_hash: row.password_hash,
            is_admin: row.is_admin,
            created_at: row.created_at,
        };
        (user, session)
    }))
}

/// Sliding expiry is written at most once an hour per session, so a busy session does not cost a write per request.
pub fn needs_touch(session: &Session, now: i64) -> bool {
    now - session.last_seen_at >= HOUR_MS
}

/// Sliding expiry: moves `expires_at` to `now + ttl` if the session was last touched at least an hour ago.
/// Returns whether the row was updated.
pub async fn touch(
    pool: &SqlitePool,
    token_hash: &str,
    now: i64,
    ttl_ms: i64,
) -> Result<bool, AppError> {
    let expires_at = now + ttl_ms;
    let stale_before = now - HOUR_MS;
    let result = sqlx::query!(
        "UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ? AND last_seen_at <= ?",
        now,
        expires_at,
        token_hash,
        stale_before,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn revoke(pool: &SqlitePool, token_hash: &str) -> Result<(), AppError> {
    sqlx::query!("DELETE FROM sessions WHERE token_hash = ?", token_hash)
        .execute(pool)
        .await?;
    Ok(())
}

/// Signs the user out everywhere except the session `keep_hash`. Returns how many sessions were revoked.
pub async fn revoke_others(
    pool: &SqlitePool,
    user_id: &str,
    keep_hash: &str,
) -> Result<u64, AppError> {
    let result = sqlx::query!(
        "DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?",
        user_id,
        keep_hash,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// Hourly cleanup (architecture.md §11). Returns how many sessions were deleted.
pub async fn delete_expired(pool: &SqlitePool, now: i64) -> Result<u64, AppError> {
    let result = sqlx::query!("DELETE FROM sessions WHERE expires_at <= ?", now)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::users::{NewUser, create_user};

    const NOW: i64 = 1_758_441_600_000;
    const TTL: i64 = 90 * crate::clock::DAY_MS;

    async fn user(pool: &SqlitePool, email: &str) -> User {
        let mut conn = pool.acquire().await.unwrap();
        let new = NewUser {
            email,
            display_name: "Anna",
            password: "long enough password",
            is_admin: false,
        };
        create_user(&mut conn, new).await.unwrap()
    }

    async fn expires_at(pool: &SqlitePool, token: &str) -> i64 {
        sqlx::query_scalar("SELECT expires_at FROM sessions WHERE token_hash = ?")
            .bind(hash_token(token))
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[test]
    fn tokens_are_random_and_stored_only_as_a_hash() {
        let (a, b) = (new_token(), new_token());
        assert_ne!(a, b);
        assert_eq!(a.len(), 43);
        let hash = hash_token(&a);
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(hash, hash_token(&a));
        assert_eq!(
            hash_token("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[sqlx::test]
    async fn a_new_session_finds_its_user(pool: SqlitePool) {
        let anna = user(&pool, "anna@example.com").await;
        let (token, expires) = create_session(&pool, &anna.id, Some("iPhone"), NOW, TTL)
            .await
            .unwrap();
        assert_eq!(expires, NOW + TTL);

        let (found, session) = find_user_by_token(&pool, &token, NOW)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(found.id, anna.id);
        assert_eq!(session.token_hash, hash_token(&token));
        let label: Option<String> = sqlx::query_scalar("SELECT device_label FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(label.as_deref(), Some("iPhone"));
        assert!(
            find_user_by_token(&pool, "unknown", NOW)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test]
    async fn an_expired_session_finds_nothing(pool: SqlitePool) {
        let anna = user(&pool, "anna@example.com").await;
        let (token, expires) = create_session(&pool, &anna.id, None, NOW, TTL)
            .await
            .unwrap();
        assert!(
            find_user_by_token(&pool, &token, expires - 1)
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            find_user_by_token(&pool, &token, expires)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test]
    async fn touch_extends_the_expiry_at_most_hourly(pool: SqlitePool) {
        let anna = user(&pool, "anna@example.com").await;
        let (token, _) = create_session(&pool, &anna.id, None, NOW, TTL)
            .await
            .unwrap();
        let hash = hash_token(&token);

        assert!(!touch(&pool, &hash, NOW + HOUR_MS - 1, TTL).await.unwrap());
        assert_eq!(expires_at(&pool, &token).await, NOW + TTL);

        assert!(touch(&pool, &hash, NOW + HOUR_MS, TTL).await.unwrap());
        assert_eq!(expires_at(&pool, &token).await, NOW + HOUR_MS + TTL);
    }

    #[sqlx::test]
    async fn revoke_others_keeps_only_the_current_session(pool: SqlitePool) {
        let anna = user(&pool, "anna@example.com").await;
        let bob = user(&pool, "bob@example.com").await;
        let (current, _) = create_session(&pool, &anna.id, None, NOW, TTL)
            .await
            .unwrap();
        let (other, _) = create_session(&pool, &anna.id, None, NOW, TTL)
            .await
            .unwrap();
        let (bobs, _) = create_session(&pool, &bob.id, None, NOW, TTL)
            .await
            .unwrap();

        assert_eq!(
            revoke_others(&pool, &anna.id, &hash_token(&current))
                .await
                .unwrap(),
            1
        );
        assert!(
            find_user_by_token(&pool, &current, NOW)
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            find_user_by_token(&pool, &other, NOW)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            find_user_by_token(&pool, &bobs, NOW)
                .await
                .unwrap()
                .is_some()
        );

        revoke(&pool, &hash_token(&current)).await.unwrap();
        assert!(
            find_user_by_token(&pool, &current, NOW)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[sqlx::test]
    async fn delete_expired_removes_only_expired_sessions(pool: SqlitePool) {
        let anna = user(&pool, "anna@example.com").await;
        let (old, _) = create_session(&pool, &anna.id, None, NOW - TTL, TTL)
            .await
            .unwrap();
        let (fresh, _) = create_session(&pool, &anna.id, None, NOW, TTL)
            .await
            .unwrap();

        assert_eq!(delete_expired(&pool, NOW).await.unwrap(), 1);
        let remaining: Vec<String> = sqlx::query_scalar("SELECT token_hash FROM sessions")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(remaining, vec![hash_token(&fresh)]);
        assert_ne!(hash_token(&old), hash_token(&fresh));
    }
}
