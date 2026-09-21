//! Server side of sync (architecture.md §6): push with last-write-wins merge and `server_seq` allocation, pull,
//! the account summary, export and restore.

pub mod backup;
pub mod dto;
pub mod handlers;
pub mod lww;
pub mod pull;
pub mod push;
pub mod seq;
pub mod validate;

#[cfg(test)]
mod convergence_tests;
#[cfg(test)]
mod pull_tests;
#[cfg(test)]
pub(crate) mod test_rows;
#[cfg(test)]
mod tests;
