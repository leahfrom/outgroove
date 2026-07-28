CREATE TABLE radar_background_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  pause_on_battery INTEGER NOT NULL DEFAULT 1 CHECK (pause_on_battery IN (0, 1)),
  next_refresh_at TEXT,
  last_checked_at TEXT,
  last_successful_refresh_at TEXT,
  last_outcome TEXT CHECK (
    last_outcome IS NULL OR last_outcome IN (
      'success', 'partial', 'failed', 'cancelled', 'offline', 'battery', 'busy'
    )
  ),
  last_completed_count INTEGER NOT NULL DEFAULT 0 CHECK (last_completed_count >= 0),
  last_succeeded_count INTEGER NOT NULL DEFAULT 0 CHECK (last_succeeded_count >= 0),
  last_failed_count INTEGER NOT NULL DEFAULT 0 CHECK (last_failed_count >= 0)
);

INSERT INTO radar_background_settings (id) VALUES (1);
