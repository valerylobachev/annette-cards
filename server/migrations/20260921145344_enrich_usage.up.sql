-- AI enrichment quota (architecture.md §5.4, §8): successful POST /api/enrich requests per user and UTC day.

CREATE TABLE enrich_usage (
  user_id TEXT NOT NULL REFERENCES users(id),
  day     TEXT NOT NULL,                  -- YYYY-MM-DD (UTC)
  count   INTEGER NOT NULL,
  PRIMARY KEY (user_id, day)
);
