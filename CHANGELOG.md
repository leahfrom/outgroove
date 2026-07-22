# Changelog

## 0.7.0 — 2026-07-22

- Add searchable, paginated format and folder browsing with visible track and
  album counts. Format and folder rows open exact filtered track results with
  file, album, numbering, duration, and format context.
- Derive folder identities and display paths only in the privileged Node path
  adapter. Rebuild connection-local folder projections from catalog state,
  keeping the sandboxed renderer free of path construction and filesystem APIs.
- Show every explicitly selected Library root with its last completed scan and
  keyboard-accessible, per-root incremental rescan action. Active scans prevent
  competing root actions and completed scans refresh status automatically.
- Add an explicit preview and confirmation before stopping a watched root. The
  preview reports tracks, albums, and scan problems that will be hidden; no
  audio or DAP files are deleted, and catalog identities, edit history, DAP
  profiles, sync manifests, and scan jobs remain intact.
- Migrate schema version 12 catalogs to version 13 with a retained unwatched-root
  marker. Choosing the same path reactivates its existing identity, while only
  files rediscovered by the incremental scanner return to the visible Library.

## 0.6.0 — 2026-07-22

- Add explicit track-number sequencing with manual ordering, a chosen starting
  number, optional disc-number assignment, unchanged-file skipping, verified
  per-file writes, partial-failure reporting, and field-scoped undo.
- Add deterministic local album data-quality diagnostics for missing or
  duplicate numbering, sequence gaps, inconsistent album artists and partial
  dates, missing dates, and exact scanner placeholders. Findings identify the
  affected files and route only into existing preview-first Workbench flows.
- Add a cancellable, paginated whole-Library review view with visible album
  summaries and filters for numbering, artist/date consistency, and missing or
  placeholder tags. Findings remain rebuildable catalog-derived state.
- Preserve one same-folder album across inconsistent album-artist tags through
  schema versions 11–12 without merging ambiguous albums across folders or
  losing edit history and DAP profiles.
- Add searchable, paginated album-artist and track browsing. Artist rows open
  exact filtered album results; track rows show album, numbering, format,
  duration, and file context before opening the existing preview-only editor.

## 0.5.0 — 2026-07-22

- Add safe single-track editing for title, track artist, album artist,
  track/disc numbers, and partial release date, with explicit per-field preview,
  same-volume replacement, audio-payload verification, and re-read validation.
- Add field-scoped undo for verified single-track edits without overwriting
  targeted fields changed after the original operation or undo preview.
- Add explicit multi-track selection and batch editing for shared artist, album
  artist, disc number, and partial release-date fields. Unchanged tracks are
  skipped and one failed file does not abort or misreport the remaining writes.
- Add verified batch undo that includes only successful source writes, preserves
  unrelated metadata changes, skips already restored files, and refuses stale
  targets while continuing safe restores.
- Migrate schema version 6 catalogs through versions 7–10 while preserving edit
  history and tag snapshots.

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
