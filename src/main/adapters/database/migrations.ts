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
  {
    version: 5,
    sql: `
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

    `,
  },
  {
    version: 6,
    sql: `
      ALTER TABLE edit_operations ADD COLUMN kind TEXT NOT NULL DEFAULT 'album-title-edit'
        CHECK (kind IN ('album-title-edit', 'album-title-undo'));
      ALTER TABLE edit_operations ADD COLUMN source_operation_id TEXT
        REFERENCES edit_operations(id);
      CREATE INDEX edit_operations_album_created
        ON edit_operations(album_id, created_at DESC);
      CREATE INDEX tag_snapshots_operation_id ON tag_snapshots(operation_id);
    `,
  },
  {
    version: 7,
    sql: `
      CREATE TABLE edit_operations_next (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL REFERENCES albums(id),
        proposed_title TEXT NOT NULL,
        confirmation_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('previewed', 'applying', 'completed', 'failed')),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        kind TEXT NOT NULL DEFAULT 'album-title-edit'
          CHECK (kind IN ('album-title-edit', 'album-title-undo', 'track-tags-edit')),
        source_operation_id TEXT REFERENCES edit_operations_next(id),
        target_file_id TEXT REFERENCES audio_files(id),
        preview_tags_json TEXT,
        proposed_tags_json TEXT
      );
      INSERT INTO edit_operations_next
        (id, album_id, proposed_title, confirmation_hash, state, created_at,
         completed_at, kind, source_operation_id)
      SELECT id, album_id, proposed_title, confirmation_hash, state, created_at,
        completed_at, kind, source_operation_id
      FROM edit_operations;
      CREATE TABLE tag_snapshots_next (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES edit_operations_next(id),
        file_id TEXT NOT NULL REFERENCES audio_files(id),
        before_tags_json TEXT NOT NULL,
        after_tags_json TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      INSERT INTO tag_snapshots_next
        (id, operation_id, file_id, before_tags_json, after_tags_json, verified, error)
      SELECT id, operation_id, file_id, before_tags_json, after_tags_json, verified, error
      FROM tag_snapshots;
      DROP TABLE tag_snapshots;
      DROP TABLE edit_operations;
      ALTER TABLE edit_operations_next RENAME TO edit_operations;
      ALTER TABLE tag_snapshots_next RENAME TO tag_snapshots;
      CREATE INDEX edit_operations_album_created
        ON edit_operations(album_id, created_at DESC);
      CREATE INDEX tag_snapshots_operation_id ON tag_snapshots(operation_id);
    `,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE edit_operations_next (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL REFERENCES albums(id),
        proposed_title TEXT NOT NULL,
        confirmation_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('previewed', 'applying', 'completed', 'failed')),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        kind TEXT NOT NULL DEFAULT 'album-title-edit'
          CHECK (kind IN ('album-title-edit', 'album-title-undo', 'track-tags-edit', 'track-tags-undo')),
        source_operation_id TEXT REFERENCES edit_operations_next(id),
        target_file_id TEXT REFERENCES audio_files(id),
        preview_tags_json TEXT,
        proposed_tags_json TEXT
      );
      INSERT INTO edit_operations_next
        (id, album_id, proposed_title, confirmation_hash, state, created_at,
         completed_at, kind, source_operation_id, target_file_id,
         preview_tags_json, proposed_tags_json)
      SELECT id, album_id, proposed_title, confirmation_hash, state, created_at,
        completed_at, kind, source_operation_id, target_file_id,
        preview_tags_json, proposed_tags_json
      FROM edit_operations;
      CREATE TABLE tag_snapshots_next (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES edit_operations_next(id),
        file_id TEXT NOT NULL REFERENCES audio_files(id),
        before_tags_json TEXT NOT NULL,
        after_tags_json TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      INSERT INTO tag_snapshots_next
        (id, operation_id, file_id, before_tags_json, after_tags_json, verified, error)
      SELECT id, operation_id, file_id, before_tags_json, after_tags_json, verified, error
      FROM tag_snapshots;
      DROP TABLE tag_snapshots;
      DROP TABLE edit_operations;
      ALTER TABLE edit_operations_next RENAME TO edit_operations;
      ALTER TABLE tag_snapshots_next RENAME TO tag_snapshots;
      CREATE INDEX edit_operations_album_created
        ON edit_operations(album_id, created_at DESC);
      CREATE INDEX tag_snapshots_operation_id ON tag_snapshots(operation_id);
    `,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE edit_operations_next (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL REFERENCES albums(id),
        proposed_title TEXT NOT NULL,
        confirmation_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('previewed', 'applying', 'completed', 'failed')),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        kind TEXT NOT NULL DEFAULT 'album-title-edit'
          CHECK (kind IN ('album-title-edit', 'album-title-undo', 'track-tags-edit', 'track-tags-undo', 'track-tags-batch-edit')),
        source_operation_id TEXT REFERENCES edit_operations_next(id),
        target_file_id TEXT REFERENCES audio_files(id),
        preview_tags_json TEXT,
        proposed_tags_json TEXT
      );
      INSERT INTO edit_operations_next
        (id, album_id, proposed_title, confirmation_hash, state, created_at,
         completed_at, kind, source_operation_id, target_file_id,
         preview_tags_json, proposed_tags_json)
      SELECT id, album_id, proposed_title, confirmation_hash, state, created_at,
        completed_at, kind, source_operation_id, target_file_id,
        preview_tags_json, proposed_tags_json
      FROM edit_operations;
      CREATE TABLE tag_snapshots_next (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES edit_operations_next(id),
        file_id TEXT NOT NULL REFERENCES audio_files(id),
        before_tags_json TEXT NOT NULL,
        after_tags_json TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      INSERT INTO tag_snapshots_next
        (id, operation_id, file_id, before_tags_json, after_tags_json, verified, error)
      SELECT id, operation_id, file_id, before_tags_json, after_tags_json, verified, error
      FROM tag_snapshots;
      DROP TABLE tag_snapshots;
      DROP TABLE edit_operations;
      ALTER TABLE edit_operations_next RENAME TO edit_operations;
      ALTER TABLE tag_snapshots_next RENAME TO tag_snapshots;
      CREATE INDEX edit_operations_album_created
        ON edit_operations(album_id, created_at DESC);
      CREATE INDEX tag_snapshots_operation_id ON tag_snapshots(operation_id);
    `,
  },
  {
    version: 10,
    sql: `
      CREATE TABLE edit_operations_next (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL REFERENCES albums(id),
        proposed_title TEXT NOT NULL,
        confirmation_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('previewed', 'applying', 'completed', 'failed')),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        kind TEXT NOT NULL DEFAULT 'album-title-edit'
          CHECK (kind IN ('album-title-edit', 'album-title-undo', 'track-tags-edit', 'track-tags-undo', 'track-tags-batch-edit', 'track-tags-batch-undo')),
        source_operation_id TEXT REFERENCES edit_operations_next(id),
        target_file_id TEXT REFERENCES audio_files(id),
        preview_tags_json TEXT,
        proposed_tags_json TEXT
      );
      INSERT INTO edit_operations_next
        (id, album_id, proposed_title, confirmation_hash, state, created_at,
         completed_at, kind, source_operation_id, target_file_id,
         preview_tags_json, proposed_tags_json)
      SELECT id, album_id, proposed_title, confirmation_hash, state, created_at,
        completed_at, kind, source_operation_id, target_file_id,
        preview_tags_json, proposed_tags_json
      FROM edit_operations;
      CREATE TABLE tag_snapshots_next (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES edit_operations_next(id),
        file_id TEXT NOT NULL REFERENCES audio_files(id),
        before_tags_json TEXT NOT NULL,
        after_tags_json TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      INSERT INTO tag_snapshots_next
        (id, operation_id, file_id, before_tags_json, after_tags_json, verified, error)
      SELECT id, operation_id, file_id, before_tags_json, after_tags_json, verified, error
      FROM tag_snapshots;
      DROP TABLE tag_snapshots;
      DROP TABLE edit_operations;
      ALTER TABLE edit_operations_next RENAME TO edit_operations;
      ALTER TABLE tag_snapshots_next RENAME TO tag_snapshots;
      CREATE INDEX edit_operations_album_created
        ON edit_operations(album_id, created_at DESC);
      CREATE INDEX tag_snapshots_operation_id ON tag_snapshots(operation_id);
    `,
  },
  {
    version: 11,
    sql: `
      CREATE TABLE edit_operations_next (
        id TEXT PRIMARY KEY,
        album_id TEXT NOT NULL REFERENCES albums(id),
        proposed_title TEXT NOT NULL,
        confirmation_hash TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('previewed', 'applying', 'completed', 'failed')),
        created_at TEXT NOT NULL,
        completed_at TEXT,
        kind TEXT NOT NULL DEFAULT 'album-title-edit'
          CHECK (kind IN ('album-title-edit', 'album-title-undo', 'track-tags-edit', 'track-tags-undo', 'track-tags-batch-edit', 'track-tags-batch-undo', 'track-number-sequence-edit')),
        source_operation_id TEXT REFERENCES edit_operations_next(id),
        target_file_id TEXT REFERENCES audio_files(id),
        preview_tags_json TEXT,
        proposed_tags_json TEXT
      );
      INSERT INTO edit_operations_next
        (id, album_id, proposed_title, confirmation_hash, state, created_at,
         completed_at, kind, source_operation_id, target_file_id,
         preview_tags_json, proposed_tags_json)
      SELECT id, album_id, proposed_title, confirmation_hash, state, created_at,
        completed_at, kind, source_operation_id, target_file_id,
        preview_tags_json, proposed_tags_json
      FROM edit_operations;
      CREATE TABLE tag_snapshots_next (
        id TEXT PRIMARY KEY,
        operation_id TEXT NOT NULL REFERENCES edit_operations_next(id),
        file_id TEXT NOT NULL REFERENCES audio_files(id),
        before_tags_json TEXT NOT NULL,
        after_tags_json TEXT NOT NULL,
        verified INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      INSERT INTO tag_snapshots_next
        (id, operation_id, file_id, before_tags_json, after_tags_json, verified, error)
      SELECT id, operation_id, file_id, before_tags_json, after_tags_json, verified, error
      FROM tag_snapshots;
      DROP TABLE tag_snapshots;
      DROP TABLE edit_operations;
      ALTER TABLE edit_operations_next RENAME TO edit_operations;
      ALTER TABLE tag_snapshots_next RENAME TO tag_snapshots;
      CREATE INDEX edit_operations_album_created
        ON edit_operations(album_id, created_at DESC);
      CREATE INDEX tag_snapshots_operation_id ON tag_snapshots(operation_id);
    `,
  },
  {
    version: 12,
    sql: `
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
    `,
  },
  {
    version: 13,
    sql: `
      ALTER TABLE library_roots ADD COLUMN removed_at TEXT;
      CREATE INDEX library_roots_watched_created
        ON library_roots(created_at) WHERE removed_at IS NULL;
    `,
  },
];
