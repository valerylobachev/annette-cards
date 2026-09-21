use std::time::{SystemTime, UNIX_EPOCH};

pub const MINUTE_MS: i64 = 60 * 1000;
pub const HOUR_MS: i64 = 60 * MINUTE_MS;
pub const DAY_MS: i64 = 24 * HOUR_MS;

/// Current time in milliseconds since the Unix epoch, the unit of every timestamp in the DB and API.
pub fn now_ms() -> i64 {
    let since_epoch = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is before 1970");
    i64::try_from(since_epoch.as_millis()).expect("timestamp fits in i64")
}

/// `YYYY-MM-DD` in UTC. (`time` comes with the `cookie` crate.)
pub fn utc_date(ms: i64) -> String {
    let date = cookie::time::OffsetDateTime::from_unix_timestamp(ms / 1000)
        .map_or(cookie::time::OffsetDateTime::UNIX_EPOCH, |time| time)
        .date();
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    )
}

#[cfg(test)]
mod tests {
    #[test]
    fn utc_date_formats_the_day() {
        assert_eq!(super::utc_date(1_758_441_600_000), "2025-09-21");
        assert_eq!(super::utc_date(0), "1970-01-01");
    }
}
