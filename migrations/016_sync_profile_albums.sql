CREATE TABLE sync_profile_albums (
  profile_id TEXT NOT NULL REFERENCES sync_profiles(id) ON DELETE CASCADE,
  album_id TEXT NOT NULL REFERENCES albums(id),
  PRIMARY KEY (profile_id, album_id)
) WITHOUT ROWID;

CREATE INDEX sync_profile_albums_album_id
  ON sync_profile_albums(album_id, profile_id);

INSERT INTO sync_profile_albums (profile_id, album_id)
  SELECT id, album_id FROM sync_profiles;
