use std::sync::Arc;

use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    app::AppState,
    db,
    error::{AppError, ErrorBody},
};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Ok,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HealthResponse {
    pub status: HealthStatus,
}

/// Optional server features; the client hides the UI of disabled ones.
#[derive(Debug, Default, Serialize, Deserialize, ToSchema)]
pub struct Features {
    pub tts: bool,
    pub commons: bool,
    pub enrich: bool,
    pub push: bool,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct MetaResponse {
    /// Server version (Cargo package version).
    pub version: String,
    pub features: Features,
}

/// Liveness check including a database ping.
#[utoipa::path(
    get,
    path = "/api/health",
    tag = "system",
    responses(
        (status = 200, description = "Server and database are up", body = HealthResponse),
        (status = 503, description = "Database is unavailable", body = ErrorBody),
    )
)]
pub async fn health(State(state): State<Arc<AppState>>) -> Result<Json<HealthResponse>, AppError> {
    db::ping(&state.pool).await.map_err(|err| {
        tracing::warn!(error = %err, "health check: database ping failed");
        AppError::ServiceUnavailable
    })?;
    Ok(Json(HealthResponse {
        status: HealthStatus::Ok,
    }))
}

/// Server version and enabled optional features.
#[utoipa::path(
    get,
    path = "/api/meta",
    tag = "system",
    responses((status = 200, description = "Server metadata", body = MetaResponse))
)]
pub async fn meta() -> Json<MetaResponse> {
    Json(MetaResponse {
        version: env!("CARGO_PKG_VERSION").to_string(),
        // Each feature task (TTS, Commons, enrichment, push) turns its flag on from the config.
        features: Features::default(),
    })
}
