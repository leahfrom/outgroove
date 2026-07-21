ALTER TABLE edit_operations ADD COLUMN kind TEXT NOT NULL DEFAULT 'album-title-edit'
  CHECK (kind IN ('album-title-edit', 'album-title-undo'));
ALTER TABLE edit_operations ADD COLUMN source_operation_id TEXT
  REFERENCES edit_operations(id);
CREATE INDEX edit_operations_album_created
  ON edit_operations(album_id, created_at DESC);
CREATE INDEX tag_snapshots_operation_id ON tag_snapshots(operation_id);
