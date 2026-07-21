CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type = 'scan'),
  root_id TEXT NOT NULL REFERENCES library_roots(id),
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'cancelling', 'completed', 'cancelled', 'failed', 'interrupted')),
  completed INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  detail TEXT NOT NULL DEFAULT '',
  result_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX jobs_root_created ON jobs(root_id, created_at DESC);
