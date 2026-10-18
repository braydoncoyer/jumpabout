-- Jumpabout global leaderboard
CREATE TABLE IF NOT EXISTS scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,             -- 3 characters, A-Z 0-9 space . - !
  score      INTEGER NOT NULL,
  level      INTEGER NOT NULL,             -- level reached
  speed      INTEGER NOT NULL,             -- run speed 1..8
  ip_hash    TEXT    NOT NULL,             -- salted SHA-256, only used for rate limiting
  created_at INTEGER NOT NULL              -- unix ms
);

CREATE INDEX IF NOT EXISTS scores_by_score ON scores (score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS scores_by_ip ON scores (ip_hash, created_at);
