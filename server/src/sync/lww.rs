/// Last-write-wins (architecture.md §6.1): the incoming row replaces the stored one when its `updated_at` is
/// larger; on a tie the lexicographically larger `updated_by` (device id) wins. An identical stamp is not a win,
/// so re-pushing the same row is a no-op (it counts as skipped).
///
/// The client applies the same rule when it merges pulled rows (P2-T06); both are tested with the table below.
pub fn incoming_wins(incoming: (i64, &str), existing: (i64, &str)) -> bool {
    let (incoming_at, incoming_by) = incoming;
    let (existing_at, existing_by) = existing;
    incoming_at > existing_at || (incoming_at == existing_at && incoming_by > existing_by)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `(updated_at, updated_by)`.
    type Stamp = (i64, &'static str);

    /// (incoming, existing, incoming wins). Keep in sync with the client's LWW test table.
    const CASES: [(Stamp, Stamp, bool); 7] = [
        ((2, "device-a"), (1, "device-z"), true), // newer wins, whatever the device
        ((1, "device-z"), (2, "device-a"), false), // older loses
        ((5, "device-b"), (5, "device-a"), true), // tie: larger device id wins
        ((5, "device-a"), (5, "device-b"), false), // tie: smaller device id loses
        ((5, "device-a"), (5, "device-a"), false), // identical: no-op
        ((5, "device-B"), (5, "device-a"), false), // byte order: upper case sorts before lower case
        ((5, "device-aa"), (5, "device-a"), true), // a longer id with the same prefix is larger
    ];

    #[test]
    fn lww_table() {
        for (incoming, existing, expected) in CASES {
            assert_eq!(
                incoming_wins(incoming, existing),
                expected,
                "{incoming:?} vs {existing:?}"
            );
        }
    }
}
