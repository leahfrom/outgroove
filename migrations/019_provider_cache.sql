CREATE TABLE provider_cache (
  provider TEXT NOT NULL,
  request_key TEXT NOT NULL,
  response_schema_version INTEGER NOT NULL,
  status INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (provider, request_key)
) WITHOUT ROWID;
CREATE INDEX provider_cache_expiry
  ON provider_cache(provider, expires_at);
