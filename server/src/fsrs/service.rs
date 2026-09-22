//! Loading the user's history and fitting the parameters.

use std::str::FromStr;

use ::fsrs::{
    ComputeParametersInput, DEFAULT_PARAMETERS, FSRS, FSRSError, FSRSItem, compute_parameters,
};
use chrono_tz::Tz;
use serde::Deserialize;
use sqlx::SqlitePool;

use crate::fsrs::{
    PARAMETER_COUNT,
    dto::OptimizeResponse,
    items::{LogRow, StudyDays},
};

/// Relearning steps of the client's scheduler (`ts-fsrs` default: one 10-minute step). The optimizer bounds two
/// parameters by it.
const RELEARNING_STEPS: usize = 1;

/// Answers that train FSRS: not undone, not practice (practice answers do not change the schedule, decision D2).
pub async fn review_count(pool: &SqlitePool, user_id: &str) -> sqlx::Result<i64> {
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!: i64" FROM review_log
           WHERE user_id = ? AND deleted_at IS NULL AND practice = 0"#,
        user_id,
    )
    .fetch_one(pool)
    .await
}

/// The same answers as `review_count`, ordered by card direction and time.
pub async fn review_rows(pool: &SqlitePool, user_id: &str) -> sqlx::Result<Vec<LogRow>> {
    let rows = sqlx::query!(
        r#"SELECT card_id, direction, rating, reviewed_at,
                  COALESCE(json_extract(state_before, '$.state'), 0) AS "state_before!: i64"
           FROM review_log
           WHERE user_id = ? AND deleted_at IS NULL AND practice = 0
           ORDER BY card_id, direction, reviewed_at"#,
        user_id,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| LogRow {
            card_id: row.card_id,
            direction: row.direction,
            rating: row.rating,
            reviewed_at: row.reviewed_at,
            state_before: row.state_before,
        })
        .collect())
}

#[derive(Deserialize)]
struct StudyDaySettings {
    #[serde(default = "default_day_start_hour")]
    day_start_hour: u32,
    #[serde(default)]
    reminder: Option<ZoneSetting>,
}

#[derive(Deserialize)]
struct ZoneSetting {
    #[serde(default)]
    tz: String,
}

fn default_day_start_hour() -> u32 {
    4
}

/// The user's study days: `day_start_hour` from the settings document, in the time zone of the reminder setting (the
/// only zone the server knows), else UTC.
pub async fn study_days(pool: &SqlitePool, user_id: &str) -> sqlx::Result<StudyDays> {
    let data = sqlx::query_scalar!("SELECT data FROM user_settings WHERE user_id = ?", user_id)
        .fetch_optional(pool)
        .await?;
    let settings = data.and_then(|data| serde_json::from_str::<StudyDaySettings>(&data).ok());
    let tz = settings
        .as_ref()
        .and_then(|settings| settings.reminder.as_ref())
        .and_then(|reminder| Tz::from_str(&reminder.tz).ok())
        .unwrap_or(Tz::UTC);
    let day_start_hour = settings.map_or(default_day_start_hour(), |settings| {
        settings.day_start_hour.min(23)
    });
    Ok(StudyDays { tz, day_start_hour })
}

/// Fits parameters to `items` and compares the log loss of the default and the fitted parameters on them.
/// CPU-heavy (seconds): call it on a blocking thread.
pub fn optimize(items: Vec<FSRSItem>, review_count: i64) -> Result<OptimizeResponse, FSRSError> {
    let weights = compute_parameters(ComputeParametersInput {
        train_set: items.clone(),
        enable_short_term: true,
        num_relearning_steps: Some(RELEARNING_STEPS),
        ..ComputeParametersInput::default()
    })?;
    // The client's ts-fsrs takes FSRS-6 weights; a crate update to another version must not reach it silently.
    if weights.len() != PARAMETER_COUNT {
        return Err(FSRSError::InvalidParameters);
    }
    let log_loss_default = FSRS::new(&DEFAULT_PARAMETERS)?
        .evaluate(items.clone(), |_| true)?
        .log_loss;
    let log_loss_optimized = FSRS::new(&weights)?.evaluate(items, |_| true)?.log_loss;
    Ok(OptimizeResponse {
        weights,
        log_loss_default: f64::from(log_loss_default),
        log_loss_optimized: f64::from(log_loss_optimized),
        review_count,
    })
}
