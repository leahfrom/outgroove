CREATE TABLE sync_runs (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  profile_id TEXT NOT NULL UNIQUE REFERENCES sync_profiles(id) ON DELETE CASCADE,
  target_path TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('copying', 'finalizing')),
  state TEXT NOT NULL CHECK (state IN ('applying', 'recovery-required', 'committed-cleanup')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX sync_runs_state_updated ON sync_runs(state, updated_at DESC);

CREATE TABLE sync_run_changes (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('copy', 'playlist', 'manifest')),
  relative_destination TEXT NOT NULL,
  temporary_relative TEXT NOT NULL,
  rollback_relative TEXT,
  expected_hash TEXT NOT NULL,
  installed INTEGER NOT NULL DEFAULT 0 CHECK (installed IN (0, 1)),
  UNIQUE (run_id, sequence),
  UNIQUE (run_id, relative_destination)
);
CREATE INDEX sync_run_changes_run_sequence
  ON sync_run_changes(run_id, sequence);
