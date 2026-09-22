//! Who gets a reminder now (architecture.md §11): reminders turned on, the reminder time is the current minute in
//! the user's time zone, the user has cards due for review in active decks and has not answered any card since the
//! start of the current study day. The time checks are pure functions; the counts are SQL filtered by `user_id`.

use std::{collections::HashMap, str::FromStr, sync::Arc, time::Duration};

use chrono::{DateTime, Days, NaiveDate, NaiveTime, TimeDelta, TimeZone, Timelike};
use chrono_tz::Tz;
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::{
    clock::now_ms,
    push::{Delivery, PushSender, store},
};

/// `day_start_hour` of a settings document without one (`web/src/domain/settings.ts`).
const DEFAULT_DAY_START_HOUR: u32 = 4;

/// The part of the settings document (architecture.md §5.5) the reminder task reads.
#[derive(Debug, Clone, Deserialize)]
pub struct ReminderSettings {
    #[serde(default)]
    pub reminder: Reminder,
    #[serde(default = "default_day_start_hour")]
    pub day_start_hour: u32,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Reminder {
    #[serde(default)]
    pub enabled: bool,
    /// Local time `HH:MM`.
    #[serde(default)]
    pub time: String,
    /// IANA time zone of the device that turned reminders on, e.g. `Europe/Riga`.
    #[serde(default)]
    pub tz: String,
}

fn default_day_start_hour() -> u32 {
    DEFAULT_DAY_START_HOUR
}

impl ReminderSettings {
    fn time_zone(&self) -> Option<Tz> {
        Tz::from_str(&self.reminder.tz).ok()
    }

    /// When the reminder time is the current minute in the user's time zone: the local date (the key that keeps the
    /// reminder to once a day), else `None`.
    pub fn due_on(&self, now_utc: i64) -> Option<NaiveDate> {
        if !self.reminder.enabled {
            return None;
        }
        let time = NaiveTime::parse_from_str(&self.reminder.time, "%H:%M").ok()?;
        let local = DateTime::from_timestamp_millis(now_utc)?.with_timezone(&self.time_zone()?);
        (local.hour() == time.hour() && local.minute() == time.minute()).then(|| local.date_naive())
    }
}

/// Start (ms) of the study day containing `now_utc`: `day_start_hour` o'clock in `tz`, today or yesterday. When the
/// hour does not exist that day (a DST gap), the day starts an hour later.
pub fn study_day_start(now_utc: i64, tz: Tz, day_start_hour: u32) -> i64 {
    let Some(now) = DateTime::from_timestamp_millis(now_utc) else {
        return now_utc;
    };
    let local = now.with_timezone(&tz);
    let mut date = local.date_naive();
    if local.hour() < day_start_hour {
        date = date.checked_sub_days(Days::new(1)).unwrap_or(date);
    }
    let Some(start) = date.and_hms_opt(day_start_hour.min(23), 0, 0) else {
        return now_utc;
    };
    [start, start + TimeDelta::hours(1)]
        .iter()
        .find_map(|local| tz.from_local_datetime(local).earliest())
        .map_or(now_utc, |start| start.timestamp_millis())
}

/// Cards due for review: studied states (not New) due by `now`, in directions the deck studies, of cards and decks
/// that are not deleted, in decks that are not archived.
pub async fn due_count(pool: &SqlitePool, user_id: &str, now: i64) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!: i64"
           FROM card_states s
           JOIN cards c ON c.id = s.card_id AND c.user_id = s.user_id
           JOIN decks d ON d.id = c.deck_id AND d.user_id = s.user_id
           WHERE s.user_id = ? AND s.deleted_at IS NULL AND s.state <> 0 AND s.due <= ?
             AND c.deleted_at IS NULL AND d.deleted_at IS NULL AND d.archived_at IS NULL
             AND (d.directions = 'both' OR d.directions = s.direction)"#,
        user_id,
        now,
    )
    .fetch_one(pool)
    .await
}

/// Whether the user answered a card (not undone) since `since`.
pub async fn studied_since(pool: &SqlitePool, user_id: &str, since: i64) -> sqlx::Result<bool> {
    let studied = sqlx::query_scalar!(
        r#"SELECT EXISTS (
             SELECT 1 FROM review_log WHERE user_id = ? AND deleted_at IS NULL AND reviewed_at >= ?
           ) AS "studied!: bool""#,
        user_id,
        since,
    )
    .fetch_one(pool)
    .await?;
    Ok(studied)
}

/// Users with reminders turned on and at least one push subscription, with their settings documents.
async fn candidates(pool: &SqlitePool) -> sqlx::Result<Vec<(String, String)>> {
    let rows = sqlx::query!(
        r#"SELECT s.user_id AS "user_id!", s.data
           FROM user_settings s
           WHERE json_extract(s.data, '$.reminder.enabled') = 1
             AND EXISTS (SELECT 1 FROM push_subscriptions p WHERE p.user_id = s.user_id)"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| (row.user_id, row.data))
        .collect())
}

/// The reminder payload: data only, the service worker writes the localized text (no user-visible server strings).
pub fn payload(due: i64) -> Vec<u8> {
    serde_json::json!({ "type": "reminder", "due": due })
        .to_string()
        .into_bytes()
}

/// The users already reminded, with the local date: keeps a reminder to once a day even when a minute repeats (the
/// hour after a DST change back) or a tick comes twice in one minute.
pub type Reminded = HashMap<String, NaiveDate>;

/// Sends the reminders due at `now`; returns how many users were reminded. A failing user is logged and skipped.
pub async fn send_reminders(
    pool: &SqlitePool,
    sender: &dyn PushSender,
    now: i64,
    reminded: &mut Reminded,
) -> sqlx::Result<usize> {
    let mut count = 0;
    for (user_id, data) in candidates(pool).await? {
        let Ok(settings) = serde_json::from_str::<ReminderSettings>(&data) else {
            continue;
        };
        let Some(date) = settings.due_on(now) else {
            continue;
        };
        if reminded.get(&user_id) == Some(&date) {
            continue;
        }
        match remind(pool, sender, &user_id, &settings, now).await {
            Ok(sent) => {
                reminded.insert(user_id, date);
                count += usize::from(sent);
            }
            Err(err) => tracing::warn!(error = %err, "reminder failed"),
        }
    }
    Ok(count)
}

/// Checks one user whose reminder time has come and sends to their subscriptions; `true` when a push was sent.
async fn remind(
    pool: &SqlitePool,
    sender: &dyn PushSender,
    user_id: &str,
    settings: &ReminderSettings,
    now: i64,
) -> sqlx::Result<bool> {
    let Some(tz) = settings.time_zone() else {
        return Ok(false);
    };
    let due = due_count(pool, user_id, now).await?;
    if due == 0
        || studied_since(
            pool,
            user_id,
            study_day_start(now, tz, settings.day_start_hour),
        )
        .await?
    {
        return Ok(false);
    }
    let payload = payload(due);
    let mut sent = false;
    for subscription in store::list_for_user(pool, user_id).await? {
        match sender.send(&subscription, &payload).await {
            Ok(Delivery::Accepted) => sent = true,
            Ok(Delivery::Gone) => store::delete_gone(pool, user_id, &subscription.id).await?,
            Err(err) => tracing::warn!(error = %err, "push failed"),
        }
    }
    Ok(sent)
}

/// Checks the reminders once a minute. `MissedTickBehavior::Skip`: after a pause (a slow tick, a suspended VM) the
/// next check runs on the regular schedule instead of several quick catch-up ticks for minutes that are gone.
pub fn spawn_reminders(pool: SqlitePool, sender: Arc<dyn PushSender>) {
    tokio::spawn(async move {
        let mut every_minute = tokio::time::interval(Duration::from_secs(60));
        every_minute.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut reminded = Reminded::new();
        loop {
            every_minute.tick().await;
            match send_reminders(&pool, sender.as_ref(), now_ms(), &mut reminded).await {
                Ok(count) => tracing::debug!(count, "reminder tick"),
                Err(err) => tracing::warn!(error = %err, "reminder tick failed"),
            }
        }
    });
}
