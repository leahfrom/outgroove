# Outgroove build plan

> Status: initial product and technical plan  
> Updated: 2026-07-21  
> Target: macOS and Windows first; Linux kept compatible and added to the release matrix when stable

## 1. Product vision

Outgroove is a local-first desktop application for people who own music files and copy them to a digital audio player (DAP). It should make a music library understandable, correctly tagged, and easy to synchronize without taking control away from the user.

The product has three connected jobs:

1. **Library** — scan one or more folders, organize albums and tracks, find inconsistencies, and search the collection.
2. **Workbench** — safely edit tags and artwork, optionally matching files against MusicBrainz and AcoustID.
3. **Radar and Sync** — follow favorite artists for new releases, then copy chosen music to an SD card or other DAP storage using repeatable device profiles.

Outgroove is not a streaming service. The files on disk remain the source of truth, while Outgroove's database is a rebuildable index plus user-owned state such as favorites, match decisions, Radar history, and sync profiles.

## 2. Product principles

- **Local-first and offline-capable.** Scanning, browsing, editing, and sync work without an account or network connection.
- **Never surprise the user.** Show a plan before bulk tag edits, renames, moves, copies, or deletions.
- **Preserve originals.** Record before/after values and use safe writes. Never alter source audio as part of a DAP sync.
- **Stable identity over text matching.** Use MusicBrainz identifiers when known; names alone are not reliable identities.
- **Album-aware.** Matching and validation consider a release as a whole, not just a bag of tracks.
- **Cross-platform from the start.** Keep platform-specific code behind narrow interfaces and test path rules on every target OS.
- **Useful without perfect metadata.** Unknown and partially tagged files must remain visible and manageable.

## 3. Scope

### Version 1 goals

- Add and remove watched library folders.
- Perform fast incremental scans of MP3, FLAC, M4A/MP4, Ogg Vorbis, Opus, WAV, AIFF, APE, and WavPack where the selected metadata library supports the required operation.
- Browse by album, artist, genre, folder, format, and common data-quality problems.
- Search tracks, albums, artists, and file paths.
- Inspect technical properties such as codec, duration, sample rate, bit depth, channels, and file size.
- Edit common tags, multi-disc/track numbers, album artist, compilation state, MusicBrainz IDs, and embedded or folder artwork.
- Preview and apply batch edits with validation and an undo history where technically possible.
- Match albums through MusicBrainz; offer optional AcoustID fingerprint lookup for ambiguous or untagged audio.
- Favorite MusicBrainz artists and show new, upcoming, and newly discovered releases in Radar.
- Create DAP profiles and generate a sync preview before copying files and M3U8 playlists.
- Perform incremental sync, detect insufficient space and filename collisions, and report partial failures clearly.
- Back up and restore Outgroove's database and settings.

### Explicitly deferred

- Music playback beyond a short preview useful for identification.
- Ripping CDs, transcoding audio, ReplayGain analysis, or waveform analysis.
- Cloud accounts or multi-computer library sync.
- Streaming-service integration or purchasing/downloading releases.
- Automatic metadata writes without review.
- A full replacement for MusicBrainz Picard's scripting/plugin system.
- Mobile apps.
- Automatically ejecting removable storage.

These are deferrals, not architectural prohibitions. In particular, sync profiles should be designed so transcoding can be added later without changing the library model.

## 4. Recommended technology

| Layer | Choice | Reason |
| --- | --- | --- |
| Desktop shell | Electron | Mature macOS, Windows, and Linux support with the entire application layer available in TypeScript/Node.js. Electron's bundled Chromium also makes UI behavior more consistent across platforms. |
| Packaging | Electron Forge | First-party packaging pipeline for platform installers, signing, and publishing. Start with its TypeScript template; evaluate the Vite plugin during Phase 0 because Forge currently labels it experimental. |
| UI | React + TypeScript | Mature component/testing ecosystem and a good fit for data-heavy desktop interfaces. Use Vite if the Forge spike is stable; otherwise use Forge's supported webpack TypeScript template without changing application architecture. |
| State and data fetching | TanStack Query for command/query state; small local UI store only where needed | Avoids duplicating database state in the frontend. |
| Application core | TypeScript in Electron's Node.js main/utility processes | Keeps product and domain logic in one language while retaining native filesystem and process APIs. The renderer stays sandboxed. |
| Database | SQLite via a maintained Node binding such as `better-sqlite3`, accessed only in the main-process data adapter | Portable, transactional, easy to back up, and sufficient for a single-user local catalog. Native-module rebuilds and packaged binaries must pass the Phase 0 matrix. Use migrations from the first commit. |
| Tag reading | `music-metadata` behind an Outgroove adapter | Mature, TypeScript-typed, broad format support, efficient path/stream parsing, and access to normalized plus native tags. It is a reader, not the write solution. |
| Tag writing | A TypeScript `MetadataWriter` adapter selected by Phase 0 round-trip tests | Evaluate the new pure-TS `@akabeko/music-metadata-editor`, a TagLib-based option, and—only if neither is safe enough—a small packaged native/sidecar helper. Keep 95%+ of the app TypeScript even if the final byte-level writer is native. |
| Network | Node's `fetch`/Undici with runtime schemas, behind provider interfaces | Typed MusicBrainz, Cover Art Archive, and AcoustID clients with caching and test doubles. |
| Async jobs | Electron utility processes and/or Node worker threads with bounded concurrency, cancellation, and persisted job state | Scans, fingerprints, lookups, and syncs must not block the main process or renderer. |
| Fingerprinting | Bundled, versioned `fpcalc` sidecar initially | Chromaprint recommends `fpcalc` for programmatic fingerprint generation. Keep it optional until packaging and licensing are verified on all targets. |
| Tests | Vitest + Testing Library; filesystem/database integration tests; Playwright or Electron-specific packaged-app smoke tests | Tests domain logic below the UI and keeps a small platform-specific end-to-end matrix. |

Do not let the renderer call Node.js, arbitrary filesystem, SQL, or shell APIs. Run renderers with `nodeIntegration: false`, `contextIsolation: true`, and sandboxing enabled. Expose a deliberately small, typed API from the preload script using `contextBridge`; validate every IPC request again in the main process.

### Why Electron rather than Tauri?

The project preference is TypeScript/JavaScript, and Electron lets the UI, domain model, jobs, provider clients, database orchestration, and filesystem workflows share that stack. It also ships one Chromium runtime, reducing native-webview variation. The costs are larger downloads and higher baseline memory than Tauri, plus extra care around renderer security. For a desktop library manager, those costs are acceptable if scans and tag writes are kept out of the renderer and main event loop.

Do not introduce a Rust application core. A narrowly scoped native dependency or helper is acceptable only when Phase 0 proves the available JS/WASM tag writer cannot safely round-trip required formats. It must remain behind the same TypeScript interface and ship as a tested implementation detail.

## 5. High-level architecture

```text
React/TypeScript renderer (sandboxed)
        |
typed contextBridge API
        |
preload script (no business logic)
        |
validated IPC
        |
Electron main process / TypeScript application services
  |        |           |          |          |
Catalog  Tagging   Identification  Radar     Sync
  |        |           |          |          |
SQLite  metadata adapters  provider clients/cache  Node filesystem adapters
        |                         |
  utility processes / worker threads for heavy or crash-prone jobs
                       |                       |
             MusicBrainz / CAA / AcoustID   local disk / SD card
```

The application should follow these boundaries:

- **Domain layer:** TypeScript entities, value objects, rules, and errors; no Electron, IPC, or SQL types.
- **Application layer:** use cases such as `ScanLibrary`, `PreviewTagEdits`, `MatchAlbum`, `RefreshRadar`, and `PlanDeviceSync`.
- **Adapters:** SQLite repositories, tag reader/writer, network providers, OS filesystem/removable-volume adapters, Electron IPC, and external helpers.
- **UI:** presentation and user interaction only. It receives stable DTOs rather than database rows or provider payloads.

The main process creates windows, owns privileged adapters, and coordinates jobs; it must stay responsive. CPU-heavy, high-volume, or crash-prone work belongs in bounded worker threads or Electron utility processes. The preload layer only maps a small allowlist of methods/events to IPC—never expose raw `ipcRenderer`, filesystem primitives, or a generic “invoke channel” function.

Provider responses should be stored as versioned raw JSON cache entries as well as mapped domain data. This makes API changes debuggable and avoids unnecessary repeated requests.

## 6. Suggested repository layout

```text
outgroove/
  AGENTS.md
  PLAN.md
  README.md
  package.json
  pnpm-lock.yaml
  forge.config.ts
  src/
    main/                      # privileged Electron/Node.js process
      application/
      adapters/
        database/
        metadata/
        providers/
        filesystem/
      ipc/
      jobs/
      windows/
      index.ts
    preload/                   # minimal typed contextBridge surface
      index.ts
      api.ts
    renderer/                  # sandboxed React UI
      app/
      features/
        library/
        tagging/
        identify/
        radar/
        sync/
        settings/
      components/
      test/
    shared/                    # pure TypeScript, no Electron imports
      domain/
      contracts/
      schemas/
    workers/                   # job entry points, no renderer imports
  migrations/
  tests/
    integration/
    e2e/
  fixtures/
    audio/                     # tiny, redistributable test fixtures
    providers/                 # scrubbed/recorded API responses
  docs/
    decisions/                 # short architecture decision records
    test-matrix.md
```

Feature folders may be added gradually. Avoid a generic `utils` dumping ground.

## 7. Core data model

Use UUIDs generated by Outgroove for local identities and store external IDs separately. Important tables/entities are:

- `library_roots`: user-selected folders, availability, scan settings, and last successful scan.
- `audio_files`: canonical path, portable path key, size, modified time, quick signature, optional content hash, technical properties, scan state, and error state.
- `tracks`: normalized logical track data and optional MusicBrainz recording ID.
- `albums`: local album grouping, edition attributes, optional MusicBrainz release ID, and release-group ID.
- `artists`: display/sort names, disambiguation, and optional MusicBrainz artist ID.
- `track_artists` and `album_artists`: ordered credits rather than comma-separated strings.
- `artwork`: source, dimensions, media type, checksum, and relationship to album/file.
- `tag_snapshots` and `edit_operations`: enough information to audit and, when safe, reverse an edit.
- `favorites`: stable artist identity, date added, notification preference, and Radar state.
- `radar_items`: release/release-group identity, release status/date, first-seen date, reason shown, and seen/dismissed state.
- `sync_profiles`: target identity, naming rules, supported formats, playlist settings, and safety policy.
- `sync_selections`: the albums, playlists, or rules included in a profile.
- `sync_manifests` and `sync_entries`: source identity, destination path, signatures, outcome, and ownership marker.
- `jobs`: type, progress, cancellation state, error summary, and resumability metadata.
- `provider_cache`: provider, request identity, fetched/expiry times, response schema version, status, and raw payload.
- `settings`: only non-secret application preferences. Secrets belong in the OS credential store if any are introduced.

Keep `MusicBrainz release` (a particular edition) distinct from `release group` (the conceptual album/EP/single). A local album normally matches a release; Radar normally groups news by release group.

Database migrations are append-only once released. The app must be able to rebuild file-derived catalog data without losing favorites, match decisions, Radar state, or sync profiles.

## 8. Critical workflows

### 8.1 Library scan

1. The user grants access to a folder.
2. Enumerate supported files without following symlink/junction loops.
3. Compare path, size, and modification time to skip unchanged files.
4. Read technical properties and tags on a bounded worker pool.
5. Normalize values without destroying the original raw tag representation.
6. Group tracks into candidate albums, preferring embedded MusicBrainz IDs, then album artist + album + disc information, then folder structure.
7. Commit results in small transactions and stream progress/errors to the UI.
8. Mark missing files as unavailable first; only purge catalog records through a separate confirmed maintenance action.

A full cryptographic hash is too expensive for every normal rescan. Compute it lazily when needed for duplicate detection, edit safety, or sync identity. Store failures per file so one corrupt file does not abort a scan.

### 8.2 Tag editing

The edit flow is always **select → propose → validate → preview → write → verify**.

- Show fields that differ across a multi-selection rather than silently choosing one.
- Validate track/disc numbers, dates, artwork type/size, and format-specific limitations before writing.
- Preserve unknown/private frames by default when the metadata library can round-trip them safely.
- Create a tag snapshot before the write.
- Write through a same-volume temporary file when the format/library requires rewriting the container, flush it, then replace atomically where the OS permits.
- Re-read the file after writing and compare intended values.
- If artwork embedding is unsupported or undesirable, offer `cover.jpg`/`folder.jpg` according to a configurable policy.
- Renaming/moving files is a separate operation from editing tags and has its own preview.

“Undo” must be described honestly: it can restore recorded metadata if the file is still the same audio asset, but it cannot promise recovery from external edits, disk failure, or unsupported tag frames. Recommend normal filesystem backups.

### 8.3 MusicBrainz identification

Use a confidence ladder:

1. Validate embedded MusicBrainz IDs.
2. Search using normalized artist, release, track count, duration, barcode/catalog number, and date.
3. Score the complete album against candidate releases, including media/disc layout and per-track duration tolerance.
4. For unresolved files, optionally create a Chromaprint fingerprint and query AcoustID for recording candidates.
5. Present the best candidates with a human-readable explanation of matches and conflicts.
6. Apply metadata only after explicit user confirmation.

Network behavior:

- Send a meaningful Outgroove version/contact `User-Agent`.
- Enforce MusicBrainz's current maximum of one request per second across the entire app.
- Cache lookups, deduplicate in-flight requests, apply exponential backoff with jitter to `429`/`503` responses, and support cancellation.
- Fetch cover art through the Cover Art Archive endpoints, not the MusicBrainz API host.
- AcoustID requires an application key and currently limits clients to three requests per second. Treat fingerprint lookup as optional and separately rate-limited.
- Check provider terms before any commercial release; the public MusicBrainz and AcoustID services describe their free service as non-commercial.
- Never send audio files. Search terms, identifiers, durations, and optional fingerprints are the only library-derived data sent to providers, and the UI should explain this.

### 8.4 Radar

A favorite artist must resolve to a MusicBrainz artist ID. This prevents collisions between artists with the same name.

On refresh:

1. Fetch release groups and relevant releases credited to the favorite artist, using the provider cache and global rate limiter.
2. Normalize release type/status and dates. Preserve partial dates such as `2027` or `2027-03` rather than inventing a day.
3. Compare provider identity and dates with the last successful snapshot.
4. Create Radar items for upcoming releases, recently released items, and releases first discovered since the previous snapshot.
5. Label “newly found in MusicBrainz” separately from “newly released”; MusicBrainz entry time is not proof of a release date.
6. Let users mark seen, dismiss, filter by type, and open the release in MusicBrainz.

Provide manual refresh first. Later, optional background refresh should use a randomized interval, respect offline/power settings, and never wake every installation at the same wall-clock time. A once-daily check is a sensible default, but it must be implemented as a cache-aware sweep spread across time—not repeated polling for metadata changes.

Radar coverage is only as complete and timely as MusicBrainz. Add a provider interface now so another release-news source can be evaluated later, but do not combine fuzzy results from multiple providers in version 1.

### 8.5 DAP/SD-card sync

The user selects a mounted target folder; automatic removable-drive discovery can be layered on later. A profile records:

- Display name and target identity/path.
- Selection rules (specific albums/playlists, favorites, or saved filters).
- Destination naming template, for example `{album_artist}/{year} - {album}/{disc-track} {title}.{ext}`.
- Supported formats and optional maximum path/artwork constraints.
- Playlist path style, relative/absolute paths, line endings, and encoding.
- Reserved free space.
- Mirror/deletion policy.

Every run has a plan phase and an apply phase:

1. Resolve selected source files and validate that all remain available.
2. Sanitize destination segments for the target platform/DAP, rejecting traversal, reserved names, case-folding collisions, and overlong paths.
3. Compare the previous manifest and current source signatures.
4. Calculate copies, replacements, playlist updates, conflicts, skipped files, optional removals, required bytes, and remaining capacity.
5. Show the plan. No target is changed yet.
6. During apply, copy to a temporary destination, verify size/hash as configured, flush, then rename into place.
7. Write the new manifest last and keep the previous manifest until success.
8. Surface a restartable result if the drive is unplugged or fills up.

Outgroove may delete only paths recorded as Outgroove-owned in a prior manifest, and only when the profile explicitly enables mirror mode. Display the exact deletion list for confirmation. Never delete unknown target files or alter source files. Store a small `.outgroove/manifest.json` on the target where practical, with a user setting to keep state only in the local database for incompatible devices.

Generate UTF-8 M3U8 playlists initially. Device-specific legacy encodings and absolute path syntaxes can be profile options after testing real hardware.

## 9. UI map

- **Onboarding:** choose library folders, explain local/network behavior, start first scan.
- **Library:** album grid/table, artist view, track table, saved filters, scan health.
- **Album detail:** artwork, release data, discs/tracks, file properties, tag consistency, match status.
- **Workbench:** editable field grid, proposed changes, candidate comparison, validation, write results, undo history.
- **Radar:** upcoming/recent/newly-found tabs, favorite artists, filters, seen/dismiss actions.
- **Sync:** profiles, selection rules, capacity estimate, plan diff, progress, history, errors.
- **Jobs:** persistent activity center for scans, lookups, fingerprinting, edits, and sync.
- **Settings:** library roots, metadata/artwork policy, network/privacy, backups, appearance, updates.

Keyboard navigation, screen-reader names, visible focus, scalable text, reduced motion, and high-contrast states are acceptance criteria, not a final polish phase. Avoid using color as the only indication of tag differences or sync actions.

## 10. Cross-platform requirements

- Treat paths as native paths in the privileged Node.js layer, using `node:path` and filesystem APIs rather than slash-delimited strings assembled in the renderer.
- Keep a display path distinct from a normalized comparison key. Do not assume case sensitivity or Unicode normalization behavior.
- Test Windows drive letters, UNC paths, reserved device names, illegal characters, long paths, and files currently locked by another process.
- Test macOS `/Volumes` remounts, permission persistence, Unicode filenames, app signing, notarization, and both Apple Silicon and Intel where support is promised.
- Test Linux mount locations, WebKitGTK variations, desktop portals, AppImage/Flatpak permission behavior, and common filesystems before calling Linux supported.
- Expect FAT/exFAT targets to differ from the source filesystem in case sensitivity, timestamp precision, filename rules, and atomic rename behavior.
- Never identify a removable target only by mount path. Use available volume identity plus the Outgroove manifest and require confirmation when identity is uncertain.
- Keep platform conditionals inside filesystem, volume, notification, credential-store, and updater adapters.

Initial support promise: development and CI on macOS and Windows; Linux build checks from the start and user-facing beta status until the manual storage/tag matrix passes.

## 11. Quality strategy

### Automated tests

- Domain unit tests for album grouping, tag normalization, candidate scoring, Radar diffing, naming templates, path sanitization, and sync planning.
- Property tests for arbitrary Unicode/path segments and the invariant that a destination never escapes the selected target root.
- Metadata adapter tests for each read/write format using tiny redistributable fixtures, including malformed and read-only files.
- Database migration and repository integration tests against temporary SQLite databases.
- Provider contract tests using recorded, scrubbed responses; live API smoke tests should be opt-in and rate-limited.
- Sync integration tests against temporary directory trees, including collisions, low space simulations, interrupted copies, changed sources, and unknown target files.
- UI tests for the critical preview/confirm/error states.
- A small packaged-app smoke test on macOS, Windows, and Linux CI runners.

### Manual release matrix

- At least one real SD card formatted exFAT, plus a folder-backed fake target on every OS.
- A representative DAP for playlist/path behavior before claiming that device is supported.
- Intel/Apple Silicon macOS as promised; x64/ARM Windows as promised; selected Linux distributions for beta.
- Light/dark mode, keyboard-only operation, 200% scaling, long text, and non-Latin metadata.
- Network offline, slow, and server-error behavior.
- Forced interruption during scan, tag write, and sync.

Never use irreplaceable music files for automated or exploratory write tests.

## 12. Delivery phases

Phases are outcome-based. Estimates assume one experienced full-time developer and should be revised after Phase 0.

### Phase 0 — feasibility and product spikes (1–2 weeks)

- Scaffold Electron Forge + React + strict TypeScript + SQLite with formatting, linting, tests, and CI. Keep main, preload, renderer, shared domain, and workers as explicit build targets.
- Lock down the renderer (`nodeIntegration: false`, `contextIsolation: true`, sandbox enabled), add a typed `contextBridge` API, and prove invalid IPC payloads are rejected.
- Benchmark the Forge Vite TypeScript setup against the more conservative webpack TypeScript template, including packaged builds; record the choice.
- Prove read/write/re-read round trips for MP3, FLAC, M4A, Opus, and one awkward format. Compare `music-metadata` for reading with `@akabeko/music-metadata-editor` and TagLib-based writing options. Test unknown-frame preservation, artwork, memory use, large files, and malformed input before selecting the writer.
- Package the SQLite binding on macOS, Windows, and Linux and verify migrations/backups in packaged builds.
- Prove safe replace behavior on macOS, Windows, and an exFAT volume.
- Prototype a MusicBrainz album search with global rate limiting and cache.
- Package `fpcalc` for macOS and Windows in a throwaway branch/spike; document binary size, licenses, and signing impact.
- Prototype sync planning against two directory trees, including case-insensitive collisions.
- Record architecture decisions and adjust the scope/format matrix.

**Exit:** the TypeScript-first stack can scan, tag, identify, and copy representative fixtures in packaged macOS and Windows builds; IPC isolation, native dependency packaging, and major licensing/distribution questions are documented.

### Phase 1 — trustworthy local catalog (2–3 weeks)

- Library-root onboarding and permissions.
- SQLite schema/migrations and repository layer.
- Incremental scan job with cancellation, progress, and per-file errors.
- Album/artist/track browsing, search, technical details, and problem filters.
- Settings and database backup/restore.

**Exit:** a large test library can be indexed repeatedly without UI stalls or losing user state.

### Phase 2 — metadata workbench (2–3 weeks)

- Single and batch edit UI.
- Validation, preview, snapshots, safe writes, verification, and honest undo.
- Artwork import/export and format-aware write policy.
- Optional rename/move planner as a separately confirmed workflow.

**Exit:** supported formats pass round-trip fixtures and interrupted/failed writes do not silently corrupt catalog state.

### Phase 3 — DAP sync (2–3 weeks)

- Folder-backed device profiles and selection rules.
- Naming templates, path sanitization, M3U8 generation, capacity checks, and collision UI.
- Manifest-based incremental plan/apply, copy verification, cancellation, restart, and history.
- Opt-in deletion of manifest-owned files only.
- Real exFAT and initial DAP validation.

**Exit:** a repeat sync copies only necessary changes and cannot plan deletion of unknown files.

### Phase 4 — online identification (2–3 weeks)

- Provider abstraction, cache, rate limiting, backoff, privacy copy, and diagnostics.
- MusicBrainz release search and album-aware candidate scoring/comparison.
- Cover Art Archive integration.
- Optional AcoustID/Chromaprint lookup after packaging and terms are cleared.

**Exit:** a user can identify a poorly tagged album, understand the confidence, preview changes, and apply them explicitly.

### Phase 5 — favorites and Radar (1–2 weeks)

- Favorite-artist search and stable MusicBrainz identity.
- Manual refresh, release normalization/diff, upcoming/recent/newly-found views, and seen/dismiss state.
- Optional randomized background refresh and native notifications only after manual refresh is solid.

**Exit:** repeat refreshes do not duplicate items, partial dates remain accurate, and offline/error states preserve the last successful view.

### Phase 6 — release hardening (2+ weeks)

- Accessibility and performance passes against a realistically large library.
- Signed/notarized macOS distribution and signed Windows installer; signed updater artifacts.
- Crash-safe logging and user-exportable diagnostics with paths redacted by default.
- Security review of Electron window preferences, navigation/window-open handlers, CSP, preload API, IPC validation, external URLs, and helper-process execution.
- Linux beta packaging and manual test matrix, if quality is sufficient.
- User documentation, privacy notice, provider attribution, third-party licenses, and backup guidance.

**Exit:** all version 1 acceptance criteria pass on the supported platform matrix and update signing keys have a documented backup/recovery procedure.

## 13. Version 1 acceptance criteria

- A 100,000-file synthetic/fixture-heavy library scan remains responsive, cancellable, and resumable/re-runnable; unchanged rescans are materially faster than initial scans.
- One malformed or inaccessible file cannot abort the overall scan.
- Every tag mutation has a preview, a stored before-state, a post-write verification result, and a visible per-file error if it fails.
- No MusicBrainz request exceeds the shared one-request-per-second policy, including simultaneous Radar and matching jobs.
- Radar never equates “first seen” with “released” and never duplicates an item across refreshes.
- A sync plan is deterministic for the same catalog/profile/target manifest.
- Apply never writes outside the selected target root and never deletes a file not owned by an earlier Outgroove manifest.
- Unplugging the target during sync leaves source files untouched and results in a recoverable/understandable target state.
- User-owned state survives a catalog rebuild and application upgrade.
- Packaged builds pass the declared macOS and Windows matrix; Linux remains visibly labeled beta until its matrix passes.

Performance thresholds should be measured and finalized after Phase 1 on representative hardware rather than invented in advance.

## 14. Major risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Tag libraries have format-specific gaps or lose uncommon frames | Adapter boundary, fixture round trips, preserve unknown data where possible, narrow the advertised write matrix if necessary. |
| Matching chooses the wrong edition | Album-level scoring, explain conflicts, retain existing values, require explicit confirmation. |
| MusicBrainz/AcoustID limits or outages | Shared rate limiters, cache, backoff, offline-first UI, manual refresh, provider adapters. |
| Public API terms conflict with commercial plans | Decide distribution model early; obtain a commercial plan/permission or host licensed data/services before charging. |
| Sync damages target content | Preview, manifest ownership, temporary copies, verification, manifest-last commit, deletion off by default. |
| Drive identity/path changes | Combine volume metadata and manifest identity; prompt on ambiguity. |
| Cross-platform path behavior causes collisions | Central path policy and property tests; validate against the target filesystem before apply. |
| Fingerprinting complicates licenses and packaging | Optional feature flag/sidecar, Phase 0 license review, ship only after signed builds pass. |
| Electron increases installer size and idle memory | Accept the tradeoff for a TypeScript-first codebase; measure packaged startup/memory, virtualize large lists, and keep heavy work outside renderer/main event loops. |
| A compromised renderer reaches user files | Keep Node integration off, context isolation and sandboxing on, expose narrow preload methods, validate IPC inputs, deny arbitrary navigation, and use a strict CSP. |
| Native SQLite or metadata modules complicate packaging | Prefer prebuilt/N-API or pure TS/WASM packages, run packaged CI per OS/architecture, pin versions, and keep adapters replaceable. |
| A large library overwhelms UI/database | Pagination/virtualization, indexed queries, incremental events, bounded jobs, profiling with realistic scale. |

## 15. Decisions needed before or during Phase 0

1. Is Outgroove intended to remain free/non-commercial, or could it become paid? This affects provider agreements.
2. Which DAP model(s), filesystems, playlist conventions, and audio formats are the first real target?
3. Should version 1 organize files in place, or only edit tags and sync into a clean target hierarchy? Recommendation: defer source moves until tag editing is proven safe.
4. Which fields and artwork policy should be Outgroove's canonical defaults? Recommendation: preserve user values, prefer release-specific metadata, and make artwork limits a device-profile concern.
5. Should compilations, classical works/movements, multi-artist credits, and box sets be first-class in version 1? Recommendation: model them correctly now, even if their specialized UI comes later.
6. How long should Radar consider a release “recent,” and should singles/appearances/remixes be enabled by default?
7. Is Linux a version 1 support commitment or a beta/best-effort build? Recommendation: beta until real removable-storage testing is complete.

## 16. First implementation slice

Build a narrow vertical slice before expanding the UI:

1. Add one library folder.
2. Scan a fixture album into SQLite.
3. Display its tracks and raw/normalized tags.
4. Edit the album title through a preview.
5. Safely write and verify the files.
6. Create a folder-backed DAP profile.
7. Preview and apply a copy, producing a manifest and M3U8 playlist.
8. Re-run both scan and sync and prove they are incremental.

This slice exercises the most consequential architecture boundaries without waiting for the full product.

## 17. Primary references

- [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)
- [Electron distribution overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)
- [Electron application updates](https://www.electronjs.org/docs/latest/tutorial/updates)
- [Electron Forge](https://www.electronforge.io/)
- [Electron Forge makers](https://www.electronforge.io/config/makers)
- [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API)
- [MusicBrainz rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- [Cover Art Archive API](https://musicbrainz.org/doc/Cover_Art_Archive/API)
- [AcoustID web service](https://acoustid.org/webservice)
- [Chromaprint / fpcalc](https://acoustid.org/chromaprint)
- [`music-metadata` read support](https://www.npmjs.com/package/music-metadata)
- [`@akabeko/music-metadata-editor` candidate writer](https://www.npmjs.com/package/@akabeko/music-metadata-editor)
- [TagLib format and license information](https://taglib.org/)
