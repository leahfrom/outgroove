ALTER TABLE radar_background_settings
  ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (notifications_enabled IN (0, 1));
