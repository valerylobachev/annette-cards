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
    /// Public origin: invite links, and the Origin check (P2-T02).
    pub public_url: Option<String>,
    pub session_ttl_days: u32,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            bind: SocketAddr::from(([127, 0, 0, 1], 8080)),
            database_url: "sqlite://data/annette.db".to_string(),
            public_url: None,
            session_ttl_days: 90,
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
    }

    #[test]
    fn later_sources_override_defaults() {
        let config: Config = Figment::from(Serialized::defaults(Config::default()))
            .merge(("bind", "127.0.0.1:9090"))
            .merge(("public_url", "https://cards.example.com"))
            .extract()
            .unwrap();
        assert_eq!(config.bind.port(), 9090);
        assert_eq!(
            config.public_url.as_deref(),
            Some("https://cards.example.com")
        );
        assert_eq!(config.database_url, "sqlite://data/annette.db");
    }
}
