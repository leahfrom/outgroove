# ADR 0003: Emit ID3v2.4 for MP3 metadata edits

- Status: accepted
- Date: 2026-07-21

## Context

ADR 0001 selected `@akabeko/music-metadata-editor` after a narrow MP3 fixture
preserved a private field and audio packets. A richer generated fixture exposed
that the library's default ID3v2.3 write path encodes text as Latin-1. Changing
only the album title therefore corrupted an existing Unicode artist such as
`Fixture Artist – 東京`. An album-only call to the lower-level API avoided that
encoding error with ID3v2.4, but discarded other known fields because the
library treats the supplied tag object as the complete known-tag projection.

## Decision

For MP3 writes, load the complete tag projection, replace only the album value,
and call the library's public `writeMetadata` entry point with
`id3v2MajorVersion: 4`. Keep the existing same-volume temporary output,
flush, payload comparison, replacement, re-read, verification, and rollback
sequence. FLAC continues through the existing `loadTrack`/`saveTrack` path.

Keep generated preservation fixtures for MP3 and FLAC containing Unicode text,
embedded artwork, track/disc totals, a comment, a MusicBrainz-style recording
identifier, and a private field. The regression test compares those values and
the independently located audio payload before and after an album-only edit.

## Consequences

- Outgroove upgrades edited MP3 metadata to ID3v2.4 instead of retaining an
  input file's ID3v2 major version.
- The adapter depends on an implemented MP3-specific option that is described
  in the installed package's declarations but is not part of its base
  `WriteOptions` type. The local intersection type and preservation test make
  that dependency explicit; a library upgrade must rerun this corpus.
- MP3 writing remains enabled because the complete round trip now preserves all
  advertised fixture fields and audio. This does not establish safety for every
  uncommon ID3 frame; new preservation claims require new fixtures.
