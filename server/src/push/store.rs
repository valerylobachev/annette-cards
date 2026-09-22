//! `push_subscriptions` rows. Every query names the user, except the delete of a subscription the push service
//! reported gone (by its own id).

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::push::{Subscription, dto::PushSubscriptionDto};

/// Stores the subscription for `user_id`. The same endpoint subscribed again (new keys, or another account on the
/// same device) replaces the row, so an endpoint belongs to one user.
pub async fn upsert(
    pool: &SqlitePool,
    user_id: &str,
    subscription: &PushSubscriptionDto,
    now: i64,
) -> sqlx::Result<()> {
    let id = Uuid::now_v7().to_string();
    sqlx::query!(
        "INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (endpoint) DO UPDATE SET
           user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
           created_at = excluded.created_at",
        id,
        user_id,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        now,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Deletes the user's subscription with this endpoint; `false` when the user has none.
pub async fn delete(pool: &SqlitePool, user_id: &str, endpoint: &str) -> sqlx::Result<bool> {
    let result = sqlx::query!(
        "DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?",
        user_id,
        endpoint,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Deletes a subscription the push service no longer knows.
pub async fn delete_gone(pool: &SqlitePool, user_id: &str, id: &str) -> sqlx::Result<()> {
    sqlx::query!(
        "DELETE FROM push_subscriptions WHERE user_id = ? AND id = ?",
        user_id,
        id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_for_user(pool: &SqlitePool, user_id: &str) -> sqlx::Result<Vec<Subscription>> {
    sqlx::query_as!(
        Subscription,
        r#"SELECT id AS "id!", endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? ORDER BY created_at"#,
        user_id,
    )
    .fetch_all(pool)
    .await
}
