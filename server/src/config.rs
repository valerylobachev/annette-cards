use std::net::SocketAddr;

use figment::{
    Figment,
    providers::{Env, Format, Serialized, Toml},
};
use serde::{Deserialize, Serialize};

use crate::clock::DAY_MS;

/// Server configuration (architecture.md §10).
///
/// Sources, later ones win: built-in defaults → optional `annette.toml` → `ANNETTE_*` environment variables.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub bind: SocketAddr,
    pub database_url: String,
    /// Public origin, e.g. `https://cards.example.com`: invite links and the Origin check.
    pub public_url: Option<String>,
    /// Also accept requests from the Vite dev server (`DEV_ORIGINS`). Default: on in debug builds, off in release.
    pub dev_origins: bool,
    pub session_ttl_days: u32,
    pub log_format: LogFormat,
    /// Azure AI Speech key (`ANNETTE_AZURE_TTS_KEY`); TTS is enabled when the key and the region are both set.
    pub azure_tts_key: Option<Secret>,
    /// Azure region of the Speech resource, e.g. `westeurope` (`ANNETTE_AZURE_TTS_REGION`).
    pub azure_tts_region: Option<String>,
    /// Look up native-speaker recordings on Wikimedia Commons (`ANNETTE_COMMONS_ENABLED`, default on; no key).
    pub commons_enabled: bool,
    /// Anthropic API key (`ANTHROPIC_API_KEY`, without the `ANNETTE_` prefix); enrichment is enabled when it is set.
    pub anthropic_api_key: Option<Secret>,
    /// Model used for enrichment (`ANNETTE_LLM_MODEL`).
    pub llm_model: String,
    /// Successful enrichments per user and UTC day (`ANNETTE_ENRICH_DAILY_LIMIT`).
    pub enrich_daily_limit: u32,
}

/// A secret setting (API key). Its `Debug` output is redacted, so printing the config never leaks it.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    #[cfg(test)]
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// The real value, only for the request that needs it.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Secret(***)")
    }
}

/// `pretty` for people, `json` for journald and log tools.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogFormat {
    Pretty,
    Json,
}

/// Origins of `just dev` / `just dev-web` (Vite on port 5173) and of `just dev-https` opened on the Mac itself,
/// accepted when `dev_origins` is set. (Safari keeps the `Secure` session cookie only over HTTPS, even on localhost.)
pub const DEV_ORIGINS: [&str; 3] = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://localhost:5173",
];

/// A fast, inexpensive model: a suggestion is a short JSON object (architecture.md §10).
pub const DEFAULT_LLM_MODEL: &str = "claude-haiku-4-5";

impl Default for Config {
    fn default() -> Self {
        Self {
            bind: SocketAddr::from(([127, 0, 0, 1], 8080)),
            database_url: "sqlite://data/annette.db".to_string(),
            public_url: None,
            // Debug builds are only ever run locally, next to the Vite dev server.
            dev_origins: cfg!(debug_assertions),
            session_ttl_days: 90,
            // Release builds run on the server under systemd; debug builds in a terminal.
            log_format: if cfg!(debug_assertions) {
                LogFormat::Pretty
            } else {
                LogFormat::Json
            },
            azure_tts_key: None,
            azure_tts_region: None,
            commons_enabled: true,
            anthropic_api_key: None,
            llm_model: DEFAULT_LLM_MODEL.to_string(),
            enrich_daily_limit: 200,
        }
    }
}

impl Config {
    /// Startup-only code, so it returns `anyhow::Result` (figment's error type is large and only ever printed).
    pub fn load() -> anyhow::Result<Self> {
        Ok(Self::figment().extract()?)
    }

    /// Sliding session lifetime in milliseconds.
    pub fn session_ttl_ms(&self) -> i64 {
        i64::from(self.session_ttl_days) * DAY_MS
    }

    /// Whether an `Origin` header value names this site (or, with `dev_origins`, the Vite dev server).
    pub fn allows_origin(&self, origin: &str) -> bool {
        let public = self
            .public_url
            .as_deref()
            .is_some_and(|url| url.trim_end_matches('/') == origin);
        public || (self.dev_origins && DEV_ORIGINS.contains(&origin))
    }

    /// Azure key and region, when both are set (and not blank).
    pub fn azure_tts(&self) -> Option<(&Secret, &str)> {
        let key = self
            .azure_tts_key
            .as_ref()
            .filter(|key| !key.expose().trim().is_empty())?;
        let region = self
            .azure_tts_region
            .as_deref()
            .map(str::trim)
            .filter(|region| !region.is_empty())?;
        Some((key, region))
    }

    pub fn tts_enabled(&self) -> bool {
        self.azure_tts().is_some()
    }

    /// The Anthropic key, when set (and not blank).
    pub fn anthropic_key(&self) -> Option<&Secret> {
        self.anthropic_api_key
            .as_ref()
            .filter(|key| !key.expose().trim().is_empty())
    }

    pub fn enrich_enabled(&self) -> bool {
        self.anthropic_key().is_some()
    }

    fn figment() -> Figment {
        Figment::from(Serialized::defaults(Config::default()))
            .merge(Toml::file("annette.toml"))
            // The Anthropic SDKs and tools all read this name, so it keeps it instead of an `ANNETTE_` one.
            .merge(Env::raw().only(&["anthropic_api_key"]))
            .merge(Env::prefixed("ANNETTE_"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests do not touch process-wide state (env vars, current directory): other tests run in parallel.

    #[test]
    fn defaults_match_architecture_doc() {
        let config = Config::default();
        assert_eq!(config.bind.to_string(), "127.0.0.1:8080");
        assert_eq!(config.database_url, "sqlite://data/annette.db");
        assert_eq!(config.public_url, None);
        assert!(config.commons_enabled);
        assert!(!config.enrich_enabled());
        assert_eq!(config.llm_model, "claude-haiku-4-5");
        assert_eq!(config.enrich_daily_limit, 200);
        assert_eq!(config.session_ttl_days, 90);
        assert_eq!(config.dev_origins, cfg!(debug_assertions));
        let build_default = if cfg!(debug_assertions) {
            LogFormat::Pretty
        } else {
            LogFormat::Json
        };
        assert_eq!(config.log_format, build_default);
    }

    #[test]
    fn origins_match_the_public_url_or_dev_server() {
        let mut config = Config {
            public_url: Some("https://cards.example.com/".to_string()),
            dev_origins: false,
            ..Config::default()
        };
        assert!(config.allows_origin("https://cards.example.com"));
        assert!(!config.allows_origin("https://evil.example.com"));
        assert!(!config.allows_origin("http://localhost:5173"));
        config.dev_origins = true;
        assert!(config.allows_origin("http://localhost:5173"));
        assert!(config.allows_origin("http://127.0.0.1:5173"));
        assert!(!config.allows_origin("http://localhost:3000"));
    }

    #[test]
    fn tts_needs_both_azure_settings() {
        let mut config = Config::default();
        assert!(!config.tts_enabled());
        config.azure_tts_key = Some(Secret::new("key"));
        assert!(!config.tts_enabled());
        config.azure_tts_region = Some("westeurope".to_string());
        assert!(config.tts_enabled());
        config.azure_tts_key = Some(Secret::new(" "));
        assert!(
            !config.tts_enabled(),
            "a blank value from .env counts as unset"
        );
    }

    #[test]
    fn enrichment_needs_the_anthropic_key() {
        assert!(!Config::default().enrich_enabled());
        let mut config = Config {
            anthropic_api_key: Some(Secret::new(" ")),
            ..Config::default()
        };
        assert!(!config.enrich_enabled(), "a blank value counts as unset");
        config.anthropic_api_key = Some(Secret::new("sk-ant-test"));
        assert!(config.enrich_enabled());
    }

    #[test]
    fn secrets_are_redacted_in_debug_output() {
        let config = Config {
            azure_tts_key: Some(Secret::new("super-secret")),
            anthropic_api_key: Some(Secret::new("sk-ant-secret")),
            ..Config::default()
        };
        let printed = format!("{config:?}");
        assert!(!printed.contains("super-secret"));
        assert!(!printed.contains("sk-ant-secret"));
        assert!(printed.contains("Secret(***)"));
    }

    #[test]
    fn later_sources_override_defaults() {
        let config: Config = Figment::from(Serialized::defaults(Config::default()))
            .merge(("bind", "127.0.0.1:9090"))
            .merge(("public_url", "https://cards.example.com"))
            .merge(("log_format", "json"))
            .merge(("azure_tts_key", "key"))
            .merge(("azure_tts_region", "westeurope"))
            .merge(("anthropic_api_key", "sk-ant-test"))
            .merge(("llm_model", "claude-sonnet-5"))
            .merge(("enrich_daily_limit", 20))
            .extract()
            .unwrap();
        assert_eq!(config.bind.port(), 9090);
        assert_eq!(
            config.public_url.as_deref(),
            Some("https://cards.example.com")
        );
        assert_eq!(config.database_url, "sqlite://data/annette.db");
        assert_eq!(config.log_format, LogFormat::Json);
        assert_eq!(
            config.azure_tts(),
            Some((&Secret::new("key"), "westeurope"))
        );
        assert_eq!(config.anthropic_key(), Some(&Secret::new("sk-ant-test")));
        assert_eq!(config.llm_model, "claude-sonnet-5");
        assert_eq!(config.enrich_daily_limit, 20);
    }
}
