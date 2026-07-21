# Changelog

## 0.4.0 — 2026-07-21

- Show completed and failed album-title operations in the selected album's
  Workbench history, including per-file verification counts.
- Add explicit per-file undo preview and confirmation for verified MP3 and FLAC
  edits, using the same snapshot, temporary-write, payload-hash, replacement,
  re-read, and verification path as the original edit.
- Refuse to overwrite album titles changed after the original operation and
  record those conflicts as visible failed undo results.
- Migrate released schema version 5 catalogs to version 6 while preserving edit
  operations and tag snapshots.

## 0.3.1 — 2026-07-21

- Move scan classification, temporary scan state, and catalog write batches to
  a dedicated SQLite worker so large scans no longer block Electron main.
- Add rebuildable visible-album and FTS5 search projections, reducing the local
  100,000-file benchmark's first page from 388.50 ms to 4.13 ms and exact track
  search from 354.34 ms to 8.96 ms.
- Migrate released schema version 4 catalogs to version 5 and rebuild search
  state safely after completed edits, scans, cancellation, or a worker crash.

## 0.3.0 — 2026-07-21

- Stream large-library discovery and metadata results in bounded batches, with
  cancellable filesystem and metadata workers that keep Electron responsive.
- Show discovery and metadata progress, and report unreadable files and folders
  without aborting unrelated work or incorrectly marking files as missing.
- Persist resumable scan-job state and add paginated library browsing and search.
- Add verified SQLite backup and restore operations.
- Expand metadata safety, filesystem conformance, and 100,000-file performance
  coverage.

Earlier prerelease history is available on the private GitHub Releases page.
