# Outgroove

Outgroove is a local-first Electron application for understanding a local music library, safely previewing tag changes, and copying selected albums to a folder-backed DAP target. This repository currently contains the first narrow vertical slice, not the whole product roadmap.

## What works

- Choose Library folders with a native dialog, see every watched folder and its last successful scan, explicitly rescan one folder, or preview and confirm that Outgroove should stop watching it without deleting audio or durable history.
- Observe a persisted scan job, cancel it safely from the UI, and retry completed, cancelled, failed, or restart-interrupted scans through the incremental path.
- Store normalized and native tag views, technical properties, per-file failures, and incremental scan signatures in schema-v16 migrated SQLite.
- Browse albums in a sandboxed React renderer using bounded SQLite pages and rebuildable catalog projections. Searchable, paginated album-artist, genre, format, folder, and track views show useful context: artist/genre/format counts, folder album/track counts, or each track's album, number, format, duration, and file path. Artist rows open exact filtered Albums; genre, format, and folder rows open exact filtered Tracks; track rows open the exact album and existing preview-only editor without proposing or applying a change. Search album, artist, genre, track, format, and path fields, or switch to a searchable scan-problem view.
- Name and save up to 100 active Library searches/views locally, including data-quality, album-artist, format, folder, and genre filters. Open, rename, update, or delete them from the keyboard-accessible Saved Library filters panel without affecting catalog or audio data.
- Choose the searchable **Albums needing review** Library view to analyze the matching catalog in bounded pages on a cancellable SQLite worker. Narrow results to numbering, artist/date consistency, or missing/placeholder tag findings. Results are exact, paginated, and use the same deterministic local rules shown in each album for missing or duplicate track numbers, internal sequence gaps, inconsistent album artists or partial release dates, missing dates, and exact scanner placeholders. Findings show affected files and only select the existing safe Workbench workflow; they never infer or apply a correction.
- Preview an album-title change per file, explicitly confirm it, snapshot the before-state, write through a same-volume temporary file, verify the audio payload and tags, replace, re-read, and report per-file results.
- Select one track and safely preview/edit its title, track artist, album artist, track/disc numbers, and partial release date. Apply refuses to overwrite a targeted field changed after preview.
- Select multiple tracks in one album and batch-preview explicitly enabled shared fields (track artist, album artist, disc number, and partial release date). Matching files are skipped, while stale or failed files are reported independently.
- Preview a field-scoped batch undo from edit history. Only verified writes participate; already restored files are skipped and stale files are refused without stopping safe restores.
- Explicitly order selected tracks, preview sequential track numbers from a chosen starting value, optionally assign one disc number to the sequence, safely apply both fields, and undo verified sequence writes from history.
- Preview a field-scoped track metadata undo from edit history. It restores only fields changed by that verified operation and refuses targeted fields changed afterward.
- Review confirmed album-title edit history and preview an honest per-file undo. Undo reuses the same safe writer and refuses to overwrite a title changed after the original edit.
- Explicitly collect up to 100 albums into one folder-backed DAP profile, choose a normal folder as its target, reopen saved profiles after restarting Outgroove, and revise their album selections without choosing the target again. Every revision invalidates prior previews; the user must generate a fresh deterministic copy-only plan before applying verified temporary copies, writing UTF-8 M3U8, and committing `.outgroove/manifest.json` last.
- Repeat scans skip unchanged files; repeat syncs plan no unnecessary copies.
- Export a verified SQLite database backup, preview and explicitly confirm a restore, preserve an automatic rollback backup, verify the replacement, and restart into it without touching audio or DAP files.

No provider calls, telemetry, source moves, transcoding, target deletions, mirror mode, or automatic updates exist in this slice.

## Prerequisites

- Node.js 24 or newer
- npm 11 or newer
- macOS, Windows, or Linux for development; only macOS arm64 has been packaged and smoke-tested locally so far

Install exactly from the lockfile:

```sh
npm ci
```

The reviewed install scripts are limited in `package.json` to `better-sqlite3`, `esbuild`, and `unrs-resolver`. `better-sqlite3` is a privileged native dependency and is rebuilt by Electron Forge for the packaged Electron ABI.

Forge 7 currently resolves vulnerable older `tar`/`tmp` development transitive dependencies, so the lockfile applies narrow overrides to patched `tar` 7.5.20 and `tmp` 0.2.7. Packaging and smoke tests cover their exercised rebuild/archive path.

## Commands

```sh
npm start              # development app
npm run format:check   # formatting verification
npm run lint           # type-aware lint + import boundary rules
npm run typecheck      # strict TypeScript
npm test               # unit, UI, and temporary-directory integration tests
npm run verify         # all source checks above
npm run package        # unpacked platform application
npm run test:smoke     # isolated packaged launch; verify SQLite backup, renderer, and worker
npm run make           # ZIP artifact for the current platform
npm run fixtures:generate # regenerate the CC0 audio corpus (requires FFmpeg)
npm run benchmark:library # temporary 5,000-file synthetic catalog benchmark
npm run benchmark:library:100k # opt-in 100,000-file synthetic benchmark
npm run benchmark:metadata # parse 1,000 copied redistributable MP3 fixtures
```

Windows CI also opens fixture files from a separate PowerShell process with an
exclusive `FileShare.None` lock. It verifies that a locked metadata source and
a locked manifest-owned sync destination fail without changing the existing
file or advancing the manifest.

To conserve private-repository Actions minutes, ordinary pull requests run one
Linux verification/package/smoke job and cancel superseded runs. Tagged
releases remain gated by the full macOS, Windows, and Linux matrix. Local macOS
verification, packaging, and smoke tests are required before a feature PR.

The real-volume exFAT conformance probe is intentionally manual. It requires an
exact absolute path to an explicitly authorized disposable exFAT target:

```sh
npm run test:exfat -- --target "/absolute/path/to/disposable-target" --confirm-disposable-exfat-probe
```

The command verifies the detected filesystem before writing, creates one
unique `.outgroove-exfat-probe-*` child directory, uses only generated fixtures,
and removes only that directory. Do not point it at a real music library or an
unbacked-up card. See [the filesystem conformance procedure](docs/filesystem-conformance.md).

Development uses Gitflow and stable semantic versions. Start feature, release,
and hotfix branches with the guarded npm commands documented in
[CONTRIBUTING.md](CONTRIBUTING.md); CI rejects pull requests that bypass the
`develop`/`main` integration paths.

## Downloads

Stable version tags produce a private GitHub prerelease with ZIP downloads for
macOS arm64, Windows x64, and Linux x64 plus a `SHA256SUMS.txt` file. Release
publication happens only after verification, packaging, and packaged-app smoke
tests pass on all three runners.

Current downloads are unsigned and not notarized. macOS Gatekeeper and Windows
SmartScreen may warn or block first launch; these builds are for controlled
testing, not a claim of production readiness. See the repository's **Releases**
page while signed into the GitHub account that can access this private project.

Automated tests copy the CC0 generated fixtures under `fixtures/audio/` into OS temporary directories before any write. They never scan or modify a real music library or mounted device.

The library benchmark likewise creates empty synthetic `.mp3` paths and a
temporary SQLite database under the OS temporary directory, then removes the
entire generated tree. It measures enumeration, incremental signatures,
catalog writes, paging/search, cancellation, and process RSS—not real metadata
decoder throughput. Current measurements and their limits are in
[the performance baseline](docs/performance-baseline.md).

## Format status

The scanner asks `music-metadata` to read MP3, FLAC, M4A/MP4, Ogg Vorbis, Opus, WAV, AIFF, APE, and WavPack extensions. Actual malformed/unsupported inputs remain visible as item-level errors.

Metadata writing is deliberately narrower:

| Format                | Read        | Common-field write | Evidence                                                                                                       |
| --------------------- | ----------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| MP3                   | Yes         | Yes                | ID3v2.4 write/re-read; Unicode, artwork, numbering, dates, comment, ID, private `TXXX`, and audio preservation |
| FLAC                  | Yes         | Yes                | Write/re-read; Unicode, artwork, numbering, dates, comment, ID, private Vorbis field, and audio preservation   |
| Other scanner formats | Best effort | No                 | Preview warns and confirmation is disabled                                                                     |

The currently editable common fields are album title plus a selected track's
title, track artist, album artist, track/disc number, and partial release date.
Batch editing is deliberately narrower: it supports only track artist, album
artist, disc number, and partial release date, requires an explicit opt-in for
each field, and does not mass-edit titles. Track numbers use a separate sequence
preview whose order is explicitly controlled by the user.

Album data-quality findings are derived on demand from catalog DTOs and add no
durable finding table, filesystem access, or network dependency. The
whole-library view reads ordinary 50-album query pages in a short-lived worker,
retains only the requested finding page, reports progress, and terminates a
superseded query. Issue-type filters only decide which albums appear; the
selected album continues to show every applicable finding so no relevant
context is hidden. Sequence diagnostics treat a missing disc number as disc 1,
report only gaps between the lowest and highest observed number, and do not
assume a missing starting number. Placeholder diagnostics recognize only the
scanner's exact `Unknown title`, `Unknown artist`, and `Unknown album`
fallbacks. Diagnostic actions select affected tracks and focus the relevant
editor with proposal fields left blank and no preview started.

Catalog album identity keeps the normalized album-artist/title rule and adds a
merge-only same-folder alias rule. This makes inconsistent album-artist tags
within one exact comparison-key folder visible without splitting established
multi-folder albums. Schema v12 transactionally preserves edit history and DAP
profiles when already-split same-folder groups merge; it never guesses across
folders. See [ADR 0005](docs/decisions/0005-stable-album-grouping.md).

The production writer is `@akabeko/music-metadata-editor`, wrapped by Outgroove's `MetadataWriter`. See [ADR 0001](docs/decisions/0001-foundation-and-metadata-writer.md) and the [ID3v2.4 preservation decision](docs/decisions/0003-mp3-id3v24-writes.md). This is fixture evidence, not a claim that every unusual tag/frame in the wild is safe. Broadening the write matrix requires a new preservation fixture and round-trip test.

## Safety status and limitations

- The renderer has no Node, Electron, SQL, path, or generic IPC access. Requests are a fixed `contextBridge` allowlist and are runtime-validated again in main.
- Library queries are capped at 50 items per request, treat wildcard input literally, and return complete track details only for the selected album page. Track-field searches of three or more Unicode code points use a rebuildable FTS5 trigram projection; shorter terms retain escaped substring matching.
- Album-artist browsing uses the catalog album artist, not every distinct per-track artist credit. Counts include only currently visible files, and selecting an artist applies an exact removable album-artist filter before any text search.
- Genre browsing preserves the scanner's multi-value common genre tags, groups values case-insensitively, and shows blank or absent values as `No genre tag`. It does not guess how to split a single delimiter-containing tag or offer genre editing. Catalog rows created before this feature are re-read once during their next explicit scan to hydrate this rebuildable field; no audio is changed.
- Format browsing uses the scanner's local format label, groups labels case-insensitively, and displays blank labels honestly as `unknown`. Selecting a format applies an exact removable filter to the bounded track table.
- Folder browsing derives parent folders with Node's native path adapter in the privileged process. The renderer receives a display path and an opaque exact-match token but never parses or constructs filesystem paths. Connection-local folder projections are rebuilt from catalog state, excluded from backups, and add no durable schema.
- Track browsing reads only the current catalog and is capped by the same 50-row page limit as other Library views. Opening a track selects its exact catalog album and fills the existing editor, but intentionally does not create a preview or write metadata.
- Saved Library filters are durable database state included in backups. They store active search/filter values but not pagination or exact Workbench album routes. If a saved artist, genre, format, or folder is no longer present, opening it honestly shows an empty result; Outgroove does not guess a replacement. Names are unique without regard to case. Updating replaces the saved definition with the current normal Library view while retaining its identity and creation time; exact Workbench album routes cannot be used as replacements.
- Track and album detail expose locally scanned codec, duration, bitrate, sample rate, bit depth, channel count, and file size. Unsupported or unavailable properties remain visibly `Unknown`; Outgroove does not estimate missing values. Catalog rows created before this feature are re-read once during their next explicit scan to hydrate these rebuildable fields without modifying audio.
- Album diagnostics use normalized catalog tags and cannot determine the correct metadata, distinguish intentional numbering gaps from mistakes, or inspect unsupported/private frames. They are review prompts, not corrections. Each data-quality result page currently rescans the matching catalog instead of using a durable or in-memory findings cache; very large libraries may therefore take time, but the work stays outside Electron main and a newer Library query cancels it.
- Same-folder album grouping compares the exact stored parent-folder comparison key. Differently tagged tracks spread across distinct folders are not merged by this secondary rule; Outgroove will not guess that separate folders represent one release.
- Folder selection is explicit. For development, choose only `fixtures/audio/` or another disposable test folder unless you intentionally authorize an exact real path.
- Watched folders are catalog roots, not background filesystem watchers. Outgroove scans one only when you choose it or press its named scan button. Stopping a watch hides that root's tracks and scan problems but retains catalog identities, edit history, DAP profiles, sync manifests, and scan history. Choosing the same folder again reuses that state, while a rescan must rediscover files before they become visible. Permanent catalog purging is not implemented.
- Unreadable files and folders appear separately in Scan problems. If any folder cannot be traversed, readable files still scan, but that run does not mark unseen catalog files missing.
- Tag writes retain a rollback copy until the replacement is re-read and verified. Recovery across sudden power loss and exFAT behavior still require manual matrix testing.
- Album-title undo restores only verified Outgroove edits and only when the current album tag still equals that edit's recorded result. It is not a general-purpose rollback for external edits or other tag fields.
- Track metadata undo restores only the fields recorded by a verified Outgroove edit. It cannot recover unsupported/private frames, external edits, disk failures, or edits whose current targeted values no longer match the recorded result.
- Batch undo restores only fields recorded by the verified batch snapshots. It cannot recover unsupported/private frames, external edits to targeted fields, disk failures, or files whose current targeted values no longer match the recorded batch result.
- Sync is copy-only. Multi-album profile selections are durable schema-v16 state and existing single-album profiles migrate without changing their selection. The DAP profile browser restores saved targets and album names without touching either source or target files. Album-selection revisions are transactional, preserve the profile target and prior manifests, and invalidate earlier previews; requesting a fresh preview is still required before confirmation and apply. Removing an album from a profile does not delete its earlier copies from the target. Renaming, retargeting, and deleting a saved profile are not implemented yet. An unavailable selected album becomes a visible plan error rather than being omitted. Unknown target files are not adopted or replaced, and there is no deletion implementation.
- Target identity is currently the explicitly selected folder path plus manifest/profile identity; removable-volume identity is deferred.
- Tag audio-payload verification and sync copy verification use bounded-memory streaming SHA-256. MP3/FLAC container-boundary parsing remains deliberately format-specific and fixture-tested.
- Scan jobs run high-volume discovery/stat, metadata parsing, and SQLite classification/write batches outside Electron main, show indeterminate discovery counts before switching to determinate metadata progress, and persist progress plus terminal state. The scan-scoped database worker closes after finish/abandon so backup restore does not race an idle SQLite handle. An app restart marks unfinished work as interrupted and offers a safe incremental retry; exact mid-file queue resumption is not implemented.
- Database restore validates and migrates a staged copy, requires a preview and confirmation, refuses active scans, retains a verified automatic rollback backup, and restarts after replacement. Automatic rollback-backup cleanup is not implemented yet.
- macOS arm64 is the only packaged platform verified locally. Windows and Linux package jobs run in CI; manual packaged Windows locking/rename behavior, macOS Intel, Linux storage behavior, and real exFAT/DAP tests remain unverified.
- Packages are unsigned and not notarized.

## Repository boundaries

- `src/renderer`: presentation and intent only
- `src/preload`: fixed typed bridge
- `src/main`: Electron orchestration, validated IPC, SQLite, filesystem, metadata, edit, and sync services
- `src/shared`: serializable contracts and pure domain rules
- `src/workers`: bounded filesystem-discovery, metadata, scan-database, and Library data-quality worker entry points
- `migrations`: append-only schema history
- `tests`: architecture, temporary-filesystem integration, and packaged smoke tests

Large scans now stream deterministic worker-backed discovery in acknowledged
250-item batches, classify and write those batches in a scan-scoped SQLite
worker, and feed metadata through bounded pages. On the current macOS arm64
development machine, moving SQLite scan work out of Electron main reduced the
100,000-file profile's maximum measured initial-scan event-loop delay from
41.08 ms to 2.49 ms. Total RSS increased by about 35 MiB for the additional
worker isolate. See `docs/performance-baseline.md` for scope and caveats. The
manual exFAT matrix remains pending.
