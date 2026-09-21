//! Property-style convergence test: two simulated devices of one user edit offline in random interleavings and
//! sync at random moments through the real push and pull services. After a final sync of both, each device must
//! hold exactly the server's rows. Scenarios use a seeded RNG, so a failure names the seed that reproduces it.
//!
//! The devices merge pulled rows like the client does (P2-T06): last-write-wins for mutable rows with the same
//! `incoming_wins` rule as the server, and for review log entries only a first `deleted_at` (undo) is taken over.

use std::collections::{BTreeMap, BTreeSet};

use rand::{RngExt, SeedableRng, rngs::StdRng};
use serde_json::json;
use sqlx::SqlitePool;

use crate::sync::{
    dto::{
        CardDto, CardStateDto, Changes, DeckDto, Direction, Directions, ReviewLogDto, ReviewMode,
        SettingsDto,
    },
    lww::incoming_wins,
    pull::pull,
    push::push,
};

const SCENARIOS: u64 = 200;
const STEPS: usize = 40;

/// A device's (or the server's) rows, keyed by id; card states by `"{card_id}:{direction}"`.
#[derive(Debug, Clone, Default, PartialEq)]
struct Store {
    decks: BTreeMap<String, DeckDto>,
    cards: BTreeMap<String, CardDto>,
    card_states: BTreeMap<String, CardStateDto>,
    review_log: BTreeMap<String, ReviewLogDto>,
    settings: Option<SettingsDto>,
}

impl Store {
    /// The client's merge of pulled rows.
    fn merge_pulled(&mut self, changes: Changes) {
        for deck in changes.decks {
            merge_row(&mut self.decks, deck.id.clone(), deck, |row| {
                (row.updated_at, row.updated_by.clone())
            });
        }
        for card in changes.cards {
            merge_row(&mut self.cards, card.id.clone(), card, |row| {
                (row.updated_at, row.updated_by.clone())
            });
        }
        for state in changes.card_states {
            merge_row(&mut self.card_states, state.key(), state, |row| {
                (row.updated_at, row.updated_by.clone())
            });
        }
        for log in changes.review_log {
            match self.review_log.get_mut(&log.id) {
                None => {
                    self.review_log.insert(log.id.clone(), log);
                }
                Some(local) if local.deleted_at.is_none() && log.deleted_at.is_some() => {
                    local.deleted_at = log.deleted_at;
                    local.updated_at = log.updated_at;
                    local.updated_by = log.updated_by;
                }
                Some(_) => {}
            }
        }
        if let Some(settings) = changes.settings {
            let wins = self.settings.as_ref().is_none_or(|local| {
                incoming_wins(
                    (settings.updated_at, &settings.updated_by),
                    (local.updated_at, &local.updated_by),
                )
            });
            if wins {
                self.settings = Some(settings);
            }
        }
    }
}

fn merge_row<T>(
    rows: &mut BTreeMap<String, T>,
    key: String,
    incoming: T,
    stamp: impl Fn(&T) -> (i64, String),
) {
    let wins = rows.get(&key).is_none_or(|local| {
        let (incoming_at, incoming_by) = stamp(&incoming);
        let (local_at, local_by) = stamp(local);
        incoming_wins((incoming_at, &incoming_by), (local_at, &local_by))
    });
    if wins {
        rows.insert(key, incoming);
    }
}

/// Outbox entry: entity name and row key.
type Pending = (&'static str, String);

struct Device {
    id: String,
    /// Constant clock skew of this device, in ms.
    skew: i64,
    store: Store,
    outbox: BTreeSet<Pending>,
    cursor: i64,
    created: u32,
}

impl Device {
    fn new(id: &str, skew: i64) -> Self {
        Self {
            id: id.to_string(),
            skew,
            store: Store::default(),
            outbox: BTreeSet::new(),
            cursor: 0,
            created: 0,
        }
    }

    fn new_id(&mut self, kind: &str) -> String {
        self.created += 1;
        format!("{}-{kind}{}", self.id, self.created)
    }

    fn live_decks(&self) -> Vec<String> {
        live_keys(&self.store.decks, |deck| deck.deleted_at)
    }

    fn live_cards(&self) -> Vec<String> {
        live_keys(&self.store.cards, |card| card.deleted_at)
    }

    /// One random local edit at `clock` (the device writes `clock + skew`).
    fn edit(&mut self, rng: &mut StdRng, clock: i64) {
        let now = clock + self.skew;
        match rng.random_range(0..9) {
            0 => self.create_deck(now),
            1 => {
                if let Some(id) = pick(rng, self.live_decks()) {
                    self.touch_deck(&id, now, |deck| deck.name = format!("name {now}"));
                }
            }
            2 => {
                if let Some(id) = pick(rng, self.live_decks()) {
                    self.delete_deck(&id, now);
                }
            }
            3 | 4 => match pick(rng, self.live_decks()) {
                Some(deck_id) => self.create_card(&deck_id, now),
                None => self.create_deck(now),
            },
            5 => {
                if let Some(id) = pick(rng, self.live_cards()) {
                    self.touch_card(&id, now, |card| card.front = format!("front {now}"));
                }
            }
            6 => {
                if let Some(id) = pick(rng, self.live_cards()) {
                    self.delete_card(&id, now);
                }
            }
            7 => {
                if let Some(card_id) = pick(rng, self.live_cards()) {
                    let direction = if rng.random_bool(0.5) {
                        Direction::Forward
                    } else {
                        Direction::Reverse
                    };
                    self.answer(&card_id, direction, now);
                }
            }
            _ => {
                if rng.random_bool(0.5) {
                    self.undo_own_answer(rng, now);
                } else {
                    self.change_settings(rng.random_range(1..=50), now);
                }
            }
        }
    }

    fn create_deck(&mut self, now: i64) {
        let id = self.new_id("deck");
        let deck = DeckDto {
            id: id.clone(),
            name: format!("deck {id}"),
            target_lang: "en-GB".into(),
            native_lang: "ru".into(),
            directions: Directions::Both,
            new_per_day: None,
            archived_at: None,
            created_at: now,
            updated_at: now,
            updated_by: self.id.clone(),
            deleted_at: None,
        };
        self.store.decks.insert(id.clone(), deck);
        self.outbox.insert(("decks", id));
    }

    fn touch_deck(&mut self, id: &str, now: i64, change: impl FnOnce(&mut DeckDto)) {
        let deck = self.store.decks.get_mut(id).expect("known deck");
        change(deck);
        (deck.updated_at, deck.updated_by) = (now, self.id.clone());
        self.outbox.insert(("decks", id.to_string()));
    }

    fn touch_card(&mut self, id: &str, now: i64, change: impl FnOnce(&mut CardDto)) {
        let card = self.store.cards.get_mut(id).expect("known card");
        change(card);
        (card.updated_at, card.updated_by) = (now, self.id.clone());
        self.outbox.insert(("cards", id.to_string()));
    }

    fn touch_state(&mut self, key: &str, now: i64, change: impl FnOnce(&mut CardStateDto)) {
        let state = self.store.card_states.get_mut(key).expect("known state");
        change(state);
        (state.updated_at, state.updated_by) = (now, self.id.clone());
        self.outbox.insert(("card_states", key.to_string()));
    }

    /// Like the client: the deck's cards and their states are deleted with it, with the same `deleted_at`.
    fn delete_deck(&mut self, id: &str, now: i64) {
        self.touch_deck(id, now, |deck| deck.deleted_at = Some(now));
        let cards: Vec<String> = self
            .store
            .cards
            .values()
            .filter(|card| card.deck_id == id && card.deleted_at.is_none())
            .map(|card| card.id.clone())
            .collect();
        for card_id in cards {
            self.delete_card(&card_id, now);
        }
    }

    fn create_card(&mut self, deck_id: &str, now: i64) {
        let id = self.new_id("card");
        let card = CardDto {
            id: id.clone(),
            deck_id: deck_id.to_string(),
            front: format!("front {id}"),
            back: format!("back {id}"),
            example: None,
            example_translation: None,
            ipa: None,
            tags: vec![],
            notes: None,
            audio_id: None,
            created_at: now,
            updated_at: now,
            updated_by: self.id.clone(),
            deleted_at: None,
        };
        self.store.cards.insert(id.clone(), card);
        self.outbox.insert(("cards", id.clone()));
        for direction in [Direction::Forward, Direction::Reverse] {
            let state = CardStateDto {
                card_id: id.clone(),
                direction,
                state: 0,
                due: now,
                stability: 0.0,
                difficulty: 0.0,
                elapsed_days: 0,
                scheduled_days: 0,
                learning_steps: 0,
                reps: 0,
                lapses: 0,
                last_review: None,
                updated_at: now,
                updated_by: self.id.clone(),
                deleted_at: None,
            };
            let key = state.key();
            self.store.card_states.insert(key.clone(), state);
            self.outbox.insert(("card_states", key));
        }
    }

    fn delete_card(&mut self, id: &str, now: i64) {
        self.touch_card(id, now, |card| card.deleted_at = Some(now));
        for direction in ["forward", "reverse"] {
            let key = format!("{id}:{direction}");
            if self.store.card_states.contains_key(&key) {
                self.touch_state(&key, now, |state| state.deleted_at = Some(now));
            }
        }
    }

    fn answer(&mut self, card_id: &str, direction: Direction, now: i64) {
        let key = format!("{card_id}:{}", direction.as_str());
        let Some(before) = self.store.card_states.get(&key).cloned() else {
            return;
        };
        self.touch_state(&key, now, |state| {
            state.state = 2;
            state.reps += 1;
            state.due = now + 1_000;
            state.last_review = Some(now);
        });
        let id = self.new_id("log");
        let log = ReviewLogDto {
            id: id.clone(),
            card_id: card_id.to_string(),
            direction,
            rating: 3,
            mode: ReviewMode::Swipe,
            state_before: json!({ "state": before.state, "due": before.due, "reps": before.reps }),
            reviewed_at: now,
            duration_ms: 1_000,
            practice: now % 2 == 0,
            updated_at: now,
            updated_by: self.id.clone(),
            deleted_at: None,
        };
        self.store.review_log.insert(id.clone(), log);
        self.outbox.insert(("review_log", id));
    }

    /// Undo one of this device's answers: the log gets `deleted_at`, the state goes back to `state_before`.
    fn undo_own_answer(&mut self, rng: &mut StdRng, now: i64) {
        let own: Vec<String> = self
            .store
            .review_log
            .values()
            .filter(|log| log.deleted_at.is_none() && log.id.starts_with(&self.id))
            .map(|log| log.id.clone())
            .collect();
        let Some(id) = pick(rng, own) else {
            return;
        };
        let log = self.store.review_log.get_mut(&id).expect("known log");
        (log.deleted_at, log.updated_at, log.updated_by) = (Some(now), now, self.id.clone());
        let (key, before) = (
            format!("{}:{}", log.card_id, log.direction.as_str()),
            log.state_before.clone(),
        );
        self.outbox.insert(("review_log", id));
        self.touch_state(&key, now, |state| {
            state.state = before["state"].as_i64().unwrap();
            state.due = before["due"].as_i64().unwrap();
            state.reps = before["reps"].as_i64().unwrap();
        });
    }

    fn change_settings(&mut self, new_per_day: i64, now: i64) {
        self.store.settings = Some(SettingsDto {
            data: json!({ "new_per_day": new_per_day }),
            updated_at: now,
            updated_by: self.id.clone(),
        });
        self.outbox.insert(("settings", "settings".into()));
    }

    fn outbox_changes(&self) -> Changes {
        let mut changes = Changes::default();
        for (entity, key) in &self.outbox {
            match *entity {
                "decks" => changes.decks.push(self.store.decks[key].clone()),
                "cards" => changes.cards.push(self.store.cards[key].clone()),
                "card_states" => changes
                    .card_states
                    .push(self.store.card_states[key].clone()),
                "review_log" => changes.review_log.push(self.store.review_log[key].clone()),
                _ => changes.settings = self.store.settings.clone(),
            }
        }
        changes
    }

    /// Push the outbox, then pull pages of a random size until the server has nothing more.
    async fn sync(&mut self, pool: &SqlitePool, user_id: &str, rng: &mut StdRng, seed: u64) {
        let changes = self.outbox_changes();
        let response = push(pool, user_id, &changes, 0).await.unwrap();
        assert!(
            response.rejected.is_empty(),
            "seed {seed}: rejected {:?}",
            response.rejected
        );
        self.outbox.clear();

        loop {
            let page = pull(pool, user_id, self.cursor, rng.random_range(1..=20))
                .await
                .unwrap();
            self.cursor = page.cursor;
            self.store.merge_pulled(page.changes);
            if !page.has_more {
                break;
            }
        }
    }
}

fn live_keys<T>(rows: &BTreeMap<String, T>, deleted_at: impl Fn(&T) -> Option<i64>) -> Vec<String> {
    rows.iter()
        .filter(|(_, row)| deleted_at(row).is_none())
        .map(|(key, _)| key.clone())
        .collect()
}

fn pick(rng: &mut StdRng, keys: Vec<String>) -> Option<String> {
    if keys.is_empty() {
        None
    } else {
        Some(keys[rng.random_range(0..keys.len())].clone())
    }
}

async fn server_store(pool: &SqlitePool, user_id: &str) -> Store {
    let mut store = Store::default();
    let page = pull(pool, user_id, 0, 1000).await.unwrap();
    assert!(!page.has_more);
    store.merge_pulled(page.changes);
    store
}

async fn new_user(pool: &SqlitePool, seed: u64) -> String {
    let id = format!("user-{seed}");
    sqlx::query("INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, 'Sim', '-', 0)")
        .bind(&id)
        .bind(format!("{id}@example.com"))
        .execute(pool)
        .await
        .unwrap();
    id
}

async fn run_scenario(pool: &SqlitePool, seed: u64) {
    let mut rng = StdRng::seed_from_u64(seed);
    let user_id = new_user(pool, seed).await;
    // Skews up to ±5 ms make equal timestamps from both devices common, so the device-id tie-break is exercised.
    // Ids start with the seed: all scenarios share one database, and ids are global.
    let mut devices = [
        Device::new(&format!("s{seed}-device-a"), rng.random_range(-5..=5)),
        Device::new(&format!("s{seed}-device-b"), rng.random_range(-5..=5)),
    ];
    let mut clock = 1_000;

    for _ in 0..STEPS {
        clock += rng.random_range(1..=3);
        let device = &mut devices[rng.random_range(0..2)];
        if rng.random_bool(0.2) {
            device.sync(pool, &user_id, &mut rng, seed).await;
        } else {
            device.edit(&mut rng, clock);
        }
    }

    // Final round: a pushes and pulls, b pushes and pulls everything, a pulls b's last changes.
    for index in [0, 1, 0] {
        devices[index].sync(pool, &user_id, &mut rng, seed).await;
    }
    let server = server_store(pool, &user_id).await;
    for device in &devices {
        assert!(
            device.outbox.is_empty(),
            "seed {seed}: {} has unsynced changes",
            device.id
        );
        assert!(
            device.store == server,
            "seed {seed}: {} differs from the server\n device: {:#?}\n server: {:#?}",
            device.id,
            device.store,
            server
        );
    }
}

/// `cargo test sync_convergence`
#[sqlx::test]
async fn sync_convergence(pool: SqlitePool) {
    for seed in 0..SCENARIOS {
        run_scenario(&pool, seed).await;
    }
}
