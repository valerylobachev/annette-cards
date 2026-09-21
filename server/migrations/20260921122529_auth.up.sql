-- Accounts, invite codes and login sessions (architecture.md §5.4). Timestamps are ms since epoch.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,           -- UUIDv7
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,              -- Argon2id PHC string
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE invites (
  code        TEXT PRIMARY KEY,             -- random, 12 chars
  created_by  TEXT NOT NULL REFERENCES users(id),
  note        TEXT,
  expires_at  INTEGER NOT NULL,
  used_by     TEXT REFERENCES users(id),
  used_at     INTEGER
);

CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,            -- hex sha256 of the cookie value
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_label TEXT,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
