//! `POST /api/fsrs/optimize` response (architecture.md §5.3).

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Fitted FSRS-6 parameters and how well they explain the history compared with the defaults. Nothing is saved: the
/// learner applies the weights on the device.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct OptimizeResponse {
    /// The 21 FSRS-6 parameters (`ts-fsrs` `w`).
    pub weights: Vec<f32>,
    /// Log loss of the default parameters on the history (lower is better).
    pub log_loss_default: f64,
    /// Log loss of the fitted parameters on the same history.
    pub log_loss_optimized: f64,
    /// Answers used: not undone, not practice.
    pub review_count: i64,
}
