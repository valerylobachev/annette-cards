//! FSRS parameter optimization (architecture.md §4.4, UC-30). The server fits personal parameters to the user's
//! review history with the `fsrs` crate and returns them; it never schedules cards. The client applies the weights
//! to its settings and keeps scheduling with `ts-fsrs`.
//!
//! The crate is `::fsrs` here: this module has the same name.

pub mod dto;
pub mod handlers;
pub mod items;
pub mod service;

#[cfg(test)]
mod tests;

/// Reviews needed before optimizing (UC-30): with fewer, the fit is mostly noise.
pub const MIN_REVIEWS: i64 = 1000;

/// Parameters of FSRS-6, the version of both `fsrs` 6.6 and the client's `ts-fsrs` 5.4.
pub const PARAMETER_COUNT: usize = 21;
