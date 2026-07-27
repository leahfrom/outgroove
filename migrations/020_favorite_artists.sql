CREATE TABLE favorite_artists (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  musicbrainz_artist_id TEXT NOT NULL UNIQUE CHECK (length(musicbrainz_artist_id) = 36),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 1000),
  sort_name TEXT NOT NULL CHECK (length(sort_name) BETWEEN 1 AND 1000),
  disambiguation TEXT,
  artist_type TEXT,
  country TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX favorite_artists_browse_order
  ON favorite_artists(sort_name COLLATE NOCASE, sort_name, name, id);
