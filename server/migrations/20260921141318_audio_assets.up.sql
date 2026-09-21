-- Pronunciation clips (architecture.md §5.4, §7, ADR-6). Stored as BLOBs next to the data so Litestream backs them
-- up too. A card points to its clip through cards.audio_id; removing the audio from a card keeps the row (orphans
-- are purged by the maintenance job, P4-T07).

CREATE TABLE audio_assets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  card_id     TEXT NOT NULL REFERENCES cards(id),
  source      TEXT NOT NULL,              -- 'azure' | 'commons'
  mime        TEXT NOT NULL,              -- 'audio/mpeg'
  voice       TEXT,
  attribution TEXT,                       -- author + license for Commons
  bytes       BLOB NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_audio_card ON audio_assets(card_id);
