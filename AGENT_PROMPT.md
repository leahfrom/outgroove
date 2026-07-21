# Outgroove implementation prompt

Copy the prompt below into an agent task with the Outgroove repository as its working directory.

---

You are the lead implementation agent for **Outgroove**, a local-first, cross-platform desktop application for organizing a local music library and synchronizing selected music to a DAP/SD card.

Your task is to build the project's secure foundation and its first complete vertical slice. Do not attempt to superficially scaffold the entire roadmap. Deliver a small, working path through the real architecture that later features can extend.

## Required reading

Before changing anything:

1. Read `AGENTS.md` completely and obey it as repository-level instructions.
2. Read `PLAN.md` completely, especially the product invariants, architecture, Phase 0, Phase 1, and “First implementation slice.”
3. Inspect the repository, current worktree, toolchain, and existing tests. Preserve unrelated user changes.

If this prompt conflicts with `AGENTS.md`, follow `AGENTS.md`. If implementation evidence requires a material departure from `PLAN.md`, create a short ADR in `docs/decisions/` explaining the evidence and decision instead of silently diverging.

## Objective

Implement a TypeScript-first Electron application that proves this end-to-end workflow:

1. Launch a packaged-capable Electron app with a sandboxed React renderer.
2. Let the user choose one local library folder through a native folder dialog.
3. Scan supported audio fixtures/files without blocking the renderer or Electron main event loop.
4. Persist a minimal catalog in SQLite and make a repeat scan incremental.
5. Display albums and their tracks, including normalized tags, original/native tag information where practical, file path, format, duration, and scan errors.
6. Let the user propose an album-title edit, view a per-file before/after preview, explicitly confirm it, safely write it, re-read it, and display verification results.
7. Let the user choose a normal folder as a fake DAP target, create a simple sync profile, preview the copy plan, apply it, write an M3U8 playlist and `.outgroove/manifest.json`, then prove a repeat sync has no unnecessary copies.

Use only redistributable test fixtures and temporary directories for automated or exploratory writes. Never scan, edit, or sync a real user music library unless the user explicitly authorizes the exact path.

## Technical direction

- Electron + Electron Forge.
- React and strict TypeScript throughout renderer, preload, main, workers, shared domain, and tests.
- Prefer pnpm unless the existing repository has already committed to another package manager.
- Keep explicit `main`, `preload`, `renderer`, `shared`, and `workers` boundaries as described in `PLAN.md`.
- Renderer settings must include `nodeIntegration: false`, `contextIsolation: true`, and sandboxing.
- The preload API must be a narrow typed `contextBridge` allowlist. Never expose raw `ipcRenderer`, filesystem primitives, arbitrary IPC channel names, or a generic invoke method.
- Validate every IPC request at runtime in the main process with explicit schemas. Return structured, serializable errors.
- Keep SQLite access, filesystem operations, metadata access, and native dialogs outside the renderer.
- Use migrations from the first database schema.
- Use `music-metadata` behind a `MetadataReader` interface for the read path unless repository evidence shows a better maintained option.
- Put writing behind a separate `MetadataWriter` interface. Evaluate the candidates documented in `PLAN.md` using real round-trip fixture tests before choosing one. Do not select a writer solely from its README.
- If no candidate safely preserves the required fields and audio payload, stop tag-writing implementation at a fully working preview boundary, document the failed experiments in an ADR, and report the precise blocker. Do not risk corrupt writes to satisfy the checklist.
- Keep sync planning pure and deterministic. Keep sync apply separate and side-effecting.
- Heavy/high-volume scanning and metadata work belongs in bounded worker threads or Electron utility processes, with cancellation and progress reporting.
- Do not implement MusicBrainz, AcoustID, Radar, background refresh, source-file moves, transcoding, mirror deletion, or automatic updates in this slice. Preserve the interfaces needed for those later phases without building speculative infrastructure.

## Minimum domain and persistence model

Implement only the fields needed for this slice, but use durable concepts from `PLAN.md`:

- Library roots.
- Audio files and scan state/errors.
- Local albums and tracks.
- Tag snapshots/edit operations.
- Sync profiles, manifests, and manifest entries.
- Persisted jobs only if required for the chosen resumability design; otherwise keep the job interface ready for persistence without inventing unused tables.

Keep file-derived catalog state rebuildable. Do not couple durable user state to a particular scan result. Use Outgroove-generated IDs and keep external provider IDs as optional, distinct fields.

## Safety requirements

These are acceptance conditions, not optional polish:

- One malformed, unsupported, or inaccessible file produces an item-level error and does not abort the scan.
- An unchanged repeat scan does not parse and rewrite every unchanged file.
- Tag editing follows: select → propose → validate → preview → confirm → snapshot → write → re-read → verify.
- A tag write uses a same-volume temporary output and replacement strategy appropriate to the chosen writer/platform. A failed verification is visible and never reported as success.
- Sync never changes source audio.
- Destination paths are constructed and checked in the privileged Node layer and can never escape the selected target root.
- Sync planning detects duplicate destinations, traversal, case-folding collisions, reserved names, missing sources, and insufficient target space where the platform exposes it reliably.
- Sync copies to a temporary destination, verifies it, renames it, and writes the manifest last.
- The first slice does not delete anything from a target. Unknown target files remain untouched.
- The renderer cannot obtain arbitrary filesystem access through IPC.
- No live provider requests or telemetry run during tests.

## UI expectations

Keep the UI modest but coherent. It must include:

- Empty/onboarding state.
- Library-folder selection and scan progress.
- Album list and album/track detail.
- Visible per-file scan errors.
- Tag-edit proposal and before/after confirmation screen.
- DAP target/profile screen.
- Sync preview grouped into copies, unchanged/skipped items, conflicts, and errors.
- Apply progress and final result.
- Keyboard-accessible controls, visible focus, useful accessible names, and no color-only status communication.

Do not spend the slice on visual branding or an elaborate component system. Establish a clean, usable shell and reusable state patterns.

## Tests and evidence

Add and run tests for at least:

- Album grouping and tag normalization.
- IPC runtime validation and rejection of unknown/invalid requests.
- Renderer import boundaries so it cannot import privileged Node/Electron modules.
- Initial and unchanged incremental scans.
- A corrupt/unsupported fixture that does not abort a scan.
- Metadata read/write/re-read for each format advertised as writable in this slice.
- Preservation checks for audio payload and unknown tags where the selected writer claims support.
- Destination naming with Unicode, traversal attempts, Windows reserved names, case collisions, and overlong segments.
- Deterministic sync-plan golden output.
- Sync apply, manifest-last behavior, repeat no-op sync, changed source, interrupted/failed copy, and unknown target files.
- Database migration from an empty database and backup/open verification.
- UI preview/confirm/failure states.
- A packaged application smoke test on the current OS.

Run format, lint, typecheck, unit tests, integration tests, and a production/package build. If another operating system cannot be exercised locally, configure appropriate CI where possible and explicitly identify what remains unverified. Never claim cross-platform completion based only on a development-server run.

## Working method

1. Inspect first and write a short execution plan before editing.
2. Resolve important unknowns through small spikes, especially bundling, SQLite packaging, and metadata writing.
3. Record only consequential decisions as ADRs.
4. Build the smallest end-to-end behavior, then expand tests and failure handling.
5. Keep commits/diffs focused and do not rewrite `PLAN.md` as a progress log.
6. Update `README.md` with prerequisites, development commands, tests, packaging, the currently supported read/write formats, and the safety status of the first slice.
7. Do not weaken a safety invariant to get a green demo.

You may install the dependencies required by this implementation after inspecting existing manifests and lockfiles. Pin through the lockfile, avoid unrelated upgrades, and review packages that receive filesystem or native-code privileges.

## Definition of done

The slice is done only when:

- A clean checkout can install dependencies, run checks/tests, start the app, and produce a packaged build using documented commands.
- The fixture workflow works from folder selection through catalog display, confirmed tag edit, sync preview, sync apply, manifest creation, and repeat no-op sync—or the metadata writer is rejected with concrete fixture evidence and the rest works through the preview boundary.
- Renderer isolation and IPC validation are covered by tests.
- Automated tests never touch real user media or mounted removable drives.
- Known limitations, supported formats, unverified platforms, and any blocked writer decision are stated plainly.

At handoff, report:

1. What is now working from the user's perspective.
2. Important architecture and safety decisions.
3. Files/modules added or changed.
4. Exact verification commands and their results.
5. Packaged platforms actually tested.
6. Known limitations and the next smallest valuable slice.

Proceed autonomously within these boundaries. Ask for user input only when a decision cannot be discovered or safely defaulted and would materially change the product or risk user data.

---

