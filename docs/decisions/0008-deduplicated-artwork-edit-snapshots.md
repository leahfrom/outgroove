# ADR 0008: Deduplicated complete-picture snapshots for artwork edits

- Status: accepted
- Date: 2026-07-27

## Context

Outgroove can safely replace common MP3 and FLAC text fields because durable tag
snapshots contain the exact normalized fields needed for scoped undo. Artwork is
different: a file may contain several front covers and unrelated back-cover,
leaflet, media, or artist pictures. Snapshotting only the displayed thumbnail
would make undo lossy, while storing the same multi-megabyte image independently
for every track in an album would make the catalog grow unnecessarily.

The renderer also cannot receive a native picker path or become responsible for
reading image bytes without violating the sandbox boundary.

## Decision

Schema v18 extends edit-operation kinds with album artwork edit and undo. Each
verified file retains the complete ordered before and after embedded picture
sets. Raw image data is stored once in `artwork_assets`, keyed by SHA-256, while
`artwork_snapshot_pictures` records snapshot side, position, picture kind, and
description. Existing tag snapshots remain the per-file operation record used
for history and partial-failure accounting.

The native picker and bounded JPEG/PNG read stay in Electron main. The renderer
receives a bounded PNG preview, image facts, the exact supported/blocked file
set, and an opaque confirmation token. Apply re-reads pictures to reject stale
files, replaces only front-cover pictures in a deterministic plan, preserves all
other pictures, writes through the existing same-directory temporary/rollback
adapter, and independently verifies the complete picture set and audio payload.
Undo restores the complete recorded before set and uses the same stale check,
preview, confirmation, write, re-read, and verification path.

Folder artwork is never modified by this operation. Artwork removal, export,
and write support beyond MP3 and FLAC remain separate future decisions.

## Consequences

- Artwork undo is exact for every verified file instead of being limited to the
  cover shown in Library.
- Identical artwork bytes shared by many album tracks occupy one durable asset.
- Database backups now include artwork undo assets and may be larger than the
  file-derived catalog alone.
- Assets are retained with edit history; pruning policy is not implemented yet.
- The in-memory selected-image proposal is intentionally restart-ephemeral. A
  restart requires choosing the image and creating a fresh preview.
- The fixed renderer bridge remains path-free and cannot read arbitrary files.
