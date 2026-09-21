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

    fn figment() -> Figment {
        Figment::from(Serialized::defaults(Config::default()))
            .merge(Toml::file("annette.toml"))
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
    fn later_sources_override_defaults() {
        let config: Config = Figment::from(Serialized::defaults(Config::default()))
            .merge(("bind", "127.0.0.1:9090"))
            .merge(("public_url", "https://cards.example.com"))
            .merge(("log_format", "json"))
            .extract()
            .unwrap();
        assert_eq!(config.bind.port(), 9090);
        assert_eq!(
            config.public_url.as_deref(),
            Some("https://cards.example.com")
        );
        assert_eq!(config.database_url, "sqlite://data/annette.db");
        assert_eq!(config.log_format, LogFormat::Json);
    }
}
