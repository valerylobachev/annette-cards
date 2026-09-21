//! Native-speaker recordings from Wikimedia Commons (architecture.md §7).
//!
//! Pronunciation files follow a naming convention (`En-us-read.ogg`, `Pl-żółw.ogg`). One API request asks for all
//! candidate names at once; the first existing file (in order of preference) with an MP3 version wins. Commons
//! keeps the originals as OGG Vorbis and also serves an MP3 transcode of each, which every iOS version plays, so
//! the server stores that MP3 and never transcodes itself.

use std::collections::HashMap;

use async_trait::async_trait;
use serde::Deserialize;

const API_URL: &str = "https://commons.wikimedia.org/w/api.php";
/// Transcodes are served from here; any other download URL in an answer is ignored.
const UPLOAD_HOST: &str = "https://upload.wikimedia.org/";
/// Pronunciations are a few seconds long (10–50 KB); anything bigger is not what we asked for.
const MAX_RECORDING_BYTES: u64 = 2 * 1024 * 1024;
/// Longest word looked up; longer text is a phrase that has no recording.
const MAX_WORD_CHARS: usize = 100;

/// A recording ready to store.
#[derive(Debug, Clone)]
pub struct Recording {
    pub bytes: Vec<u8>,
    pub mime: String,
    /// `"{author} · {license} · {file page}"`, required by the CC BY(-SA) licenses.
    pub attribution: String,
    pub file_page: String,
}

/// The lookup failed (network, HTTP status, unexpected answer). The message is for the log only.
#[derive(Debug, thiserror::Error)]
#[error("commons lookup failed: {0}")]
pub struct CommonsError(pub String);

/// Finds a recording of a word. `Ok(None)` means there is none (or the language is not supported).
#[async_trait]
pub trait RecordingSource: Send + Sync {
    async fn find(&self, word: &str, lang: &str) -> Result<Option<Recording>, CommonsError>;
}

pub struct WikimediaCommons {
    client: reqwest::Client,
}

impl WikimediaCommons {
    /// `client` is the app's shared HTTP client; its `User-Agent` names the project and a contact URL, as the
    /// Wikimedia API policy requires.
    pub fn new(client: reqwest::Client) -> Self {
        Self { client }
    }

    async fn download(&self, url: &str) -> Result<Vec<u8>, CommonsError> {
        let response = self.client.get(url).send().await.map_err(request_error)?;
        if !response.status().is_success() {
            return Err(CommonsError(format!(
                "download answered {}",
                response.status()
            )));
        }
        if response.content_length().unwrap_or(0) > MAX_RECORDING_BYTES {
            return Err(CommonsError("recording too large".to_string()));
        }
        let bytes = response.bytes().await.map_err(request_error)?;
        if bytes.is_empty() || bytes.len() as u64 > MAX_RECORDING_BYTES {
            return Err(CommonsError(format!("unexpected size {}", bytes.len())));
        }
        Ok(bytes.to_vec())
    }
}

#[async_trait]
impl RecordingSource for WikimediaCommons {
    async fn find(&self, word: &str, lang: &str) -> Result<Option<Recording>, CommonsError> {
        let candidates = candidate_titles(word, lang);
        if candidates.is_empty() {
            return Ok(None);
        }
        let titles = candidates.join("|");
        // `.query` percent-encodes each value (`ż`, spaces, `|`), so the word never breaks the URL.
        let response = self
            .client
            .get(API_URL)
            .query(&[
                ("action", "query"),
                ("format", "json"),
                ("formatversion", "2"),
                ("titles", titles.as_str()),
                ("prop", "imageinfo|videoinfo"),
                ("iiprop", "url|extmetadata"),
                ("iiextmetadatafilter", "Artist|LicenseShortName"),
                ("viprop", "derivatives"),
            ])
            .send()
            .await
            .map_err(request_error)?;
        if !response.status().is_success() {
            return Err(CommonsError(format!("api answered {}", response.status())));
        }
        let body = response.bytes().await.map_err(request_error)?;
        let Some(file) = parse_file_info(&body, &candidates)? else {
            return Ok(None);
        };
        let bytes = self.download(&file.mp3_url).await?;
        Ok(Some(Recording {
            bytes,
            mime: "audio/mpeg".to_string(),
            attribution: file.attribution,
            file_page: file.file_page,
        }))
    }
}

fn request_error(error: reqwest::Error) -> CommonsError {
    CommonsError(error.without_url().to_string())
}

/// File titles to ask for, best first. English follows the deck's variant and falls back to the other ones;
/// Polish has one prefix. The word is tried as written and in lower case (`Read` → `read`). Other languages, and
/// text that cannot be a file name, give no candidates.
pub fn candidate_titles(word: &str, lang: &str) -> Vec<String> {
    let word = word.trim();
    let invalid = |character: char| "#<>[]|{}".contains(character) || character.is_control();
    if word.is_empty() || word.chars().count() > MAX_WORD_CHARS || word.chars().any(invalid) {
        return Vec::new();
    }
    let lang = lang.to_ascii_lowercase();
    let prefixes: &[&str] = match lang.split('-').collect::<Vec<_>>().as_slice() {
        ["en", "gb" | "uk", ..] => &["En-uk", "En-gb", "En-us"],
        ["en", ..] => &["En-us", "En-uk", "En-gb"],
        ["pl", ..] => &["Pl"],
        _ => &[],
    };
    let mut words = vec![word.to_string()];
    let lower = word.to_lowercase();
    if lower != word {
        words.push(lower);
    }
    prefixes
        .iter()
        .flat_map(|prefix| {
            words
                .iter()
                .map(move |word| format!("File:{prefix}-{word}.ogg"))
        })
        .collect()
}

/// A file that can be used: its MP3 transcode and the attribution.
#[derive(Debug, PartialEq, Eq)]
pub struct FileInfo {
    pub title: String,
    pub mp3_url: String,
    pub file_page: String,
    pub attribution: String,
}

/// The first of `candidates` (in their order) that exists and has an MP3 transcode, from an API answer.
/// An answer that is not JSON of the expected shape is an error; missing fields just skip the file.
pub fn parse_file_info(
    body: &[u8],
    candidates: &[String],
) -> Result<Option<FileInfo>, CommonsError> {
    let answer: ApiAnswer = serde_json::from_slice(body)
        .map_err(|error| CommonsError(format!("bad answer: {error}")))?;
    // The API answers with normalized titles (`take_off` → `take off`, first letter in upper case).
    let normalized: HashMap<&str, &str> = answer
        .query
        .normalized
        .iter()
        .map(|entry| (entry.from.as_str(), entry.to.as_str()))
        .collect();
    let found = candidates.iter().find_map(|candidate| {
        let title = normalized
            .get(candidate.as_str())
            .copied()
            .unwrap_or(candidate);
        let page = answer.query.pages.iter().find(|page| page.title == title)?;
        usable_file(page)
    });
    Ok(found)
}

fn usable_file(page: &Page) -> Option<FileInfo> {
    if page.missing {
        return None;
    }
    let mp3_url = page
        .videoinfo
        .iter()
        .flat_map(|info| &info.derivatives)
        .find(|derivative| {
            derivative.mime.starts_with("audio/mpeg") && derivative.src.starts_with(UPLOAD_HOST)
        })?
        .src
        .clone();
    let info = page.imageinfo.first()?;
    let file_page = info.descriptionurl.clone()?;
    let text = |value: &Option<MetaValue>| {
        value
            .as_ref()
            .and_then(|meta| meta.value.as_str())
            .map(strip_html)
            .filter(|text| !text.is_empty())
    };
    let attribution = [
        text(&info.extmetadata.artist),
        text(&info.extmetadata.license),
        Some(file_page.clone()),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    Some(FileInfo {
        title: page.title.clone(),
        mp3_url,
        file_page,
        attribution,
    })
}

/// Text of an HTML fragment (`<a href="…">Derbeth</a>` → `Derbeth`): tags removed, common entities decoded,
/// whitespace collapsed.
fn strip_html(html: &str) -> String {
    let mut text = String::with_capacity(html.len());
    let mut in_tag = false;
    for character in html.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => text.push(character),
            _ => {}
        }
    }
    let decoded = text
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

// The parts of the API answer we read (`formatversion=2`). Every field has a default, so a file without
// metadata or transcodes is simply skipped instead of failing the whole answer.

#[derive(Debug, Default, Deserialize)]
struct ApiAnswer {
    #[serde(default)]
    query: Query,
}

#[derive(Debug, Default, Deserialize)]
struct Query {
    #[serde(default)]
    normalized: Vec<Normalized>,
    #[serde(default)]
    pages: Vec<Page>,
}

#[derive(Debug, Deserialize)]
struct Normalized {
    from: String,
    to: String,
}

#[derive(Debug, Deserialize)]
struct Page {
    title: String,
    #[serde(default)]
    missing: bool,
    #[serde(default)]
    imageinfo: Vec<ImageInfo>,
    #[serde(default)]
    videoinfo: Vec<VideoInfo>,
}

#[derive(Debug, Deserialize)]
struct ImageInfo {
    descriptionurl: Option<String>,
    #[serde(default)]
    extmetadata: ExtMetadata,
}

#[derive(Debug, Default, Deserialize)]
struct ExtMetadata {
    #[serde(rename = "Artist")]
    artist: Option<MetaValue>,
    #[serde(rename = "LicenseShortName")]
    license: Option<MetaValue>,
}

#[derive(Debug, Deserialize)]
struct MetaValue {
    /// Usually a string, but the API does not promise it.
    value: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct VideoInfo {
    #[serde(default)]
    derivatives: Vec<Derivative>,
}

#[derive(Debug, Deserialize)]
struct Derivative {
    src: String,
    #[serde(rename = "type")]
    mime: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Vec<u8> {
        let path = format!(
            "{}/tests/fixtures/commons/{name}",
            env!("CARGO_MANIFEST_DIR")
        );
        std::fs::read(path).unwrap()
    }

    #[test]
    fn english_candidates_follow_the_deck_variant() {
        assert_eq!(
            candidate_titles("read", "en-GB"),
            [
                "File:En-uk-read.ogg",
                "File:En-gb-read.ogg",
                "File:En-us-read.ogg"
            ]
        );
        assert_eq!(
            candidate_titles("read", "en-US"),
            [
                "File:En-us-read.ogg",
                "File:En-uk-read.ogg",
                "File:En-gb-read.ogg"
            ]
        );
        assert_eq!(candidate_titles("read", "en")[0], "File:En-us-read.ogg");
    }

    #[test]
    fn candidates_keep_spaces_diacritics_and_try_lower_case() {
        assert_eq!(
            candidate_titles(" to take off ", "en-US")[0],
            "File:En-us-to take off.ogg"
        );
        assert_eq!(
            candidate_titles("Żółw", "pl-PL"),
            ["File:Pl-Żółw.ogg", "File:Pl-żółw.ogg"]
        );
    }

    #[test]
    fn unsupported_languages_and_odd_text_give_no_candidates() {
        assert!(candidate_titles("Haus", "de-DE").is_empty());
        for word in [
            "",
            "  ",
            "a|b",
            "x#y",
            "[[link]]",
            "two\nlines",
            &"a".repeat(101),
        ] {
            assert!(candidate_titles(word, "en-GB").is_empty(), "{word:?}");
        }
    }

    #[test]
    fn the_first_existing_candidate_with_an_mp3_wins() {
        let candidates = candidate_titles("read", "en-GB");
        let file = parse_file_info(&fixture("read-en-gb.json"), &candidates)
            .unwrap()
            .unwrap();
        assert_eq!(
            file,
            FileInfo {
                title: "File:En-us-read.ogg".to_string(),
                mp3_url: "https://upload.wikimedia.org/wikipedia/commons/transcoded/5/50/En-us-read.ogg/En-us-read.ogg.mp3"
                    .to_string(),
                file_page: "https://commons.wikimedia.org/wiki/File:En-us-read.ogg".to_string(),
                attribution: "Dvortygirl · Public domain · https://commons.wikimedia.org/wiki/File:En-us-read.ogg"
                    .to_string(),
            }
        );
    }

    #[test]
    fn polish_file_with_html_in_the_artist() {
        let file = parse_file_info(&fixture("zolw-pl.json"), &candidate_titles("żółw", "pl-PL"))
            .unwrap()
            .unwrap();
        assert!(file.mp3_url.ends_with(".ogg.mp3"), "{}", file.mp3_url);
        assert_eq!(
            file.attribution,
            "Derbeth · CC BY 2.5 · https://commons.wikimedia.org/wiki/File:Pl-%C5%BC%C3%B3%C5%82w.ogg"
        );
    }

    #[test]
    fn a_file_without_an_mp3_is_skipped() {
        let found = parse_file_info(
            &fixture("no-mp3-derivative.json"),
            &candidate_titles("żółw", "pl-PL"),
        );
        assert_eq!(found.unwrap(), None);
    }

    #[test]
    fn missing_files_and_normalized_titles() {
        // `take_off` was normalized to `take off`; neither file exists.
        let candidates = vec![
            "File:en-us-take_off.ogg".to_string(),
            "File:En-us-nonexistent-xyz.ogg".to_string(),
        ];
        assert_eq!(
            parse_file_info(&fixture("missing.json"), &candidates).unwrap(),
            None
        );
    }

    #[test]
    fn a_broken_answer_is_an_error() {
        assert!(parse_file_info(b"<html>", &[]).is_err());
        assert_eq!(
            parse_file_info(b"{}", &["File:X.ogg".to_string()]).unwrap(),
            None
        );
    }

    #[test]
    fn html_is_reduced_to_text() {
        assert_eq!(
            strip_html(r#"<span class="fn">Jan &amp; Anna <b>Nowak</b></span>"#),
            "Jan & Anna Nowak"
        );
        assert_eq!(strip_html("  plain\n text "), "plain text");
    }
}
