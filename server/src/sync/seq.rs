use sqlx::SqliteConnection;

use crate::error::AppError;

/// Allocates the next `server_seq` from the single-row counter `sync_seq`. It must run in the same transaction as
/// the row it stamps: the counter and the row commit (or roll back) together, so pull never sees a gap that is
/// filled later.
pub async fn next_seq(tx: &mut SqliteConnection) -> Result<i64, AppError> {
    let value =
        sqlx::query_scalar!("UPDATE sync_seq SET value = value + 1 WHERE id = 1 RETURNING value")
            .fetch_one(tx)
            .await?;
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    #[sqlx::test]
    async fn allocations_in_one_transaction_are_consecutive(pool: SqlitePool) {
        let mut tx = pool.begin().await.unwrap();
        let first = next_seq(&mut tx).await.unwrap();
        let second = next_seq(&mut tx).await.unwrap();
        assert_eq!(second, first + 1);
        tx.commit().await.unwrap();

        let mut tx = pool.begin().await.unwrap();
        assert_eq!(next_seq(&mut tx).await.unwrap(), second + 1);
    }

    #[sqlx::test]
    async fn a_rolled_back_allocation_is_reused(pool: SqlitePool) {
        let mut tx = pool.begin().await.unwrap();
        let value = next_seq(&mut tx).await.unwrap();
        tx.rollback().await.unwrap();

        let mut tx = pool.begin().await.unwrap();
        assert_eq!(next_seq(&mut tx).await.unwrap(), value);
    }
}
