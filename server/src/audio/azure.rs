//! Azure AI Speech REST API (https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech).

use async_trait::async_trait;

use crate::{
    audio::tts::{TtsAudio, TtsError, TtsProvider, TtsRequest, build_ssml, choose_voice},
    config::Secret,
};

/// MP3, 24 kHz mono: about 6 KB per second, plays everywhere (iOS Safari included).
const OUTPUT_FORMAT: &str = "audio-24khz-48kbitrate-mono-mp3";

pub struct AzureTts {
    client: reqwest::Client,
    key: Secret,
    endpoint: String,
}

impl AzureTts {
    /// `client` is the app's shared HTTP client (connection pool, timeout, `User-Agent`).
    pub fn new(client: reqwest::Client, key: Secret, region: &str) -> Self {
        Self {
            client,
            key,
            endpoint: format!("https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"),
        }
    }
}

#[async_trait]
impl TtsProvider for AzureTts {
    async fn synthesize(&self, request: &TtsRequest) -> Result<TtsAudio, TtsError> {
        let (lang, voice) = choose_voice(request)?;
        let response = self
            .client
            .post(&self.endpoint)
            .header("Ocp-Apim-Subscription-Key", self.key.expose())
            .header(reqwest::header::CONTENT_TYPE, "application/ssml+xml")
            .header("X-Microsoft-OutputFormat", OUTPUT_FORMAT)
            .body(build_ssml(request, &lang, &voice))
            .send()
            .await
            .map_err(|error| TtsError::Provider(error.without_url().to_string()))?;

        let status = response.status();
        if !status.is_success() {
            return Err(TtsError::Provider(format!("azure answered {status}")));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|error| TtsError::Provider(error.without_url().to_string()))?;
        if bytes.is_empty() {
            return Err(TtsError::Provider("azure returned no audio".to_string()));
        }
        Ok(TtsAudio {
            bytes: bytes.to_vec(),
            mime: "audio/mpeg".to_string(),
            voice,
        })
    }
}
