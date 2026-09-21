use std::time::{SystemTime, UNIX_EPOCH};

pub const HOUR_MS: i64 = 60 * 60 * 1000;
pub const DAY_MS: i64 = 24 * HOUR_MS;

/// Current time in milliseconds since the Unix epoch, the unit of every timestamp in the DB and API.
pub fn now_ms() -> i64 {
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before 1970");
    i64::try_from(since_epoch.as_millis()).expect("timestamp fits in i64")
}
