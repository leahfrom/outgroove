CREATE INDEX albums_browse_order ON albums(album_artist, title, id);
CREATE INDEX audio_files_scan_state_path ON audio_files(scan_state, path);
