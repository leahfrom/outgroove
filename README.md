# Outgroove

Outgroove is a local-first Electron application for understanding a local music library, safely previewing tag changes, and copying selected albums to a folder-backed DAP target. This repository currently contains the first narrow vertical slice, not the whole product roadmap.

## What works

- Start an empty Library through a focused first-run flow that explains Outgroove's local, offline, read-only scanning model before any work begins. Folder selection and scan start are separate explicit steps; active work opens in Activity, while cancellation, interruption, failure, empty-folder results, and retry remain recoverable without changing audio.
- Use a persistent desktop shell to move between Library, Sync, Activity, and Settings without losing the current Library search, album/track context, contextual edit draft or unconfirmed preview, or DAP selection. Metadata editing lives with the selected Library album or track instead of appearing as a separate primary destination; Sync owns DAP selection and review. Global feedback appears only after an event, visibly distinguishes updates, completed work, and items needing attention, and can be dismissed without changing pending work.
- Use separate **Library folders** and **Database safety** Settings contexts so long root lists do not bury backup and restore controls. Safe backup export and database replacement have distinct hierarchy, while a verified but unconfirmed restore remains pending across navigation and is never applied by changing views.
- Add Library folders with a native dialog without starting a scan, see every watched folder and its last successful scan without repeating long paths in visible action labels, explicitly scan one folder, or preview and confirm that Outgroove should stop watching it without deleting audio or durable history.
- Observe a persisted scan job, cancel it safely from the UI, and retry completed, cancelled, failed, or restart-interrupted scans through the incremental path.
- Follow active metadata, Library-quality, and DAP work in a contextual Activity center that separates running work, results, and recovery. Its compact overview identifies active work and a latest scan that needs attention; scan progress, structured errors, cancellation, retry, problem review, and Library/Sync routes appear only when relevant. Active work also stays visible while navigating elsewhere; completed metadata and DAP operations are not presented as durable history.
- Store normalized and native tag views, technical properties, per-file failures, incremental scan signatures, restart-safe sync recovery journals, and deduplicated artwork-undo assets in schema-v18 migrated SQLite.
- Browse albums in a responsive, keyboard-accessible grid ordered by album artist, trustworthy partial release date, then title. An established Library opens directly to a compact search/view toolbar and its collection; scanning and saved-filter management stay behind a keyboard-accessible **Library tools** disclosure until requested. Bounded local thumbnails progressively replace deterministic offline placeholders when the first catalog track contains embedded JPEG/PNG artwork or its folder contains a conventional cover/front/folder image; browsing never needs the network and a bad cover cannot hide its album. Opening a card replaces the collection with a focused album detail and simple track list, while Back or Escape restores focus to that album without losing the current Library query or page. One album-actions menu opens album title, selected shared fields, explicit track order, local artwork, verified history/undo, and Sync routing without crowding the release header; each editor retains its draft, selection, preview, result, and safe write sequence while switching tools or closing the sheet. At high text scaling, the album-editor tool switcher stays compact, every tool keeps a complete spoken label and description, and wrapped review actions remain full-width and reachable. System high-contrast mode preserves current destinations, focus, dialogs, changed/invalid comparison states, and primary actions; reduced-motion mode removes the artwork loading shimmer and suppresses non-essential UI motion. Contextual track, shared-field, track-order, and artwork failures stay inside the active editor with focused recovery guidance, while verified and partial-failure results receive one focused announcement instead of a duplicate notice behind the modal. Activating a track opens the existing current-to-proposed metadata editor over its album; closing or navigating retains its draft and unconfirmed preview, and no write action appears before a fresh preview. A separate More menu—available from its button, right-click at the pointer position, Menu, or Shift+F10—opens stacked read-only track identity, technical information, long source paths, normalized tags, and progressively disclosed native tags. Searchable, paginated album-artist, genre, format, folder, and track views show useful context: artist/genre/format counts, folder album/track counts, or each track's album, number, format, duration, and file path. Artist rows open exact filtered Albums; genre, format, and folder rows open exact filtered Tracks; track rows open the exact album and Library editor without proposing or applying a change. Search album, artist, genre, track, format, and path fields, or switch to a searchable scan-problem view.
- Name and save up to 100 active Library searches/views locally, including data-quality, album-artist, format, folder, and genre filters. Open, rename, update, or delete them from the keyboard-accessible Saved Library filters panel without affecting catalog or audio data.
- Choose the searchable **Albums needing review** Library view to analyze the matching catalog in bounded pages on a cancellable SQLite worker. Narrow results to numbering, artist/date consistency, or missing/placeholder tag findings. Results are exact, paginated, and use the same deterministic local rules shown in each album for missing or duplicate track numbers, internal sequence gaps, inconsistent album artists or partial release dates, missing dates, and exact scanner placeholders. Findings show affected files and select the matching contextual Library editor when the album is open; they never infer, preview, or apply a correction.
- Preview an album-title change per file, explicitly confirm it, snapshot the before-state, write through a same-volume temporary file, verify the audio payload and tags, replace, re-read, and report per-file results.
- Choose a bounded local JPEG/PNG from an album's contextual **Artwork** tool, review which MP3/FLAC files will receive it, and explicitly confirm replacement of only their embedded front cover. Other embedded pictures, folder artwork, private metadata, and audio payloads remain untouched. Verified operations retain complete per-file picture sets for a separately previewed, stale-safe undo.
- Optionally create `cover.jpg` or `cover.png` for a player that requires folder artwork. Outgroove copies the album's current embedded cover only after showing the exact destination and receiving confirmation; audio is unchanged, existing conventional cover/front/folder files are never replaced, and multi-folder albums are refused.
- Select one track and compare its current title, track artist, album artist, track/disc numbers, partial release date, genre, and composer directly beside editable proposed values. Every row names its changed or unchanged state, the no-op review action remains unavailable, and long source paths stay visible in context. The focused draft → exact per-file review → confirmed result workflow remains separate; changing a draft invalidates its older preview, keyboard focus advances to confirmation and the verified or refused result, and apply refuses to overwrite a targeted field changed after preview.
- Select multiple tracks once, then switch between contextual **Shared fields** and **Track order** tools without losing that selection or an unconfirmed preview. Shared fields show an opt-in current-to-proposed comparison for track artist, album artist, disc number, partial release date, genre, and composer; differing selections are identified as **Mixed values** and expand to show each track instead of inventing a shared value. Both tools clearly separate draft/order, exact per-file confirmation, and re-read result stages; keyboard focus advances to the consequential action and then to verified or partial-failure feedback. Changing a proposal invalidates its older preview. Matching files are skipped, while stale or failed files are reported independently.
- Keep Shared fields and Track order focused through a compact album-track context. The shared selection count and a bounded name summary remain visible, while per-track checkboxes, edit actions, technical properties, long paths, and raw metadata are progressively disclosed only when needed.
- Preview a field-scoped batch undo from edit history. Only verified writes participate; already restored files are skipped and stale files are refused without stopping safe restores.
- In the focused Track order mode, explicitly reorder selected tracks and compare every current track/disc number with its deterministic proposed assignment. Invalid, unchanged, and changed rows remain distinct before the authoritative per-file preview. Choose a starting number, optionally assign one disc number to the sequence, safely apply both fields, and undo verified sequence writes from history.
- Preview a field-scoped track metadata undo from edit history. It restores only fields changed by that verified operation and refuses targeted fields changed afterward.
- Use separate **Album title** and **History & undo** tools inside the contextual album editor without losing the active draft or reviewed proposal. Album-title writes show per-file before/after values, move keyboard focus to confirmation and verification feedback, and keep API failures beside the recoverable workflow. History progressively discloses verified album, track, batch, and sequencing operations; every undo remains a new explicit preview and confirmation, reuses the same safe writer, and refuses conflicting external changes.
- Move through distinct **Albums & profiles**, **Preview & apply**, and **Recovery** stages for DAP sync. The active profile and an unconfirmed plan remain in context while navigating elsewhere, review is unavailable until a profile is active, and pending recovery stays prominent because it blocks database restore.
- Prepare Sync through separate **Selection draft** and **Saved profiles** views. Selection drafts keep the current Library album and offer direct per-album removal, while saved profiles keep opening immediate and progressively disclose album details, renaming, selection revision, and target changes.
- Review the current DAP plan as a focused summary of copies, unchanged files, issues, and required space. Exact destination paths and successful history stay behind keyboard-accessible disclosures, conflicts and errors open prominently, and the separate confirmation panel reiterates that source audio is untouched and the manifest is committed last.
- Review each interrupted sync in a focused Recovery workspace that distinguishes rollback from post-commit cleanup, groups exact restore and remove actions, and identifies unexpected target contents that will remain untouched. Recovery previews and complete, incomplete, or failed results receive keyboard focus, while closing a review changes no files.
- Explicitly collect up to 100 albums into one folder-backed DAP profile, choose a normal folder as its target, reopen, rename, and explicitly retarget saved profiles after restarting Outgroove, revise their album selections without choosing the target again, and review the 20 newest successful runs derived from committed manifests. Retargeting previews the old and new folders, changes no files, preserves history, scopes manifest ownership to the selected target, and invalidates prior sync previews. The user must generate a fresh deterministic copy-only plan after a target or selection revision before applying verified temporary copies, writing UTF-8 M3U8, and committing `.outgroove/manifest.json` last. An active copy-stage sync can be cancelled from the keyboard; Outgroove finishes or discards the current temporary copy, verifies and rolls back files installed by that run, retains the earlier manifest, and leaves the preview ready to retry. If the process or target disappears, a schema-v17 write-ahead journal presents the exact restart recovery actions for confirmation before restoring or removing anything.
- Repeat scans skip unchanged files; repeat syncs plan no unnecessary copies.
- Export a verified SQLite database backup, preview and explicitly confirm a restore, preserve an automatic rollback backup, verify the replacement, and restart into it without touching audio or DAP files.

No provider calls, telemetry, source moves, transcoding, target deletions, mirror mode, or automatic updates exist in this slice.

## Prerequisites

- Node.js 24 or newer
- npm 11 or newer
- macOS, Windows, or Linux for development; v0.11.0 was packaged and smoke-tested on macOS arm64 and native Windows x64, with Linux x64 verified under Debian container emulation

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
title, track artist, album artist, track/disc number, track/disc total, partial
release date, Genre, Composer, Conductor, Lyricist, ISRC, Copyright, original
release date, Language, and one plain Comment. Batch editing is deliberately
narrower: it supports only track artist, album artist, track total, disc number,
disc total, partial release date, Genre, Composer, Conductor, Lyricist, ISRC,
Copyright, original release date, and Language, requires an explicit opt-in for
each field, and does not mass-edit titles or comments. The comparison editors
show core tags first and keep totals, secondary credits, identifiers, rights,
provenance, language, and comments behind an accessible **More fields**
disclosure. A changed or selected secondary field opens that disclosure and
remains counted in its summary if the user collapses it again. Track numbers use
a separate sequence preview whose order is explicitly controlled by the user;
sequencing never infers or writes a total.

Embedded front-cover replacement is available only for MP3 and FLAC. It accepts
one explicitly selected JPEG or PNG up to 8 MiB and 25 megapixels, preserves
all non-front embedded pictures, and does not edit or remove folder artwork.
The current local album artwork can also be prepared and exported as its
original JPEG or PNG bytes. A native save dialog chooses the destination;
Outgroove refuses existing files and verifies the completed export without
changing audio or folder artwork. A separate preview can remove only pictures
explicitly marked as embedded front covers from supported MP3 and FLAC files;
folder artwork and every other embedded picture remain untouched, and verified
removals use the same separately confirmed undo. Per-track artwork selection
and editing other audio formats are not implemented.

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
- Genre browsing preserves the scanner's multi-value common genre tags, groups values case-insensitively, and shows blank or absent values as `No genre tag`. It does not guess how to split a single delimiter-containing tag. Track and shared-field editors can explicitly propose one genre value or clear it through the normal preview, confirmation, snapshot, re-read, verification, and undo path. Tracks already containing multiple genre values remain readable and browsable, but their genre field is blocked from mutation because the current writer cannot restore that complete set safely; other fields remain editable. Catalog rows created before this feature are re-read once during their next explicit scan to hydrate this rebuildable field; no audio is changed.
- Composer scanning preserves the ordered, deduplicated common composer values. Track and shared-field editors can explicitly propose one composer or clear it through the normal safe write and undo path. Tracks with multiple current composer values remain readable, but composer mutation is blocked because the current writer cannot restore that complete set safely; other fields remain editable. Older unchanged catalog rows are re-read once during their next explicit scan to hydrate this rebuildable field.
- Conductor scanning preserves the ordered, deduplicated common conductor values. Track and shared-field editors can explicitly propose one conductor or clear it through the normal preview, confirmation, snapshot, re-read, verification, and undo path. Tracks with multiple current conductor values remain readable, but conductor mutation is blocked because the current writer cannot restore that complete set safely; other fields remain editable. Older unchanged catalog rows are re-read once during their next explicit scan to hydrate this rebuildable field.
- Lyricist and ISRC scanning preserve their ordered, deduplicated common values, while Copyright preserves one optional text value. Track and opt-in shared-field editors can set or clear these fields through the same safe write and undo sequence. Multiple current Lyricist or ISRC values remain readable but block mutation of that specific field because the writer can restore only one value. Older unchanged catalog rows are re-read once to hydrate all three rebuildable fields. Publisher is not editable because the current reader does not normalize the writer's MP3/FLAC representation consistently, and BPM is not editable because the pinned writer cannot reliably clear it from FLAC; Outgroove does not advertise those unsafe partial behaviors.
- Comment scanning preserves each common comment's text, language, and descriptor as rebuildable catalog evidence. The single-track editor can set or clear one plain comment. Multiple comments, a non-empty descriptor, or a language other than the MP3 writer's compatible `eng` default block comment mutation so preview and undo cannot flatten structure; comments are intentionally excluded from batch editing. Original release date accepts the same valid partial-date forms as Release date, and Language preserves one optional text value; both are available in the single-track and opt-in shared-field editors. MP3 and FLAC fixture writes set, clear, re-read, and verify all three fields while preserving private/native tags and audio payloads. Older unchanged catalog rows are re-read once to hydrate the rebuildable fields. Catalog number remains read-only because the current MP3 reader/writer pair does not expose a reliably verifiable normalized value.
- Track and disc totals are preserved independently from their corresponding numbers. The single-track and opt-in shared-field editors can set a positive bounded total or clear it, but never infer, renumber, or automatically correct either value. A proposal that targets a number/total pair is rejected when it would leave a total without a number or a number greater than its total; unrelated field edits remain available. MP3 and FLAC writes re-read and verify both totals and the unchanged audio payload. Older unchanged catalog rows are re-read once during their next explicit scan to hydrate these rebuildable fields; no schema migration or audio write is involved.
- Format browsing uses the scanner's local format label, groups labels case-insensitively, and displays blank labels honestly as `unknown`. Selecting a format applies an exact removable filter to the bounded track table.
- Folder browsing derives parent folders with Node's native path adapter in the privileged process. The renderer receives a display path and an opaque exact-match token but never parses or constructs filesystem paths. Connection-local folder projections are rebuilt from catalog state, excluded from backups, and add no durable schema.
- Track browsing reads only the current catalog and is capped by the same 50-row page limit as other Library views. Opening a track selects its exact catalog album and opens the contextual Library editor, but intentionally does not create a preview or write metadata.
- Saved Library filters are durable database state included in backups. They store active search/filter values but not pagination or exact album-detail routes. If a saved artist, genre, format, or folder is no longer present, opening it honestly shows an empty result; Outgroove does not guess a replacement. Names are unique without regard to case. Updating replaces the saved definition with the current normal Library view while retaining its identity and creation time; exact album-detail routes cannot be used as replacements.
- Local artwork is read through a fixed album-ID IPC query; the renderer receives a bounded PNG data URL, never a source path or filesystem primitive. The privileged adapter checks only the first catalog track for embedded MP3/FLAC artwork and the exact same folder for `cover`, `folder`, or `front` JPEG/PNG files, refuses symbolic links, caps encoded input at 8 MiB, validates dimensions and a 25-megapixel limit before decode, emits at most a 384-pixel/2 MiB thumbnail, and keeps a rebuildable cache bounded to 100 entries and roughly 32 MiB. ID3v2.2, unsynchronized ID3 tags, WebP/GIF, alternate filenames, and per-track cover differences are not supported yet; they fall back to the deterministic placeholder. No network artwork is fetched.
- Artwork editing uses fixed replacement and removal-preview IPC flows. The native picker path and full image bytes remain in main; the renderer receives only a bounded preview and file-level proposal. Removal targets only pictures explicitly typed as front covers and cannot remove folder artwork or differently typed embedded pictures. Schema v18 stores complete before/after picture ordering through content-addressed assets, so identical covers are not duplicated for every track. Apply re-reads each file to reject stale artwork, writes a same-folder temporary replacement, verifies the complete picture set and audio payload, and reports partial failures independently. Undo is another previewed write and refuses files changed afterward. Sudden-power-loss recovery for an in-progress metadata replacement remains limited to the existing same-volume rollback behavior.
- Artwork export uses another fixed album-ID IPC flow and the same embedded-first, conventional-folder fallback as Library thumbnails. Main retains the original bytes and source path; the renderer receives only a bounded preview with source kind, format, dimensions, and size. Export writes and flushes a same-folder temporary file, verifies it, installs the user-selected destination without clobbering, re-hashes it, and removes only the exact bytes it installed if later verification fails. A destination changed externally is preserved. Exporting does not modify audio, folder artwork, catalog state, or edit history.
- Folder-artwork creation is a separate optional fixed album-ID IPC flow. Main derives a single album folder from catalog tracks and a fixed `cover.jpg`/`cover.png` name; the renderer cannot submit a filesystem path. Preview rejects multi-folder albums, symlinked folders, missing/unsupported embedded covers, and any case-insensitive conventional cover/front/folder collision. Apply rechecks the album, source artwork, folder identity, and conflicts, then flushes a same-folder temporary image, installs without clobbering, and verifies the exact bytes. It creates no edit-history entry because it never modifies audio or an existing file; replacing or removing folder artwork is not supported.
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
- Sync is copy-only. Multi-album profile selections are durable schema-v16 state and existing single-album profiles migrate without changing their selection. Schema v17 adds a durable write-ahead journal for each active apply. The DAP profile browser restores saved targets and album names without touching either source or target files. It also derives a read-only, newest-first history from the 20 newest committed manifests, including their recorded target and file count; failed or interrupted attempts and copied-versus-unchanged counts are not successful history. Cooperative cancellation is available only during the copy/verification stage. It never interrupts a file replacement mid-step, verifies an installed copy before removing it during rollback, refuses to overwrite a target changed externally during rollback, and does not advance history. Once playlist/manifest finalization begins, live cancellation is refused because interrupting that commit would be less safe. A process interruption instead leaves a recovery journal: startup detects the database record without touching the target, and an explicit Review action then inspects the target read-only, displays every restore/removal and warning, and requires separate confirmation. Missing targets stay pending, unexpected destination contents remain untouched, and a sync whose manifest already committed exposes internal cleanup only. Recovery rolls back to the earlier manifest and retries from a fresh copy boundary; it does not resume within a partially copied file. A profile cannot apply another plan until recovery is resolved. Album-selection revisions are transactional, preserve the profile target and prior manifests, and invalidate earlier previews; requesting a fresh preview is still required before confirmation and apply. Profile renames are also transactional but preserve existing previews because the display name does not affect a sync plan. Retargeting requires a native folder choice plus a separate preview and confirmation, preserves earlier manifests and history, invalidates stale plans, and looks up ownership by both profile and exact recorded target path; an existing file on a newly selected target therefore remains unknown and blocks replacement. Returning to the exact earlier target can reuse its latest manifest. Removing an album from a profile does not delete its earlier copies from the target. Deleting a saved profile is not implemented yet. An unavailable selected album becomes a visible plan error rather than being omitted. Unknown target files are not adopted or replaced, and there is no deletion implementation. See [ADR 0007](docs/decisions/0007-durable-sync-recovery-journal.md).
- Target identity is currently the explicitly selected folder path plus manifest/profile identity; removable-volume identity is deferred.
- Tag audio-payload verification and sync copy verification use bounded-memory streaming SHA-256. MP3/FLAC container-boundary parsing remains deliberately format-specific and fixture-tested.
- Scan jobs run high-volume discovery/stat, metadata parsing, and SQLite classification/write batches outside Electron main, show indeterminate discovery counts before switching to determinate metadata progress, and persist progress plus terminal state. The scan-scoped database worker closes after finish/abandon so backup restore does not race an idle SQLite handle. An app restart marks unfinished work as interrupted and offers a safe incremental retry; exact mid-file queue resumption is not implemented.
- Database restore validates and migrates a staged copy, requires a preview and confirmation, refuses active scans, retains a verified automatic rollback backup, and restarts after replacement. Automatic rollback-backup cleanup is not implemented yet.
- The current UI shell is verified locally on macOS arm64. Its native Windows and Linux font, input, accessibility, and narrow-window behavior remain to be checked in a future cross-platform UI milestone. Manual macOS Intel, Linux storage behavior, and real exFAT/DAP tests also remain unverified.
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
