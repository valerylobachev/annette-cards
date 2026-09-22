//! Review logs → training items of the `fsrs` crate.
//!
//! One history per card direction (forward and reverse are learned separately), in answer order. Each review
//! becomes `{ rating, delta_t }`, `delta_t` being the study days since the previous review (0 for the first and for
//! repeats on the same day). The crate learns from prefixes of a history: every prefix that ends with a review on a
//! later day than the one before it is one training item (what the model predicts is the recall on that day).

use std::collections::BTreeMap;

use ::fsrs::{FSRSItem, FSRSReview};
use chrono::{DateTime, Datelike};
use chrono_tz::Tz;

use crate::clock::HOUR_MS;

/// A `review_log` row as the optimizer needs it.
#[derive(Debug, Clone)]
pub struct LogRow {
    pub card_id: String,
    pub direction: String,
    pub rating: i64,
    pub reviewed_at: i64,
    /// `state` of the `state_before` snapshot: 0 means the card was New.
    pub state_before: i64,
}

/// Where study days start: `day_start_hour` o'clock in `tz`.
#[derive(Debug, Clone, Copy)]
pub struct StudyDays {
    pub tz: Tz,
    pub day_start_hour: u32,
}

impl StudyDays {
    /// A day number that grows by one at each study day start.
    pub fn day_of(&self, ms: i64) -> i64 {
        let shifted = ms - i64::from(self.day_start_hour) * HOUR_MS;
        DateTime::from_timestamp_millis(shifted).map_or(0, |time| {
            i64::from(time.with_timezone(&self.tz).date_naive().num_days_from_ce())
        })
    }
}

/// Training items from `rows` (any order). A history that does not start with the card's first answer (its first
/// log was not made on a New card, e.g. an older part is missing) is left out: the model would start it wrong.
pub fn training_items(rows: &[LogRow], days: StudyDays) -> Vec<FSRSItem> {
    let mut histories: BTreeMap<(&str, &str), Vec<&LogRow>> = BTreeMap::new();
    for row in rows {
        histories
            .entry((row.card_id.as_str(), row.direction.as_str()))
            .or_default()
            .push(row);
    }
    histories
        .into_values()
        .flat_map(|mut history| {
            history.sort_by_key(|row| row.reviewed_at);
            history_items(&history, days)
        })
        .collect()
}

fn history_items(history: &[&LogRow], days: StudyDays) -> Vec<FSRSItem> {
    if history.first().is_none_or(|first| first.state_before != 0) {
        return Vec::new();
    }
    let mut previous_day: Option<i64> = None;
    let reviews: Vec<FSRSReview> = history
        .iter()
        .map(|row| {
            let day = days.day_of(row.reviewed_at);
            let delta_t = previous_day.map_or(0, |previous| (day - previous).max(0));
            previous_day = Some(day);
            FSRSReview {
                rating: u32::try_from(row.rating.clamp(1, 4)).unwrap_or(1),
                delta_t: u32::try_from(delta_t).unwrap_or(u32::MAX),
            }
        })
        .collect();
    (1..reviews.len())
        .filter(|&last| reviews[last].delta_t > 0)
        .map(|last| FSRSItem {
            reviews: reviews[..=last].to_vec(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};
    use chrono_tz::Europe::Riga;

    use super::*;

    const RIGA: StudyDays = StudyDays {
        tz: Riga,
        day_start_hour: 4,
    };

    /// Milliseconds of a time in Riga (summer, UTC+3).
    fn riga(day: u32, hour: u32) -> i64 {
        Utc.with_ymd_and_hms(2026, 7, day, hour, 0, 0)
            .unwrap()
            .timestamp_millis()
            - 3 * HOUR_MS
    }

    fn row(card: &str, direction: &str, rating: i64, at: i64, state_before: i64) -> LogRow {
        LogRow {
            card_id: card.to_string(),
            direction: direction.to_string(),
            rating,
            reviewed_at: at,
            state_before,
        }
    }

    fn review(rating: u32, delta_t: u32) -> FSRSReview {
        FSRSReview { rating, delta_t }
    }

    #[test]
    fn study_days_start_at_the_day_start_hour() {
        assert_eq!(RIGA.day_of(riga(2, 3)), RIGA.day_of(riga(1, 23)));
        assert_eq!(RIGA.day_of(riga(2, 4)), RIGA.day_of(riga(1, 23)) + 1);
    }

    #[test]
    fn a_history_becomes_one_item_per_later_day() {
        let rows = vec![
            row("c1", "forward", 3, riga(1, 10), 0),
            // The same study day (03:00 the next morning is still July 1st's study day).
            row("c1", "forward", 3, riga(2, 3), 1),
            row("c1", "forward", 1, riga(4, 9), 2),
            row("c1", "forward", 3, riga(4, 9) + HOUR_MS, 3),
            row("c1", "forward", 4, riga(10, 20), 2),
        ];
        let items = training_items(&rows, RIGA);
        let first = vec![review(3, 0), review(3, 0), review(1, 3)];
        let mut second = first.clone();
        second.extend([review(3, 0), review(4, 6)]);
        assert_eq!(
            items,
            vec![FSRSItem { reviews: first }, FSRSItem { reviews: second }]
        );
    }

    #[test]
    fn directions_are_separate_histories() {
        let rows = vec![
            row("c1", "reverse", 3, riga(3, 10), 0),
            row("c1", "forward", 3, riga(1, 10), 0),
            row("c1", "forward", 3, riga(5, 10), 2),
            row("c1", "reverse", 2, riga(4, 10), 2),
        ];
        let items = training_items(&rows, RIGA);
        assert_eq!(
            items,
            vec![
                FSRSItem {
                    reviews: vec![review(3, 0), review(3, 4)]
                },
                FSRSItem {
                    reviews: vec![review(3, 0), review(2, 1)]
                },
            ]
        );
    }

    #[test]
    fn a_history_without_its_first_answer_is_skipped() {
        let rows = vec![
            row("c1", "forward", 3, riga(1, 10), 2),
            row("c1", "forward", 3, riga(5, 10), 2),
        ];
        assert!(training_items(&rows, RIGA).is_empty());
    }
}
