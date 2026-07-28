ALTER TABLE favorite_artists
  ADD COLUMN last_successful_refresh_at TEXT;
ALTER TABLE favorite_artists
  ADD COLUMN last_provider_fetch_at TEXT;
ALTER TABLE favorite_artists
  ADD COLUMN last_refresh_truncated INTEGER NOT NULL DEFAULT 0
    CHECK (last_refresh_truncated IN (0, 1));

CREATE TABLE radar_items (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  favorite_artist_id TEXT NOT NULL
    REFERENCES favorite_artists(id) ON DELETE CASCADE,
  musicbrainz_release_group_id TEXT NOT NULL CHECK (length(musicbrainz_release_group_id) = 36),
  representative_release_id TEXT NOT NULL CHECK (length(representative_release_id) = 36),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 1000),
  primary_type TEXT,
  secondary_types_json TEXT NOT NULL,
  first_release_date TEXT,
  release_status TEXT,
  country TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  discovered_after_baseline INTEGER NOT NULL
    CHECK (discovered_after_baseline IN (0, 1)),
  present INTEGER NOT NULL CHECK (present IN (0, 1)),
  seen_at TEXT,
  dismissed_at TEXT,
  UNIQUE (favorite_artist_id, musicbrainz_release_group_id)
);
CREATE INDEX radar_items_current_browse
  ON radar_items(present, dismissed_at, first_release_date, title, id);
CREATE INDEX radar_items_favorite
  ON radar_items(favorite_artist_id, present, musicbrainz_release_group_id);
