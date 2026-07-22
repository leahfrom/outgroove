ALTER TABLE library_roots ADD COLUMN removed_at TEXT;
CREATE INDEX library_roots_watched_created
  ON library_roots(created_at) WHERE removed_at IS NULL;
