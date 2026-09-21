//! The enrichment prompt (architecture.md §8): a strict JSON format plus rules for the studied language, tuned for
//! English → Russian and Polish → Russian; other languages get the general rules only.

use crate::enrich::{EnrichPrompt, dto::EnrichRequest};

/// Appended to the user message when the first answer was not valid JSON.
const JSON_REMINDER: &str = "Your previous answer was not a valid JSON object in the required format. \
Answer with only the JSON object described in the instructions.";

pub fn build_prompt(request: &EnrichRequest) -> EnrichPrompt {
    let target = &request.target_lang;
    let native = &request.native_lang;
    let mut system = format!(
        "You are a bilingual dictionary assistant for a vocabulary flashcard app. The learner studies the \
language with the BCP-47 tag {target} and speaks the language with the tag {native}.

For the word or phrase in the user message, answer with only one JSON object, without any other text or code \
fences, with exactly these keys:
{{\"back\": string, \"example\": string or null, \"example_translation\": string or null, \"ipa\": string or null, \
\"notes\": string or null}}

- \"back\": the translation into {native}; the most common meaning first, several meanings separated by \"; \" \
(at most 4).
- \"example\": one short, natural sentence in {target} that uses the word or phrase (at most 12 words).
- \"example_translation\": the translation of the example into {native}.
- \"ipa\": the pronunciation of the word or phrase in IPA, between slashes, e.g. \"/ˈwɔːtə/\".
- \"notes\": short notes in {native}: the part of speech and the grammar worth remembering; null when there is \
nothing useful.
- If the user message has a context line, choose the meaning that fits it.
- Use null for a field you cannot fill."
    );
    for rule in language_rules(target, native) {
        system.push_str("\n- ");
        system.push_str(&rule);
    }

    let mut user = format!("Word: {}", request.front);
    if let Some(context) = &request.context {
        user.push_str("\nContext: ");
        user.push_str(context);
    }
    EnrichPrompt { system, user }
}

/// The same prompt with a reminder to answer in the JSON format, for the one retry.
pub fn with_json_reminder(prompt: &EnrichPrompt) -> EnrichPrompt {
    EnrichPrompt {
        system: prompt.system.clone(),
        user: format!("{}\n\n{JSON_REMINDER}", prompt.user),
    }
}

/// Extra rules for the studied language (`target`), in the native language's terms where that matters.
fn language_rules(target: &str, native: &str) -> Vec<String> {
    let native_is_russian = primary_language(native) == "ru";
    match primary_language(target).as_str() {
        "en" => vec![
            english_variant_rule(target),
            "In notes, give the part of speech; for a phrasal verb, say that it is one; give irregular forms \
(e.g. \"take — took — taken\", \"mouse — mice\")."
                .to_string(),
            "If the word has several pronunciations (e.g. \"read\" /riːd/ and /rɛd/), give the IPA of the meaning \
from the context, else of the most common meaning."
                .to_string(),
        ],
        "pl" => vec![
            if native_is_russian {
                "For a noun, give its grammatical gender in notes: \"м. р.\", \"ж. р.\" or \"ср. р.\".".to_string()
            } else {
                "For a noun, give its grammatical gender (masculine, feminine or neuter) in notes.".to_string()
            },
            "For a verb, give its aspect pair in notes, imperfective / perfective (e.g. \"robić / zrobić\"), and \
say which aspect the word is."
                .to_string(),
            "Keep the Polish letters ą, ć, ę, ł, ń, ó, ś, ź, ż exactly; never replace them with plain letters."
                .to_string(),
        ],
        _ => Vec::new(),
    }
}

fn english_variant_rule(target: &str) -> String {
    match target.to_ascii_lowercase().as_str() {
        "en-gb" => {
            "Use British spelling in the example and British pronunciation (RP) in ipa.".to_string()
        }
        "en-us" => {
            "Use American spelling in the example and American pronunciation in ipa.".to_string()
        }
        _ => format!("Use the spelling and pronunciation of the variant {target}."),
    }
}

fn primary_language(tag: &str) -> String {
    tag.split('-')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
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
    fn every_prompt_asks_for_the_json_keys() {
        for lang in ["en-GB", "pl-PL", "de-DE"] {
            let prompt = build_prompt(&request("word", lang, None));
            for key in ["back", "example", "example_translation", "ipa", "notes"] {
                assert!(
                    prompt.system.contains(&format!("\"{key}\"")),
                    "{lang}: {key}"
                );
            }
            assert!(prompt.system.contains("only one JSON object"));
            assert!(prompt.system.contains(&format!("tag {lang}")));
            assert!(
                prompt
                    .system
                    .contains("speaks the language with the tag ru")
            );
        }
    }

    #[test]
    fn british_english_prompt() {
        let prompt = build_prompt(&request("read", "en-GB", Some("past tense")));
        assert!(prompt.system.contains("British spelling"));
        assert!(prompt.system.contains("take — took — taken"));
        assert!(prompt.system.contains("phrasal verb"));
        assert!(prompt.system.contains("several pronunciations"));
        assert!(!prompt.system.contains("ż"), "no Polish rules");
        assert_eq!(prompt.user, "Word: read\nContext: past tense");
    }

    #[test]
    fn american_and_other_english_variants() {
        let american = build_prompt(&request("color", "en-US", None));
        assert!(american.system.contains("American spelling"));
        let australian = build_prompt(&request("arvo", "en-AU", None));
        assert!(australian.system.contains("the variant en-AU"));
    }

    #[test]
    fn polish_prompt_asks_for_gender_and_aspect() {
        let prompt = build_prompt(&request("żółw", "pl-PL", None));
        assert!(prompt.system.contains("\"м. р.\", \"ж. р.\" or \"ср. р.\""));
        assert!(prompt.system.contains("aspect pair"));
        assert!(prompt.system.contains("robić / zrobić"));
        assert!(prompt.system.contains("ą, ć, ę, ł, ń, ó, ś, ź, ż"));
        assert!(!prompt.system.contains("British"));
        assert_eq!(prompt.user, "Word: żółw");
    }

    #[test]
    fn polish_for_other_native_languages_names_genders_generically() {
        let mut english_speaker = request("kot", "pl", None);
        english_speaker.native_lang = "en".to_string();
        let prompt = build_prompt(&english_speaker);
        assert!(prompt.system.contains("masculine, feminine or neuter"));
        assert!(!prompt.system.contains("м. р."));
    }

    #[test]
    fn other_languages_get_only_the_general_rules() {
        let prompt = build_prompt(&request("Haus", "de-DE", None));
        assert!(!prompt.system.contains("British"));
        assert!(!prompt.system.contains("aspect"));
    }

    #[test]
    fn the_retry_adds_a_json_reminder() {
        let prompt = build_prompt(&request("kot", "pl-PL", None));
        let retry = with_json_reminder(&prompt);
        assert_eq!(retry.system, prompt.system);
        assert!(retry.user.starts_with("Word: kot\n\n"));
        assert!(retry.user.contains("only the JSON object"));
    }
}
