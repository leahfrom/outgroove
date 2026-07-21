export const migrations: readonly { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE library_roots (id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, path_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, last_scan_at TEXT);
      CREATE TABLE albums (id TEXT PRIMARY KEY, grouping_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, album_artist TEXT NOT NULL);
      CREATE TABLE audio_files (
        id TEXT PRIMARY KEY, root_id TEXT NOT NULL REFERENCES library_roots(id), path TEXT NOT NULL UNIQUE, path_key TEXT NOT NULL UNIQUE,
        size INTEGER NOT NULL, modified_ms REAL NOT NULL, signature TEXT NOT NULL, format TEXT, duration_seconds REAL,
        normalized_tags_json TEXT, native_tags_json TEXT, scan_state TEXT NOT NULL CHECK (scan_state IN ('ok', 'error', 'missing')),
        scan_error TEXT, scanned_at TEXT NOT NULL
      );
      CREATE INDEX audio_files_root_signature ON audio_files(root_id, path_key, size, modified_ms);
      CREATE TABLE tracks (
        id TEXT PRIMARY KEY, file_id TEXT NOT NULL UNIQUE REFERENCES audio_files(id) ON DELETE CASCADE,
        album_id TEXT NOT NULL REFERENCES albums(id), title TEXT NOT NULL, track_number INTEGER, disc_number INTEGER
      );
      CREATE INDEX tracks_album_id ON tracks(album_id);
      CREATE TABLE edit_operations (
        id TEXT PRIMARY KEY, album_id TEXT NOT NULL REFERENCES albums(id), proposed_title TEXT NOT NULL, confirmation_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('previewed', 'applying', 'completed', 'failed')), created_at TEXT NOT NULL, completed_at TEXT
      );
      CREATE TABLE tag_snapshots (
        id TEXT PRIMARY KEY, operation_id TEXT NOT NULL REFERENCES edit_operations(id), file_id TEXT NOT NULL REFERENCES audio_files(id),
        before_tags_json TEXT NOT NULL, after_tags_json TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, error TEXT
      );
      CREATE TABLE sync_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, target_path TEXT NOT NULL, album_id TEXT NOT NULL REFERENCES albums(id), created_at TEXT NOT NULL);
      CREATE TABLE sync_manifests (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES sync_profiles(id), target_path TEXT NOT NULL, created_at TEXT NOT NULL, manifest_json TEXT NOT NULL);
      CREATE TABLE sync_entries (
        id TEXT PRIMARY KEY, manifest_id TEXT NOT NULL REFERENCES sync_manifests(id), source_file_id TEXT NOT NULL REFERENCES audio_files(id),
        relative_destination TEXT NOT NULL, source_signature TEXT NOT NULL, size INTEGER NOT NULL, UNIQUE(manifest_id, relative_destination)
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE jobs (
        id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type = 'scan'), root_id TEXT NOT NULL REFERENCES library_roots(id),
        state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'cancelling', 'completed', 'cancelled', 'failed', 'interrupted')),
        completed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, detail TEXT NOT NULL DEFAULT '',
        result_json TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT
      );
      CREATE INDEX jobs_root_created ON jobs(root_id, created_at DESC);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE INDEX albums_browse_order ON albums(album_artist, title, id);
      CREATE INDEX audio_files_scan_state_path ON audio_files(scan_state, path);
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE scan_directory_errors (
        root_id TEXT NOT NULL REFERENCES library_roots(id) ON DELETE CASCADE,
        path TEXT NOT NULL, path_key TEXT NOT NULL, message TEXT NOT NULL, scanned_at TEXT NOT NULL,
        PRIMARY KEY (root_id, path_key)
      );
      CREATE INDEX scan_directory_errors_path ON scan_directory_errors(path);
    `,
  },
];
