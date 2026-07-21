CREATE TABLE scan_directory_errors (
  root_id TEXT NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  path_key TEXT NOT NULL,
  message TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  PRIMARY KEY (root_id, path_key)
);
CREATE INDEX scan_directory_errors_path ON scan_directory_errors(path);
