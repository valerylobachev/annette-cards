//! Text-to-speech behind a trait (architecture.md §7): Azure in production, a fake in tests.

use async_trait::async_trait;

/// What to say: the card's front in the deck's language, with an optional IPA hint and voice override.
#[derive(Debug, Clone)]
pub struct TtsRequest {
    pub text: String,
    /// BCP-47 tag of the deck's study language, e.g. `en-GB`.
    pub lang: String,
    pub ipa: Option<String>,
    pub voice: Option<String>,
}

/// A synthesized clip.
#[derive(Debug, Clone)]
pub struct TtsAudio {
    pub bytes: Vec<u8>,
    pub mime: String,
    /// The voice that spoke, stored with the asset.
    pub voice: String,
}

#[derive(Debug, thiserror::Error)]
pub enum TtsError {
    /// No voice is known for the language (and none was given).
    #[error("no voice for language {0}")]
    UnsupportedLanguage(String),
    /// The provider could not be reached or answered with an error. The message is for the log only.
    #[error("provider failed: {0}")]
    Provider(String),
}

/// A speech provider. `Send + Sync` because one instance is shared by all requests through `AppState`.
#[async_trait]
pub trait TtsProvider: Send + Sync {
    async fn synthesize(&self, request: &TtsRequest) -> Result<TtsAudio, TtsError>;
}

/// Default neural voice per study language (`web/src/domain/languages.ts`).
const VOICES: [(&str, &str); 20] = [
    ("en-GB", "en-GB-SoniaNeural"),
    ("en-US", "en-US-JennyNeural"),
    ("pl-PL", "pl-PL-ZofiaNeural"),
    ("de-DE", "de-DE-KatjaNeural"),
    ("fr-FR", "fr-FR-DeniseNeural"),
    ("es-ES", "es-ES-ElviraNeural"),
    ("it-IT", "it-IT-ElsaNeural"),
    ("pt-PT", "pt-PT-RaquelNeural"),
    ("pt-BR", "pt-BR-FranciscaNeural"),
    ("nl-NL", "nl-NL-ColetteNeural"),
    ("sv-SE", "sv-SE-SofieNeural"),
    ("cs-CZ", "cs-CZ-VlastaNeural"),
    ("uk-UA", "uk-UA-PolinaNeural"),
    ("tr-TR", "tr-TR-EmelNeural"),
    ("ja-JP", "ja-JP-NanamiNeural"),
    ("ko-KR", "ko-KR-SunHiNeural"),
    ("zh-CN", "zh-CN-XiaoxiaoNeural"),
    ("ru-RU", "ru-RU-SvetlanaNeural"),
    ("da-DK", "da-DK-ChristelNeural"),
    ("fi-FI", "fi-FI-NooraNeural"),
];

/// The voice for a language tag: an exact match (letter case ignored), else the first voice of the same language
/// (`pl` → `pl-PL-ZofiaNeural`). Returns `(locale, voice)`.
pub fn default_voice(lang: &str) -> Option<(&'static str, &'static str)> {
    let exact = VOICES
        .iter()
        .find(|(locale, _)| locale.eq_ignore_ascii_case(lang));
    let primary = lang.split('-').next().unwrap_or_default();
    let same_language = || {
        VOICES.iter().find(|(locale, _)| {
            locale
                .split('-')
                .next()
                .is_some_and(|language| language.eq_ignore_ascii_case(primary))
        })
    };
    exact.or_else(same_language).copied()
}

/// The voice and the `xml:lang` for a request: an explicit voice is used as given with the deck's language.
pub fn choose_voice(request: &TtsRequest) -> Result<(String, String), TtsError> {
    if let Some(voice) = &request.voice {
        return Ok((request.lang.clone(), voice.clone()));
    }
    let (locale, voice) = default_voice(&request.lang)
        .ok_or_else(|| TtsError::UnsupportedLanguage(request.lang.clone()))?;
    Ok((locale.to_string(), voice.to_string()))
}

/// SSML for Azure. Every value from the card is XML-escaped, so a word like `R&D` or `<b>` stays text. With an IPA
/// hint, the text is wrapped in `<phoneme>` so homographs (`read` /rɛd/ vs /riːd/) are spoken as written down.
pub fn build_ssml(request: &TtsRequest, lang: &str, voice: &str) -> String {
    let text = xml_escape(&request.text);
    let spoken = match request.ipa.as_deref().map(strip_ipa_delimiters) {
        Some(ipa) if !ipa.is_empty() => {
            format!(
                r#"<phoneme alphabet="ipa" ph="{}">{text}</phoneme>"#,
                xml_escape(ipa)
            )
        }
        _ => text,
    };
    format!(
        r#"<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="{}"><voice name="{}">{spoken}</voice></speak>"#,
        xml_escape(lang),
        xml_escape(voice),
    )
}

/// `/teɪk ɒf/` or `[teɪk ɒf]` → `teɪk ɒf`.
fn strip_ipa_delimiters(ipa: &str) -> &str {
    let ipa = ipa.trim();
    let inner = ipa
        .strip_prefix('/')
        .and_then(|rest| rest.strip_suffix('/'))
        .or_else(|| {
            ipa.strip_prefix('[')
                .and_then(|rest| rest.strip_suffix(']'))
        });
    inner.unwrap_or(ipa).trim()
}

/// Escapes the five XML special characters; safe in text and in attribute values.
fn xml_escape(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            other => escaped.push(other),
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(text: &str, lang: &str, ipa: Option<&str>, voice: Option<&str>) -> TtsRequest {
        TtsRequest {
            text: text.to_string(),
            lang: lang.to_string(),
            ipa: ipa.map(str::to_string),
            voice: voice.map(str::to_string),
        }
    }

    fn ssml_for(request: &TtsRequest) -> String {
        let (lang, voice) = choose_voice(request).unwrap();
        build_ssml(request, &lang, &voice)
    }

    #[test]
    fn plain_text_uses_the_language_voice() {
        assert_eq!(
            ssml_for(&request("take off", "en-GB", None, None)),
            r#"<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-GB"><voice name="en-GB-SoniaNeural">take off</voice></speak>"#
        );
        assert!(
            ssml_for(&request("żółw", "pl-PL", None, None))
                .contains(r#"<voice name="pl-PL-ZofiaNeural">żółw</voice>"#)
        );
    }

    #[test]
    fn special_characters_are_escaped() {
        let ssml = ssml_for(&request(r#"R&D <b>"quoted"</b>"#, "en-US", None, None));
        assert!(
            ssml.contains("R&amp;D &lt;b&gt;&quot;quoted&quot;&lt;/b&gt;"),
            "{ssml}"
        );
        assert!(!ssml.contains("<b>"));
    }

    #[test]
    fn ipa_wraps_the_text_in_a_phoneme() {
        let ssml = ssml_for(&request("take off", "en-GB", Some("/teɪk ɒf/"), None));
        assert!(
            ssml.contains(r#"<phoneme alphabet="ipa" ph="teɪk ɒf">take off</phoneme>"#),
            "{ssml}"
        );
        let ssml = ssml_for(&request("read", "en-GB", Some(" [rɛd] "), None));
        assert!(ssml.contains(r#"ph="rɛd""#), "{ssml}");
        let ssml = ssml_for(&request("read", "en-GB", Some("  "), None));
        assert!(!ssml.contains("phoneme"), "a blank IPA is ignored: {ssml}");
    }

    #[test]
    fn unknown_language_is_an_error() {
        let error = choose_voice(&request("word", "xx-XX", None, None)).unwrap_err();
        assert!(matches!(error, TtsError::UnsupportedLanguage(lang) if lang == "xx-XX"));
    }

    #[test]
    fn a_language_without_region_finds_its_voice() {
        assert_eq!(default_voice("pl"), Some(("pl-PL", "pl-PL-ZofiaNeural")));
        assert_eq!(default_voice("EN-us"), Some(("en-US", "en-US-JennyNeural")));
    }

    #[test]
    fn an_explicit_voice_overrides_the_map() {
        let ssml = ssml_for(&request("word", "en-GB", None, Some("en-GB-RyanNeural")));
        assert!(
            ssml.contains(r#"<voice name="en-GB-RyanNeural">"#),
            "{ssml}"
        );
        assert!(ssml.contains(r#"xml:lang="en-GB""#));
        // Any language works with an explicit voice.
        assert!(choose_voice(&request("word", "xx-XX", None, Some("xx-XX-Voice"))).is_ok());
    }
}
