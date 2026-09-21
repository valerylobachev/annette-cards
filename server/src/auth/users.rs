use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

use crate::{auth::password, clock::now_ms, error::AppError};

const MAX_EMAIL_CHARS: usize = 254;
const MAX_DISPLAY_NAME_CHARS: usize = 100;

/// A row of `users`.
#[derive(Debug, Clone)]
pub struct User {
    pub id: String,
    pub email: String,
    pub display_name: String,
    pub password_hash: String,
    pub is_admin: bool,
    pub created_at: i64,
}

/// Input for `create_user`: the password is still plain text here and is hashed before it is stored.
pub struct NewUser<'a> {
    pub email: &'a str,
    pub display_name: &'a str,
    pub password: &'a str,
    pub is_admin: bool,
}

/// Validates the input, hashes the password and inserts the user (the `create-user` CLI).
pub async fn create_user(conn: &mut SqliteConnection, new: NewUser<'_>) -> Result<User, AppError> {
    let user = prepare_user(new).await?;
    insert_user(conn, &user).await?;
    Ok(user)
}

/// Validates the input and hashes the password, without touching the database. Registration does this before it
/// opens its transaction, so the slow hashing does not hold the database lock.
pub async fn prepare_user(new: NewUser<'_>) -> Result<User, AppError> {
    let email = validate_email(new.email)?;
    let display_name = validate_display_name(new.display_name)?;
    let password_hash = password::hash_password(new.password).await?;
    Ok(User {
        id: Uuid::now_v7().to_string(),
        email,
        display_name,
        password_hash,
        is_admin: new.is_admin,
        created_at: now_ms(),
    })
}

/// Inserts a prepared user; an existing email (in any letter case) is `email_taken`.
pub async fn insert_user(conn: &mut SqliteConnection, user: &User) -> Result<(), AppError> {
    let result = sqlx::query!(
        "INSERT INTO users (id, email, display_name, password_hash, is_admin, created_at)
         VALUES (?, ?, ?, ?, ?, ?)",
        user.id,
        user.email,
        user.display_name,
        user.password_hash,
        user.is_admin,
        user.created_at,
    )
    .execute(conn)
    .await;
    match result {
        Ok(_) => Ok(()),
        Err(sqlx::Error::Database(err)) if err.is_unique_violation() => {
            Err(AppError::Conflict("email_taken"))
        }
        Err(err) => Err(err.into()),
    }
}

/// Emails are compared case-insensitively (`COLLATE NOCASE` on the column).
pub async fn find_by_email(pool: &SqlitePool, email: &str) -> Result<Option<User>, AppError> {
    let user = sqlx::query_as!(
        User,
        r#"SELECT id AS "id!", email, display_name, password_hash, is_admin AS "is_admin: bool", created_at
           FROM users WHERE email = ?"#,
        email.trim(),
    )
    .fetch_optional(pool)
    .await?;
    Ok(user)
}

pub async fn find_by_id(pool: &SqlitePool, id: &str) -> Result<Option<User>, AppError> {
    let user = sqlx::query_as!(
        User,
        r#"SELECT id AS "id!", email, display_name, password_hash, is_admin AS "is_admin: bool", created_at
           FROM users WHERE id = ?"#,
        id,
    )
    .fetch_optional(pool)
    .await?;
    Ok(user)
}

/// The oldest admin account: the default author of invites created from the CLI.
pub async fn first_admin(pool: &SqlitePool) -> Result<Option<User>, AppError> {
    let user = sqlx::query_as!(
        User,
        r#"SELECT id AS "id!", email, display_name, password_hash, is_admin AS "is_admin: bool", created_at
           FROM users WHERE is_admin = 1 ORDER BY created_at, id LIMIT 1"#,
    )
    .fetch_optional(pool)
    .await?;
    Ok(user)
}

pub async fn update_password_hash(
    pool: &SqlitePool,
    user_id: &str,
    password_hash: &str,
) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        password_hash,
        user_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn validate_email(email: &str) -> Result<String, AppError> {
    let email = email.trim();
    let looks_valid = match email.split_once('@') {
        Some((local, domain)) => !local.is_empty() && !domain.is_empty(),
        None => false,
    };
    if !looks_valid || email.chars().count() > MAX_EMAIL_CHARS {
        return Err(AppError::BadRequest("validation_failed"));
    }
    Ok(email.to_string())
}

fn validate_display_name(name: &str) -> Result<String, AppError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > MAX_DISPLAY_NAME_CHARS {
        return Err(AppError::BadRequest("validation_failed"));
    }
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new_user(email: &str) -> NewUser<'_> {
        NewUser {
            email,
            display_name: "Anna",
            password: "long enough password",
            is_admin: false,
        }
    }

    #[sqlx::test]
    async fn create_user_stores_a_hashed_password(pool: SqlitePool) {
        let mut conn = pool.acquire().await.unwrap();
        let user = create_user(&mut conn, new_user(" anna@example.com "))
            .await
            .unwrap();
        assert_eq!(user.email, "anna@example.com");
        assert!(user.password_hash.starts_with("$argon2id$"));

        let found = find_by_email(&pool, "ANNA@example.com")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(found.id, user.id);
        assert!(!found.is_admin);
    }

    #[sqlx::test]
    async fn duplicate_email_is_taken_in_any_case(pool: SqlitePool) {
        let mut conn = pool.acquire().await.unwrap();
        create_user(&mut conn, new_user("anna@example.com"))
            .await
            .unwrap();
        let error = create_user(&mut conn, new_user("Anna@Example.com"))
            .await
            .unwrap_err();
        assert!(matches!(error, AppError::Conflict("email_taken")));
    }

    #[sqlx::test]
    async fn invalid_input_is_rejected(pool: SqlitePool) {
        let mut conn = pool.acquire().await.unwrap();
        for email in ["", "anna", "@example.com", "anna@"] {
            let error = create_user(&mut conn, new_user(email)).await.unwrap_err();
            assert!(
                matches!(error, AppError::BadRequest("validation_failed")),
                "{email}"
            );
        }
        let blank_name = NewUser {
            display_name: "  ",
            ..new_user("anna@example.com")
        };
        assert!(create_user(&mut conn, blank_name).await.is_err());
        let short = NewUser {
            password: "short",
            ..new_user("anna@example.com")
        };
        let error = create_user(&mut conn, short).await.unwrap_err();
        assert!(matches!(error, AppError::BadRequest("password_too_short")));
    }

    #[sqlx::test]
    async fn first_admin_is_the_oldest_admin(pool: SqlitePool) {
        let mut conn = pool.acquire().await.unwrap();
        assert!(first_admin(&pool).await.unwrap().is_none());
        create_user(&mut conn, new_user("user@example.com"))
            .await
            .unwrap();
        let admin = NewUser {
            is_admin: true,
            ..new_user("admin@example.com")
        };
        let admin = create_user(&mut conn, admin).await.unwrap();
        let second = NewUser {
            is_admin: true,
            ..new_user("second@example.com")
        };
        create_user(&mut conn, second).await.unwrap();
        assert_eq!(first_admin(&pool).await.unwrap().unwrap().id, admin.id);
    }
}
