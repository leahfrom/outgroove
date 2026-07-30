CREATE TABLE sync_run_changes_next (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('copy', 'playlist', 'manifest', 'removal')),
  relative_destination TEXT NOT NULL,
  temporary_relative TEXT NOT NULL,
  rollback_relative TEXT,
  expected_hash TEXT NOT NULL,
  installed INTEGER NOT NULL DEFAULT 0 CHECK (installed IN (0, 1)),
  UNIQUE (run_id, sequence),
  UNIQUE (run_id, relative_destination)
);

INSERT INTO sync_run_changes_next
  (id, run_id, sequence, kind, relative_destination, temporary_relative,
   rollback_relative, expected_hash, installed)
SELECT id, run_id, sequence, kind, relative_destination, temporary_relative,
  rollback_relative, expected_hash, installed
FROM sync_run_changes;

DROP TABLE sync_run_changes;
ALTER TABLE sync_run_changes_next RENAME TO sync_run_changes;
CREATE INDEX sync_run_changes_run_sequence
  ON sync_run_changes(run_id, sequence);
