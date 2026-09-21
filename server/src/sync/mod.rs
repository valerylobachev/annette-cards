//! Server side of sync (architecture.md §6): push with last-write-wins merge and `server_seq` allocation.

pub mod dto;
pub mod handlers;
pub mod lww;
pub mod push;
pub mod seq;
pub mod validate;

#[cfg(test)]
mod test_rows;
#[cfg(test)]
mod tests;
