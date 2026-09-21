-- Synced entities (architecture.md §5.4, §6). Every row carries user_id, the LWW stamp (updated_at, updated_by),
-- a soft-delete marker and server_seq, the pull cursor allocated from sync_seq. Timestamps are ms since epoch.

CREATE TABLE sync_seq (id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL);
INSERT INTO sync_seq (id, value) VALUES (1, 0);

CREATE TABLE decks (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  target_lang  TEXT NOT NULL,             -- BCP-47, e.g. en-GB, pl-PL
  native_lang  TEXT NOT NULL,             -- e.g. ru
  directions   TEXT NOT NULL,             -- 'forward' | 'reverse' | 'both'
  new_per_day  INTEGER,                   -- NULL = global setting
  archived_at  INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT NOT NULL,
  deleted_at   INTEGER,
  server_seq   INTEGER NOT NULL
);

CREATE TABLE cards (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  deck_id             TEXT NOT NULL REFERENCES decks(id),
  front               TEXT NOT NULL,
  back                TEXT NOT NULL,
  example             TEXT,
  example_translation TEXT,
  ipa                 TEXT,
  tags                TEXT NOT NULL DEFAULT '[]',   -- JSON array
  notes               TEXT,
  audio_id            TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  updated_by          TEXT NOT NULL,
  deleted_at          INTEGER,
  server_seq          INTEGER NOT NULL
);

CREATE TABLE card_states (
  card_id        TEXT NOT NULL REFERENCES cards(id),
  direction      TEXT NOT NULL,           -- 'forward' | 'reverse'
  user_id        TEXT NOT NULL REFERENCES users(id),
  state          INTEGER NOT NULL,        -- 0 New, 1 Learning, 2 Review, 3 Relearning
  due            INTEGER NOT NULL,
  stability      REAL NOT NULL,
  difficulty     REAL NOT NULL,
  elapsed_days   INTEGER NOT NULL,
  scheduled_days INTEGER NOT NULL,
  learning_steps INTEGER NOT NULL,
  reps           INTEGER NOT NULL,
  lapses         INTEGER NOT NULL,
  last_review    INTEGER,
  updated_at     INTEGER NOT NULL,
  updated_by     TEXT NOT NULL,
  deleted_at     INTEGER,
  server_seq     INTEGER NOT NULL,
  PRIMARY KEY (card_id, direction)
);

CREATE TABLE review_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  card_id      TEXT NOT NULL REFERENCES cards(id),
  direction    TEXT NOT NULL,
  rating       INTEGER NOT NULL,          -- 1 Again, 2 Hard, 3 Good, 4 Easy
  mode         TEXT NOT NULL,             -- 'swipe' | 'choice' | 'listen' | 'typing'
  state_before TEXT NOT NULL,             -- JSON snapshot (for undo / rebuild)
  reviewed_at  INTEGER NOT NULL,
  duration_ms  INTEGER NOT NULL,
  practice     INTEGER NOT NULL DEFAULT 0, -- 1 = answered in practice mode (UC-16, decision D2)
  updated_at   INTEGER NOT NULL,
  updated_by   TEXT NOT NULL,
  deleted_at   INTEGER,
  server_seq   INTEGER NOT NULL
);

CREATE TABLE user_settings (
  user_id     TEXT PRIMARY KEY REFERENCES users(id),
  data        TEXT NOT NULL,              -- JSON, architecture.md §5.5
  updated_at  INTEGER NOT NULL,
  updated_by  TEXT NOT NULL,
  server_seq  INTEGER NOT NULL
);

CREATE INDEX idx_decks_user_seq        ON decks(user_id, server_seq);
CREATE INDEX idx_cards_user_seq        ON cards(user_id, server_seq);
CREATE INDEX idx_states_user_seq       ON card_states(user_id, server_seq);
CREATE INDEX idx_states_user_due       ON card_states(user_id, due);
CREATE INDEX idx_log_user_seq          ON review_log(user_id, server_seq);
CREATE INDEX idx_log_user_reviewed     ON review_log(user_id, reviewed_at);
