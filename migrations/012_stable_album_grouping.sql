CREATE TABLE album_grouping_aliases (
  grouping_key TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE
);
CREATE INDEX album_grouping_aliases_album_id
  ON album_grouping_aliases(album_id);
INSERT INTO album_grouping_aliases (grouping_key, album_id)
  SELECT grouping_key, id FROM albums;
CREATE TABLE album_folder_aliases (
  folder_album_key TEXT PRIMARY KEY,
  album_id TEXT NOT NULL REFERENCES albums(id) ON DELETE CASCADE
);
CREATE INDEX album_folder_aliases_album_id
  ON album_folder_aliases(album_id);
CREATE TABLE catalog_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO catalog_metadata (key, value)
  VALUES ('album-grouping-reconciliation', 'pending');
