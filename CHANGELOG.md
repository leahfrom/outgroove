# Changelog

## 0.13.0 — 2026-07-27

- Add an explicit, cancellable MusicBrainz release-edition search for one
  Library album. The connection disclosure names the only catalog values sent,
  candidate confidence is calculated locally from album evidence, and every
  match and conflict remains read-only until the user chooses a separate
  editing action.
- Cache bounded, runtime-validated provider responses in rebuildable schema-v19
  catalog state. MusicBrainz requests share one global one-per-second limiter,
  meaningful application identity, cancellation, in-flight deduplication, and
  bounded retry behavior; valid expired responses can remain available
  honestly when the provider is offline.
- Turn an explicitly selected release into a limited local draft for safe
  release-level fields. Candidate selection never starts a preview or write,
  ambiguous multi-values remain omitted, and the existing single-track or
  shared-field comparison, confirmation, verified write, partial-failure,
  history, and undo workflows remain authoritative.
- Add fully manual one-to-one mapping between Library tracks and tracks on an
  explicitly loaded MusicBrainz release. No relationship or field is inferred;
  title, ordered track artist, track/disc numbering and totals, one
  unambiguous ISRC, and distinct recording, release-track, and artist IDs are
  individually opt-in before one exact per-file preview and album-level
  confirmation.
- Keep track mapping choices as non-durable renderer draft state, disclose
  omitted multi-value identifiers, invalidate an older preview whenever its
  mapping or selected fields change, and reuse the existing snapshot, stale
  target, safe-write, audio-payload, re-read, verification, and verified-undo
  protections without another write API or durable metadata table.

## 0.12.0 — 2026-07-27

- Complete the planned common-tag workflow for MP3 and FLAC. Single-track
  editing now covers Genre, Composer, track/disc totals, Conductor, Lyricist,
  ISRC, Copyright, original and publishing dates, Language, Publisher,
  Description, Grouping, Catalog number, BPM, Compilation, one plain Comment,
  and distinct MusicBrainz recording, release-track, release, artist,
  release-artist, release-group, and work identifiers.
- Keep core identity and numbering visible while grouping secondary credits,
  release/catalog details, notes, rights, and identifiers under an accessible
  More fields disclosure. Shared editing exposes only album-safe fields,
  requires an explicit opt-in for every proposal, and keeps mixed current
  values visible.
- Preserve multi-value Genre, Composer, Publisher, Description, Catalog number,
  and MusicBrainz artist identifiers in the rebuildable catalog. A field whose
  complete current value cannot be restored remains readable while mutation of
  only that field is blocked; other fields remain editable.
- Retain the full select, propose, validate, preview, confirm, snapshot, write,
  re-read, verify, and undo sequence. Totals never renumber tracks, identifiers
  and Compilation are never inferred, no-op proposals cannot reach
  confirmation, and legacy catalog rows hydrate the new rebuildable fields
  during their next explicit scan without a schema migration.
- Add a narrowly scoped, candidate-file-only TagLib-Wasm stage for extended
  fields the primary writer cannot represent consistently across MP3 and FLAC.
  Fixture writes verify set, clear, re-read, undo, private/native tag
  preservation, embedded artwork preservation, and unchanged audio payloads.
- Complete contextual artwork management with reviewed embedded front-cover
  replacement and removal, export, and optional safe creation of a conventional
  folder-artwork file. Every source mutation remains separately previewed and
  confirmed, while export never changes library audio.

## 0.11.0 — 2026-07-26

- Make Library the natural home for browsing and editing. It now opens to a
  responsive album grid ordered by album artist, trustworthy preserved release
  date, then title, and opens each album in a focused detail view without
  losing the current search, page, scroll position, or keyboard focus.
- Move metadata work into the selected album. Track activation opens the
  current-to-proposed editor in an accessible modal sheet, while an album
  actions menu provides album-title, shared-field, track-order, history/undo,
  and Sync workflows without crowding the release header.
- Add mouse, right-click, Menu-key, and Shift+F10 access to read-only track
  information. Technical properties, normalized tags, native tags, and long
  source paths remain separate from editing, and focus returns to the
  originating track when the menu or dialog closes.
- Retire Workbench as a primary destination after preserving every existing
  preview, confirmation, verification, partial-failure, and undo route in
  Library context.
- Load bounded local JPEG/PNG artwork through a runtime-validated privileged
  query, with deterministic offline placeholders and isolated failure when
  artwork is missing, malformed, unsupported, or too large.
- Refine album cards, track rows, menus, modal sheets, contextual feedback, and
  editor layouts for long metadata, narrow windows, 200% text scaling, keyboard
  focus, reduced motion, and system high-contrast modes.

## 0.10.0 — 2026-07-24

- Complete the desktop UI foundation with persistent Library, Workbench, Sync,
  Activity, and Settings workspaces that preserve searches, album and track
  context, drafts, previews, confirmations, and DAP selections while
  navigating.
- Add a guided first-Library experience that separates folder selection from
  the explicit read-only scan, explains local/offline safety, and keeps scan
  cancellation, interruption, empty results, and retry recoverable.
- Restructure metadata work into focused draft, exact-change review,
  confirmation, verified-result, and history stages. Single-track,
  shared-field, and track-order editors compare current and proposed values
  without hiding mixed selections or long source paths.
- Rework album-title history and undo so confirmed operations, refused stale
  writes, per-file verification, and the next safe recovery action remain
  visible without presenting every control at once.
- Split DAP Sync into progressively disclosed album/profile setup, deterministic
  plan review and apply, and interrupted-run recovery workspaces. Source audio,
  target ownership checks, confirmations, manifests, cancellation, and recovery
  behavior are unchanged.
- Add contextual Activity and Settings workspaces for running jobs, scan
  results, watched folders, database backup, and verified restore without
  duplicating durable history or burying safety actions.
- Give global updates, completed work, and failures distinct non-color-only
  feedback with appropriate live announcements, then refine shared spacing,
  typography, focus visibility, long-content handling, and narrow-window
  behavior across the packaged app.

## 0.9.0 — 2026-07-23

- Replace the single-page development workbench with a persistent desktop
  shell for Library, Workbench, Sync, Activity, and Settings. Navigation keeps
  Library searches and selections, Workbench drafts and previews, Sync plans,
  and pending confirmations in context.
- Restructure album and track detail around progressive disclosure, readable
  technical facts, long-path handling, contextual Workbench and Sync actions,
  and focused empty, loading, result, and error states.
- Separate Workbench into album title, single-track metadata, shared-field
  batch, and track-order workflows. Single-track changes now move through
  draft, exact-change confirmation, and verified result stages; batch and
  sequencing modes retain their shared track selection.
- Separate DAP Sync into Albums & profiles, Preview & apply, and Recovery.
  Pending restart recovery remains prominent, while active profiles,
  deterministic plans, successful history, cancellation, and confirmations
  remain available only in their relevant stage.
- Allow an existing DAP profile to choose and explicitly confirm a new target
  without reading or changing either target during selection. Retargeting
  preserves history, invalidates stale plans, and keeps manifest ownership
  scoped to the exact recorded target.
- Add a contextual Activity center for active metadata, Library-quality, and
  DAP work plus the latest durable scan. Completed scan counts and errors route
  directly to Library scan problems, while cancellation and retry remain
  keyboard accessible.
- Separate Settings into Library folders and Database safety so long watched
  root lists do not bury backup and restore controls. Verified restore previews
  remain pending across navigation and are never applied by changing views.
- Increase only the real SQLite-worker quality-query integration test timeout
  to accommodate slower Windows cleanup without changing production behavior
  or the repository-wide test timeout.

## 0.8.0 — 2026-07-22

- Add searchable genre browsing, complete scanned track technical details, and
  durable named Library filters that can be reopened, renamed, updated, or
  removed without changing audio or catalog data.
- Expand folder-backed DAP profiles from one album to an explicit selection of
  up to 100 albums. Saved profiles can be reopened, revised, and renamed while
  retaining their selected target and requiring a fresh preview after changes.
- Show the 20 newest successful syncs from committed manifests, including their
  recorded target and file count, without treating failed or interrupted runs
  as history.
- Add cooperative cancellation during the copy stage. Outgroove finishes or
  discards the current temporary copy, verifies installed output before
  rollback, retains the earlier manifest, and leaves the plan ready to retry.
- Add schema-v17 write-ahead recovery journals for process interruption,
  target disconnection, and finalization failure. Restart recovery displays
  exact restore/removal actions, requires separate confirmation, preserves
  externally changed files, rejects symlink escapes, and never modifies source
  audio.
- Migrate schema versions 13–16 through versions 14–17 while preserving
  watched-root state, technical catalog properties, saved Library filters, DAP
  selections, manifests, and edit history.

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
