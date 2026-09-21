use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};

use crate::{
    app::AppState,
    audio::{
        dto::{AttachAudioRequest, AttachAudioResponse, AudioSource},
        service, store,
    },
    auth::extractor::CurrentUser,
    clock::now_ms,
    error::{AppError, ErrorBody},
    json::AppJson,
};

/// A clip never changes (a new clip gets a new id), so devices may cache it forever.
pub const AUDIO_CACHE_CONTROL: &str = "private, max-age=31536000, immutable";
pub const X_AUDIO_SOURCE: HeaderName = HeaderName::from_static("x-audio-source");
pub const X_AUDIO_ATTRIBUTION: HeaderName = HeaderName::from_static("x-audio-attribution");

/// Longest accepted voice name (Azure names are about 30 characters).
const MAX_VOICE_CHARS: usize = 100;

/// Generates or finds audio for the card and attaches it (`cards.audio_id`); every device gets the change on its
/// next pull.
#[utoipa::path(
    post,
    path = "/api/cards/{id}/audio",
    tag = "audio",
    security(("session" = [])),
    params(("id" = String, Path, description = "Card id")),
    request_body = AttachAudioRequest,
    responses(
        (status = 200, description = "Audio attached", body = AttachAudioResponse),
        (status = 400, description = "`validation_failed`, `unsupported_language` (no voice for the deck's \
            language) or `not_implemented` (`commons`, until it is available)", body = ErrorBody),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 404, description = "`not_found`: no such card (or it is deleted)", body = ErrorBody),
        (status = 409, description = "`tts_disabled`: the server has no TTS provider", body = ErrorBody),
        (status = 429, description = "`rate_limited`: more than 60 requests an hour", body = ErrorBody),
        (status = 502, description = "`provider_error`: the TTS provider failed", body = ErrorBody),
    )
)]
pub async fn attach_audio(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Path(card_id): Path<String>,
    AppJson(request): AppJson<AttachAudioRequest>,
) -> Result<Json<AttachAudioResponse>, AppError> {
    let now = now_ms();
    state.audio_limit.check(&user.user_id, now)?;
    match request.source {
        AudioSource::Tts => {
            let tts = state
                .tts
                .as_deref()
                .ok_or(AppError::Conflict("tts_disabled"))?;
            let voice = request.voice.map(validate_voice).transpose()?;
            let response =
                service::attach_tts(&state.pool, tts, &user.user_id, &card_id, voice, now).await?;
            Ok(Json(response))
        }
        AudioSource::Commons => Err(AppError::BadRequest("not_implemented")),
    }
}

/// Removes the audio from the card. The clip stays downloadable, so devices that cached it keep working.
#[utoipa::path(
    delete,
    path = "/api/cards/{id}/audio",
    tag = "audio",
    security(("session" = [])),
    params(("id" = String, Path, description = "Card id")),
    responses(
        (status = 204, description = "Removed (or the card had no audio)"),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 404, description = "`not_found`", body = ErrorBody),
    )
)]
pub async fn remove_audio(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Path(card_id): Path<String>,
) -> Result<StatusCode, AppError> {
    service::remove_audio(&state.pool, &user.user_id, &card_id, now_ms()).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The clip's bytes. `X-Audio-Source` says where it came from; `X-Audio-Attribution` (percent-encoded UTF-8) names
/// the author and license of a recording, so a cached clip carries its attribution offline.
#[utoipa::path(
    get,
    path = "/api/audio/{id}",
    tag = "audio",
    security(("session" = [])),
    params(("id" = String, Path, description = "Audio id (`cards.audio_id`)")),
    responses(
        (status = 200, description = "The clip, cached for a year", content_type = "audio/mpeg", body = Vec<u8>,
            headers(
                ("X-Audio-Source" = String, description = "`azure` or `commons`"),
                ("X-Audio-Attribution" = String, description = "Percent-encoded author and license, when known"),
            )),
        (status = 401, description = "`unauthorized`", body = ErrorBody),
        (status = 404, description = "`not_found`", body = ErrorBody),
    )
)]
pub async fn get_audio(
    State(state): State<Arc<AppState>>,
    user: CurrentUser,
    Path(id): Path<String>,
) -> Result<Response, AppError> {
    let asset = store::get_asset(&state.pool, &user.user_id, &id)
        .await?
        .ok_or(AppError::NotFound)?;
    let mut response = asset.bytes.into_response();
    let headers = response.headers_mut();
    let header_value = |value: &str| {
        HeaderValue::from_str(value).map_err(|error| AppError::Internal(error.into()))
    };
    headers.insert(header::CONTENT_TYPE, header_value(&asset.mime)?);
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(AUDIO_CACHE_CONTROL),
    );
    headers.insert(X_AUDIO_SOURCE, header_value(&asset.source)?);
    if let Some(attribution) = asset.attribution {
        headers.insert(
            X_AUDIO_ATTRIBUTION,
            header_value(&percent_encode(&attribution))?,
        );
    }
    Ok(response)
}

/// Voice names are letters, digits and `-` / `:` (`en-GB-RyanNeural`, `en-US-Ava:DragonHDLatestNeural`).
fn validate_voice(voice: String) -> Result<String, AppError> {
    let valid = !voice.is_empty()
        && voice.chars().count() <= MAX_VOICE_CHARS
        && voice
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | ':'));
    if valid {
        Ok(voice)
    } else {
        Err(AppError::BadRequest("validation_failed"))
    }
}

/// Percent-encodes everything except unreserved URL characters, so any UTF-8 text fits in a header
/// (`decodeURIComponent` on the client restores it).
fn percent_encode(text: &str) -> String {
    text.bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
                char::from(byte).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attribution_is_percent_encoded() {
        assert_eq!(
            percent_encode("Jan Kowalski, CC BY-SA 4.0"),
            "Jan%20Kowalski%2C%20CC%20BY-SA%204.0"
        );
        assert_eq!(percent_encode("żółw"), "%C5%BC%C3%B3%C5%82w");
    }

    #[test]
    fn voice_names_are_checked() {
        assert!(validate_voice("en-GB-RyanNeural".to_string()).is_ok());
        assert!(validate_voice("en-US-Ava:DragonHDLatestNeural".to_string()).is_ok());
        for bad in ["", "en\"GB", "<voice>", &"a".repeat(101)] {
            assert!(validate_voice(bad.to_string()).is_err(), "{bad}");
        }
    }
}
