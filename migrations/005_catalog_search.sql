CREATE TABLE catalog_search_documents (
  id INTEGER PRIMARY KEY,
  file_id TEXT NOT NULL UNIQUE,
  album_id TEXT NOT NULL,
  track_title TEXT NOT NULL,
  track_artist TEXT NOT NULL,
  file_path TEXT NOT NULL,
  format TEXT NOT NULL
);

INSERT INTO catalog_search_documents
  (file_id, album_id, track_title, track_artist, file_path, format)
SELECT f.id, t.album_id, t.title,
  COALESCE(json_extract(f.normalized_tags_json, '$.artist'), ''),
  f.path, COALESCE(f.format, '')
FROM tracks t
JOIN audio_files f ON f.id = t.file_id;

CREATE VIRTUAL TABLE catalog_search USING fts5(
  track_title,
  track_artist,
  file_path,
  format,
  content='catalog_search_documents',
  content_rowid='id',
  tokenize='trigram'
);
INSERT INTO catalog_search(catalog_search) VALUES ('rebuild');

CREATE TABLE catalog_visible_albums (
  album_id TEXT PRIMARY KEY
) WITHOUT ROWID;
INSERT INTO catalog_visible_albums(album_id)
SELECT DISTINCT t.album_id FROM tracks t
JOIN audio_files f ON f.id=t.file_id
WHERE f.scan_state='ok';
