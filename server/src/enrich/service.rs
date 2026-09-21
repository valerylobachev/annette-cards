//! The enrichment flow (architecture.md §8): daily quota → model → strict JSON parsing with one retry → usage count.

use serde::Deserialize;
use sqlx::SqlitePool;

use crate::{
    clock::utc_date,
    enrich::{
        EnrichError, Enricher,
        dto::{EnrichRequest, EnrichResponse},
        prompt::{build_prompt, with_json_reminder},
    },
    error::AppError,
    sync::validate::{MAX_EXAMPLE_CHARS, MAX_FRONT_BACK_CHARS, MAX_IPA_CHARS, MAX_NOTES_CHARS},
};

/// Suggestions for `request` (already validated). Refused with 429 `enrich_quota_exceeded` when the user has used
/// `daily_limit` suggestions on this UTC day. Only a successful suggestion counts toward the quota.
pub async fn enrich(
    pool: &SqlitePool,
    enricher: &dyn Enricher,
    daily_limit: u32,
    user_id: &str,
    request: &EnrichRequest,
    now: i64,
) -> Result<EnrichResponse, AppError> {
    let day = utc_date(now);
    if used_today(pool, user_id, &day).await? >= i64::from(daily_limit) {
        return Err(AppError::EnrichQuotaExceeded);
    }
    let suggestion = ask_model(enricher, request).await?;
    count_use(pool, user_id, &day).await?;
    Ok(suggestion)
}

/// Asks the model; an answer that is not a valid suggestion is retried once with a reminder of the format.
async fn ask_model(
    enricher: &dyn Enricher,
    request: &EnrichRequest,
) -> Result<EnrichResponse, AppError> {
    let prompt = build_prompt(request);
    for attempt in 0..2 {
        let attempt_prompt = if attempt == 0 {
            prompt.clone()
        } else {
            with_json_reminder(&prompt)
        };
        let text = enricher
            .complete(&attempt_prompt)
            .await
            .map_err(provider_failure)?;
        match parse_suggestion(&text) {
            Ok(suggestion) => return Ok(suggestion),
            // Only the reason and size: the answer may repeat the learner's words.
            Err(reason) => tracing::warn!(
                attempt,
                reason = reason.0,
                chars = text.chars().count(),
                "invalid enrichment answer"
            ),
        }
    }
    Err(AppError::ProviderError)
}

fn provider_failure(error: EnrichError) -> AppError {
    match error {
        EnrichError::Timeout => AppError::ProviderTimeout,
        EnrichError::Provider(message) => {
            tracing::warn!(error = %message, "enrichment provider failed");
            AppError::ProviderError
        }
    }
}

async fn used_today(pool: &SqlitePool, user_id: &str, day: &str) -> Result<i64, AppError> {
    let count = sqlx::query_scalar!(
        "SELECT count FROM enrich_usage WHERE user_id = ? AND day = ?",
        user_id,
        day
    )
    .fetch_optional(pool)
    .await?;
    Ok(count.unwrap_or(0))
}

async fn count_use(pool: &SqlitePool, user_id: &str, day: &str) -> Result<(), AppError> {
    sqlx::query!(
        "INSERT INTO enrich_usage (user_id, day, count) VALUES (?, ?, 1)
         ON CONFLICT (user_id, day) DO UPDATE SET count = count + 1",
        user_id,
        day
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Why an answer was refused (for the log).
#[derive(Debug, PartialEq, Eq)]
pub struct InvalidSuggestion(pub &'static str);

/// The model's answer as written; unknown keys are ignored, missing ones are `None`.
#[derive(Deserialize)]
struct RawSuggestion {
    back: Option<String>,
    example: Option<String>,
    example_translation: Option<String>,
    ipa: Option<String>,
    notes: Option<String>,
}

/// Reads the JSON object in a model answer (code fences or text around it are skipped). Text fields are trimmed,
/// empty ones become `None` and long ones are cut to the card field limits; an answer without `back` is refused.
pub fn parse_suggestion(text: &str) -> Result<EnrichResponse, InvalidSuggestion> {
    let (Some(start), Some(end)) = (text.find('{'), text.rfind('}')) else {
        return Err(InvalidSuggestion("no JSON object"));
    };
    if end < start {
        return Err(InvalidSuggestion("no JSON object"));
    }
    let raw: RawSuggestion = serde_json::from_str(&text[start..=end])
        .map_err(|_| InvalidSuggestion("not a suggestion object"))?;
    let back = clean(raw.back, MAX_FRONT_BACK_CHARS).ok_or(InvalidSuggestion("empty back"))?;
    Ok(EnrichResponse {
        back,
        example: clean(raw.example, MAX_EXAMPLE_CHARS),
        example_translation: clean(raw.example_translation, MAX_EXAMPLE_CHARS),
        ipa: clean(raw.ipa, MAX_IPA_CHARS),
        notes: clean(raw.notes, MAX_NOTES_CHARS),
    })
}

fn clean(value: Option<String>, max_chars: usize) -> Option<String> {
    let value = value?;
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.chars().take(max_chars).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"{"back": "черепаха", "example": "Żółw jest powolny.",
        "example_translation": "Черепаха медленная.", "ipa": "/ʐuu̯f/", "notes": "сущ., м. р."}"#;

    #[test]
    fn valid_json_is_a_suggestion() {
        let suggestion = parse_suggestion(VALID).unwrap();
        assert_eq!(
            suggestion,
            EnrichResponse {
                back: "черепаха".to_string(),
                example: Some("Żółw jest powolny.".to_string()),
                example_translation: Some("Черепаха медленная.".to_string()),
                ipa: Some("/ʐuu̯f/".to_string()),
                notes: Some("сущ., м. р.".to_string()),
            }
        );
    }

    #[test]
    fn code_fences_and_surrounding_text_are_skipped() {
        let fenced = format!("```json\n{VALID}\n```");
        assert_eq!(parse_suggestion(&fenced).unwrap().back, "черепаха");
        let chatty = format!("Here it is:\n{VALID}\nHope this helps!");
        assert_eq!(parse_suggestion(&chatty).unwrap().back, "черепаха");
    }

    #[test]
    fn unknown_keys_are_ignored_and_missing_optional_keys_are_none() {
        let suggestion =
            parse_suggestion(r#"{"back": "читать", "part_of_speech": "verb", "ipa": null}"#)
                .unwrap();
        assert_eq!(suggestion.back, "читать");
        assert_eq!(suggestion.ipa, None);
        assert_eq!(suggestion.example, None);
    }

    #[test]
    fn blank_fields_become_none_and_text_is_trimmed() {
        let suggestion =
            parse_suggestion(r#"{"back": "  кот ", "notes": "  ", "example": ""}"#).unwrap();
        assert_eq!(suggestion.back, "кот");
        assert_eq!(suggestion.notes, None);
        assert_eq!(suggestion.example, None);
    }

    #[test]
    fn oversized_fields_are_cut_to_the_card_limits() {
        let answer = serde_json::json!({
            "back": "я".repeat(MAX_FRONT_BACK_CHARS + 10),
            "notes": "n".repeat(MAX_NOTES_CHARS + 1),
            "ipa": "/".repeat(MAX_IPA_CHARS * 2),
        });
        let suggestion = parse_suggestion(&answer.to_string()).unwrap();
        assert_eq!(suggestion.back.chars().count(), MAX_FRONT_BACK_CHARS);
        assert_eq!(suggestion.notes.unwrap().chars().count(), MAX_NOTES_CHARS);
        assert_eq!(suggestion.ipa.unwrap().chars().count(), MAX_IPA_CHARS);
    }

    #[test]
    fn invalid_answers_are_refused() {
        let cases = [
            ("I cannot help with that.", "no JSON object"),
            ("} oops {", "no JSON object"),
            (r#"{"back": "кот""#, "no JSON object"),
            (r#"{"back": 42}"#, "not a suggestion object"),
            (r#"{"back": "кот", }"#, "not a suggestion object"),
            (r#"{"example": "Kot śpi."}"#, "empty back"),
            (r#"{"back": "   "}"#, "empty back"),
        ];
        for (answer, reason) in cases {
            assert_eq!(
                parse_suggestion(answer),
                Err(InvalidSuggestion(reason)),
                "{answer}"
            );
        }
    }
}
