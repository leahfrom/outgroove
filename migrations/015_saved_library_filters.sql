CREATE TABLE saved_library_filters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 100),
  definition_version INTEGER NOT NULL CHECK (definition_version = 1),
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
