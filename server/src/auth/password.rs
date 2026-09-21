use std::sync::LazyLock;

use anyhow::anyhow;
use argon2::{
    Argon2,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};

use crate::error::AppError;

pub const MIN_PASSWORD_CHARS: usize = 10;

/// Rejects passwords shorter than 10 characters with `password_too_short`.
pub fn check_password_policy(password: &str) -> Result<(), AppError> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(AppError::BadRequest("password_too_short"));
    }
    Ok(())
}

/// Hashes a new password with Argon2id (default parameters) into a PHC string.
///
/// Argon2 is deliberately slow (tens of milliseconds of CPU), so it runs on tokio's blocking thread pool instead of
/// stalling the async worker threads that serve other requests.
pub async fn hash_password(password: &str) -> Result<String, AppError> {
    check_password_policy(password)?;
    let password = password.to_string();
    tokio::task::spawn_blocking(move || hash_blocking(&password))
        .await
        .map_err(|err| anyhow!(err))?
}

/// Checks a password against a stored PHC string.
pub async fn verify_password(password: &str, hash: &str) -> Result<bool, AppError> {
    let (password, hash) = (password.to_string(), hash.to_string());
    tokio::task::spawn_blocking(move || verify_blocking(&password, &hash))
        .await
        .map_err(|err| anyhow!(err))?
}

/// Spends the same time as `verify_password` for an unknown email, so response timing does not reveal which
/// emails have accounts.
pub async fn verify_dummy_password(password: &str) -> Result<(), AppError> {
    let password = password.to_string();
    tokio::task::spawn_blocking(move || verify_blocking(&password, &DUMMY_HASH).map(|_| ()))
        .await
        .map_err(|err| anyhow!(err))?
}

static DUMMY_HASH: LazyLock<String> =
    LazyLock::new(|| hash_blocking("dummy password for unknown emails").expect("argon2 works"));

fn hash_blocking(password: &str) -> Result<String, AppError> {
    let hash = Argon2::default()
        .hash_password(password.as_bytes())
        .map_err(|err| anyhow!("password hashing failed: {err}"))?;
    Ok(hash.to_string())
}

fn verify_blocking(password: &str, hash: &str) -> Result<bool, AppError> {
    let parsed = PasswordHash::new(hash).map_err(|err| anyhow!("stored hash is invalid: {err}"))?;
    match Argon2::default().verify_password(password.as_bytes(), &parsed) {
        Ok(()) => Ok(true),
        Err(argon2::password_hash::Error::PasswordInvalid) => Ok(false),
        Err(err) => Err(anyhow!("password verification failed: {err}").into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn hash_and_verify_roundtrip() {
        let hash = hash_password("correct horse battery").await.unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(
            verify_password("correct horse battery", &hash)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn wrong_password_does_not_verify() {
        let hash = hash_password("correct horse battery").await.unwrap();
        assert!(!verify_password("wrong horse battery", &hash).await.unwrap());
    }

    #[tokio::test]
    async fn nine_characters_are_too_short() {
        let error = hash_password("123456789").await.unwrap_err();
        assert!(matches!(error, AppError::BadRequest("password_too_short")));
        // Characters, not bytes: ten Cyrillic letters are enough.
        assert!(check_password_policy("пароль1234").is_ok());
        assert!(check_password_policy("парольпар").is_err());
    }

    #[tokio::test]
    async fn dummy_verification_succeeds_without_a_user() {
        verify_dummy_password("anything at all").await.unwrap();
    }
}
