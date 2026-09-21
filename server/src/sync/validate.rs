//! Per-row checks on push. An invalid row is rejected with `validation_failed`; the rest of the batch still
//! applies. Limits match the client (`web/src/domain/cardValidation.ts`, `deckValidation.ts`, architecture.md §9)
//! so that nothing the client accepts is refused here.

use crate::sync::dto::{CardDto, CardStateDto, DeckDto, ReviewLogDto, SettingsDto};

pub const INVALID: &str = "validation_failed";

const MAX_ID_CHARS: usize = 100;
const MAX_DECK_NAME_CHARS: usize = 100;
const MAX_LANG_CHARS: usize = 35;
const MAX_FRONT_BACK_CHARS: usize = 500;
const MAX_EXAMPLE_CHARS: usize = 2000;
const MAX_IPA_CHARS: usize = 200;
const MAX_NOTES_CHARS: usize = 2000;
const MAX_TAG_CHARS: usize = 50;
const MAX_SETTINGS_BYTES: usize = 16 * 1024;

pub type Check = Result<(), &'static str>;

pub fn deck(deck: &DeckDto) -> Check {
    ensure(id(&deck.id) && stamp(&deck.updated_by))?;
    ensure(required(&deck.name, MAX_DECK_NAME_CHARS))?;
    ensure(
        required(&deck.target_lang, MAX_LANG_CHARS) && required(&deck.native_lang, MAX_LANG_CHARS),
    )?;
    ensure(deck.new_per_day.is_none_or(|limit| limit >= 0))
}

pub fn card(card: &CardDto) -> Check {
    ensure(id(&card.id) && id(&card.deck_id) && stamp(&card.updated_by))?;
    ensure(
        required(&card.front, MAX_FRONT_BACK_CHARS) && required(&card.back, MAX_FRONT_BACK_CHARS),
    )?;
    ensure(optional(&card.example, MAX_EXAMPLE_CHARS))?;
    ensure(optional(&card.example_translation, MAX_EXAMPLE_CHARS))?;
    ensure(optional(&card.ipa, MAX_IPA_CHARS) && optional(&card.notes, MAX_NOTES_CHARS))?;
    ensure(optional(&card.audio_id, MAX_ID_CHARS))?;
    ensure(card.tags.iter().all(|tag| required(tag, MAX_TAG_CHARS)))
}

pub fn card_state(state: &CardStateDto) -> Check {
    ensure(id(&state.card_id) && stamp(&state.updated_by))?;
    ensure((0..=3).contains(&state.state))?;
    ensure(state.stability.is_finite() && state.difficulty.is_finite())?;
    ensure(state.reps >= 0 && state.lapses >= 0)
}

pub fn review_log(log: &ReviewLogDto) -> Check {
    ensure(id(&log.id) && id(&log.card_id) && stamp(&log.updated_by))?;
    ensure((1..=4).contains(&log.rating))?;
    ensure(log.duration_ms >= 0 && log.state_before.is_object())
}

pub fn settings(settings: &SettingsDto) -> Check {
    ensure(stamp(&settings.updated_by) && settings.data.is_object())?;
    ensure(settings.data.to_string().len() <= MAX_SETTINGS_BYTES)
}

fn ensure(valid: bool) -> Check {
    if valid { Ok(()) } else { Err(INVALID) }
}

fn chars(value: &str) -> usize {
    value.chars().count()
}

fn required(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && chars(value) <= max
}

fn optional(value: &Option<String>, max: usize) -> bool {
    value.as_deref().is_none_or(|value| chars(value) <= max)
}

fn id(value: &str) -> bool {
    required(value, MAX_ID_CHARS)
}

/// `updated_by`: the writing device's id.
fn stamp(updated_by: &str) -> bool {
    required(updated_by, MAX_ID_CHARS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::test_rows::{card_row, deck_row, log_row, state_row};

    #[test]
    fn valid_rows_pass() {
        assert_eq!(deck(&deck_row("d1", 1)), Ok(()));
        assert_eq!(card(&card_row("c1", "d1", 1)), Ok(()));
        assert_eq!(card_state(&state_row("c1", 1)), Ok(()));
        assert_eq!(review_log(&log_row("l1", "c1")), Ok(()));
    }

    #[test]
    fn text_limits_follow_the_client() {
        let mut long = card_row("c1", "d1", 1);
        long.front = "x".repeat(500);
        long.example = Some("x".repeat(2000));
        long.notes = Some("я".repeat(2000));
        assert_eq!(card(&long), Ok(()));

        long.front = "x".repeat(501);
        assert_eq!(card(&long), Err(INVALID));

        let mut blank = card_row("c1", "d1", 1);
        blank.back = "  ".to_string();
        assert_eq!(card(&blank), Err(INVALID));

        let mut tag = card_row("c1", "d1", 1);
        tag.tags = vec!["t".repeat(51)];
        assert_eq!(card(&tag), Err(INVALID));

        let mut name = deck_row("d1", 1);
        name.name = "n".repeat(101);
        assert_eq!(deck(&name), Err(INVALID));
    }

    #[test]
    fn numbers_and_json_are_checked() {
        let mut state = state_row("c1", 1);
        state.state = 4;
        assert_eq!(card_state(&state), Err(INVALID));

        let mut log = log_row("l1", "c1");
        log.rating = 0;
        assert_eq!(review_log(&log), Err(INVALID));
        let mut log = log_row("l1", "c1");
        log.state_before = serde_json::json!("not an object");
        assert_eq!(review_log(&log), Err(INVALID));

        let settings_row = |data| SettingsDto {
            data,
            updated_at: 1,
            updated_by: "device".into(),
        };
        assert_eq!(
            settings(&settings_row(serde_json::json!({ "new_per_day": 10 }))),
            Ok(())
        );
        assert_eq!(
            settings(&settings_row(serde_json::json!([1, 2]))),
            Err(INVALID)
        );
    }
}
