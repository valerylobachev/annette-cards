//! Enrichment request and response bodies (architecture.md §5.3, §8).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    error::AppError,
    sync::validate::{MAX_FRONT_BACK_CHARS, MAX_LANG_CHARS},
};

/// Longest context hint; the word itself has the limit of a card's front (architecture.md §9).
pub const MAX_CONTEXT_CHARS: usize = 500;

#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct EnrichRequest {
    /// The word or phrase, in the studied language.
    pub front: String,
    /// BCP-47 tag of the studied language (the deck's `target_lang`), e.g. `en-GB`.
    pub target_lang: String,
    /// BCP-47 tag of the learner's language (the deck's `native_lang`), e.g. `ru`.
    pub native_lang: String,
    /// Optional hint for the meaning, e.g. "past tense" or a sentence the word came from.
    pub context: Option<String>,
}

/// Suggested card fields. Only `back` is always present; the learner accepts each field or not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct EnrichResponse {
    /// Translation into the native language; several meanings are separated by `; `.
    pub back: String,
    /// A short example sentence in the studied language.
    pub example: Option<String>,
    /// The example in the native language.
    pub example_translation: Option<String>,
    /// Pronunciation in IPA, between slashes.
    pub ipa: Option<String>,
    /// Short grammar notes in the native language (part of speech, forms, gender, aspect).
    pub notes: Option<String>,
}

impl EnrichRequest {
    /// The request with its text trimmed, or 400 `validation_failed`.
    pub fn validated(self) -> Result<Self, AppError> {
        let front = self.front.trim().to_string();
        let context = self
            .context
            .map(|context| context.trim().to_string())
            .filter(|context| !context.is_empty());
        let valid = !front.is_empty()
            && front.chars().count() <= MAX_FRONT_BACK_CHARS
            && context
                .as_ref()
                .is_none_or(|context| context.chars().count() <= MAX_CONTEXT_CHARS)
            && is_language_tag(&self.target_lang)
            && is_language_tag(&self.native_lang);
        if !valid {
            return Err(AppError::BadRequest("validation_failed"));
        }
        Ok(Self {
            front,
            context,
            ..self
        })
    }
}

/// Letters, digits and `-`, starting with a 2–3 letter language (`en`, `en-GB`, `pl-PL`, `yue-HK`).
fn is_language_tag(tag: &str) -> bool {
    let language = tag.split('-').next().unwrap_or_default();
    tag.len() <= MAX_LANG_CHARS
        && (2..=3).contains(&language.len())
        && language
            .chars()
            .all(|character| character.is_ascii_alphabetic())
        && tag.split('-').all(|part| {
            !part.is_empty()
                && part
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(front: &str, target_lang: &str, context: Option<&str>) -> EnrichRequest {
        EnrichRequest {
            front: front.to_string(),
            target_lang: target_lang.to_string(),
            native_lang: "ru".to_string(),
            context: context.map(str::to_string),
        }
    }

    #[test]
    fn valid_requests_are_trimmed() {
        let valid = request("  take off ", "en-GB", Some("  "))
            .validated()
            .unwrap();
        assert_eq!(valid.front, "take off");
        assert_eq!(valid.context, None, "a blank context counts as none");
        let valid = request("żółw", "pl-PL", Some(" zoo ")).validated().unwrap();
        assert_eq!(valid.front, "żółw");
        assert_eq!(valid.context.as_deref(), Some("zoo"));
    }

    #[test]
    fn invalid_requests_are_validation_failed() {
        let long = "a".repeat(MAX_FRONT_BACK_CHARS + 1);
        let long_context = "a".repeat(MAX_CONTEXT_CHARS + 1);
        let cases = [
            request(" ", "en-GB", None),
            request(&long, "en-GB", None),
            request("read", "", None),
            request("read", "english", None),
            request("read", "en_GB", None),
            request("read", "en-", None),
            request("read", "en-GB\"", None),
            request("read", "en-GB", Some(&long_context)),
        ];
        for case in cases {
            let described = format!("{case:?}");
            let error = case.validated().unwrap_err();
            assert!(
                matches!(error, AppError::BadRequest("validation_failed")),
                "{described}"
            );
        }
    }

    #[test]
    fn length_limits_count_characters_not_bytes() {
        let polish = "ż".repeat(MAX_FRONT_BACK_CHARS);
        assert!(request(&polish, "pl-PL", None).validated().is_ok());
    }
}
