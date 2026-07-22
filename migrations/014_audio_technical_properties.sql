ALTER TABLE audio_files ADD COLUMN codec TEXT;
ALTER TABLE audio_files ADD COLUMN bitrate REAL;
ALTER TABLE audio_files ADD COLUMN sample_rate INTEGER;
ALTER TABLE audio_files ADD COLUMN bit_depth INTEGER;
ALTER TABLE audio_files ADD COLUMN channels INTEGER;
ALTER TABLE audio_files ADD COLUMN technical_properties_version INTEGER NOT NULL DEFAULT 0;
