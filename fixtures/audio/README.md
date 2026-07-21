# Audio fixtures

These files are generated from sub-second sine waves and are redistributable under CC0-1.0. They contain no third-party audio content. `corrupt.mp3` is intentionally malformed.

`preservation/` adds MP3 and FLAC fixtures with Unicode text, comments, a
private field, a MusicBrainz-style recording identifier, track/disc totals, and
an embedded generated 16×16 cover. `corrupt/` contains distinct truncated MP3,
FLAC, and invalid Ogg shapes. Regenerate these assets with `npm run
fixtures:generate`; FFmpeg is required only for regeneration, not installation
or tests.

Regeneration uses FFmpeg's `sine` source. The checked-in files are the canonical test inputs; tests copy them to temporary directories before any write.
