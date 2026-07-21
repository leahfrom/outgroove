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
