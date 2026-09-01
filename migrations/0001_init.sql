CREATE TABLE users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  provider          TEXT NOT NULL,
  provider_user_id  TEXT NOT NULL,
  username          TEXT NOT NULL,
  avatar_url        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_user_id)
);

CREATE TABLE trips (
  id                 TEXT PRIMARY KEY,
  user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL DEFAULT 'Untitled trip',
  note               TEXT,
  visibility         TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  share_token        TEXT UNIQUE,
  path_geojson       TEXT NOT NULL,
  point_count        INTEGER NOT NULL,
  distance_m         REAL NOT NULL,
  duration_s         REAL NOT NULL,
  elevation_gain_m   REAL,
  elevation_loss_m   REAL,
  avg_speed_kmh      REAL,
  max_speed_kmh      REAL,
  started_at         TEXT NOT NULL,
  ended_at           TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_trips_user_id     ON trips(user_id);
CREATE INDEX idx_trips_share_token ON trips(share_token);
