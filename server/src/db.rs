use std::{str::FromStr, time::Duration};

use anyhow::Context;
use sqlx::{
    SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};

/// Opens the SQLite pool with the pragmas from tech_stack.md → Database.
/// Creates the database file (and its directory) if it does not exist yet.
pub async fn connect(database_url: &str) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(database_url)
        .with_context(|| format!("invalid database URL {database_url}"))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(5))
        .synchronous(SqliteSynchronous::Normal);

    if let Some(dir) = options.get_filename().parent()
        && !dir.as_os_str().is_empty()
    {
        std::fs::create_dir_all(dir).with_context(|| format!("cannot create {}", dir.display()))?;
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .context("cannot open the database")?;
    Ok(pool)
}

/// Applies the migrations embedded from `server/migrations` at compile time.
pub async fn migrate(pool: &SqlitePool) -> anyhow::Result<()> {
    sqlx::migrate!()
        .run(pool)
        .await
        .context("database migration failed")?;
    Ok(())
}

/// Cheap liveness check used by `GET /api/health`.
pub async fn ping(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query("SELECT 1").execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test]
    async fn migrations_apply_and_foreign_keys_are_on(pool: SqlitePool) {
        let foreign_keys: i64 = sqlx::query_scalar("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(foreign_keys, 1);
    }

    #[tokio::test]
    async fn connect_creates_the_database_file_and_directory() {
        let dir = std::env::temp_dir().join(format!("annette-test-{}", uuid::Uuid::now_v7()));
        let url = format!("sqlite://{}/nested/test.db", dir.display());

        let pool = connect(&url).await.unwrap();
        migrate(&pool).await.unwrap();
        ping(&pool).await.unwrap();
        let journal_mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;

        assert_eq!(journal_mode, "wal");
        assert!(dir.join("nested/test.db").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
