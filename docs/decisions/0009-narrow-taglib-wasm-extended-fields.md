# ADR 0009: Narrow TagLib-Wasm stage for extended MP3 and FLAC fields

- Status: accepted
- Date: 2026-07-27

## Context

ADR 0001 selected `@akabeko/music-metadata-editor` as Outgroove's production
writer and retained `taglib-wasm` only as a development comparison. The primary
writer now safely covers common text, dates, credits, numbering, and artwork,
but it cannot write a consistent MP3-and-FLAC representation for compilation
state, grouping, catalog number, or the MusicBrainz identifier family. Those
fields are part of the planned common-tag workflow. Superficially exposing them
with format-dependent behavior would violate Outgroove's preview and
verification guarantees.

The checked-in preservation corpus demonstrates that `taglib-wasm` 1.5.3 can
set and clear those exact properties in MP3 and FLAC while preserving private
tags, embedded artwork, and the independently hashed audio payload. Its
JavaScript/TypeScript wrapper is MIT licensed. Its separately loaded TagLib
WebAssembly binaries are LGPL-2.1-or-later and require distribution notices,
corresponding source availability, and a practical replacement/relink path.

## Decision

Keep `@akabeko/music-metadata-editor` as the primary writer. Add a narrowly
scoped second stage using pinned `taglib-wasm` 1.5.3 only for:

- grouping and catalog number;
- compilation state;
- MusicBrainz recording, release-track, release, track-artist,
  release-artist, release-group, and work identifiers.

Both stages operate only on the same-volume candidate file. Neither stage
receives permission to edit the source path. Outgroove then flushes, re-reads,
verifies every targeted normalized value, checks the audio-payload hash,
installs the candidate through the existing rollback replacement, and re-reads
again. A failure at either stage leaves or restores the source.

The WebAssembly files remain external Vite dependencies and are unpacked from
the Electron ASAR so a recipient can replace them with a compatible modified
build. `THIRD_PARTY_NOTICES.md` records the exact component, licenses,
corresponding-source location, rebuild command, and packaged replacement
location. Release packaging and smoke tests must continue checking that this
unpacked runtime layout loads successfully.

## Consequences

- The renderer, preload API, IPC surface, and database schema do not gain a new
  privilege or durable metadata table.
- The production dependency and packaged application become larger.
- The package now carries an LGPL compliance surface that must be reviewed at
  every release; dependency upgrades cannot be folded into unrelated work.
- Write support remains MP3 and FLAC only. Passing fixtures do not justify
  claims about every unusual native frame or other TagLib-supported format.
- Fields that normalize to multiple current values remain readable, but a
  one-value proposal is blocked when exact restoration is unavailable.
