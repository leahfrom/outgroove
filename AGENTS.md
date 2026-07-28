# AGENTS.md

This file governs the whole Outgroove repository.

## Start here

Read `PLAN.md` before designing or implementing a feature. It defines the product boundaries, safety model, architecture, delivery phases, and open decisions. If implementation needs to depart from it, explain why and record a short decision under `docs/decisions/` in the same change.

Outgroove is a local-first, cross-platform music-library manager. User audio libraries and removable drives may contain irreplaceable data. Correctness and recoverability matter more than cleverness or maximum throughput.

## Product invariants

These are hard requirements:

1. Never modify an audio file without an explicit, user-visible preview of the intended change.
2. Never modify source audio during DAP sync.
3. Never delete a target file unless an earlier Outgroove manifest marks that exact path as Outgroove-owned and the user explicitly enabled and confirmed deletion.
4. Never let a generated destination path escape the selected target root.
5. Never make low-confidence remote matches apply automatically.
6. Never require the network for local scanning, browsing, tag editing, or sync.
7. Never send audio content to a remote service. Clearly disclose any metadata or fingerprint sent.
8. A bad file, network response, or disconnected drive must fail locally, not abort unrelated work or leave silent corruption.

If a requested change conflicts with an invariant, stop and surface the conflict instead of weakening the invariant.

## Architecture boundaries

- The Electron renderer presents state and gathers intent. It must remain sandboxed and must not access Node.js, arbitrary files, shell commands, provider clients, or SQLite directly.
- TypeScript application services in Electron's main/utility processes own scanning, tagging, hashing, provider access, Radar diffing, sync planning/apply, and persistence.
- Shared domain code must not depend on Electron, IPC, SQLite row types, HTTP payload types, Node filesystem APIs, or operating-system UI APIs.
- Hide tag libraries, provider clients, database access, filesystem behavior, and platform-specific volume discovery behind narrow adapters.
- IPC uses explicit serializable request/response DTOs validated at runtime in the main process. Do not expose internal database models over IPC.
- The preload layer is a minimal `contextBridge` allowlist. Never expose raw `ipcRenderer`, Node primitives, arbitrary channel names, or a generic invoke function.
- Browser windows use `nodeIntegration: false`, `contextIsolation: true`, and sandboxing. Deny unexpected navigation/window creation and set a restrictive Content Security Policy.
- Long work runs as cancellable jobs with bounded concurrency, progress, and structured per-item errors in worker threads or utility processes. Do not block the renderer or main-process event loop.
- Keep source-of-truth state in SQLite and main-process services. Do not create a second catalog in renderer state.
- New preload methods, IPC channels, filesystem/shell/process access, remote content, protocol handlers, or updater behavior require an explanation and a security-focused test/review.

## Data and migrations

- Use migrations from the first schema change. Never edit a migration that has shipped; add a new one.
- Separate rebuildable file-derived catalog data from durable user state such as favorites, manual matches, Radar history, device profiles, and sync manifests.
- Preserve MusicBrainz artist, recording, release, and release-group identifiers as different typed concepts.
- Preserve partial dates and ordered artist credits. Do not flatten them into lossy strings.
- Store remote cache payloads with provider and schema-version metadata so failures can be diagnosed and remapped.
- All multi-record state transitions that must agree belong in a transaction.
- Never log secrets. Redact filesystem paths and personally identifying tag values from exported diagnostics by default.

## Filesystem and metadata safety

- Treat every path as an OS-native path in the privileged Node.js layer, using `node:path`. Do not build filesystem paths by interpolating slash-delimited strings in renderer code.
- Canonicalization is for containment/security checks, not for replacing the user's display path.
- Handle symlink/junction loops, case-folding collisions, Unicode normalization, Windows reserved names, long paths, and FAT/exFAT timestamp precision explicitly.
- For write operations, snapshot the previous tags, use a same-volume temporary file where appropriate, flush, replace as atomically as the target permits, then re-read and verify.
- Preserve unknown/private metadata frames when the adapter can do so safely. If it cannot, warn in the preview and add a regression fixture.
- A rename/move is a distinct operation from a tag edit and needs a separate plan.
- Do not test writes against a developer's real music library or a real mounted target unless the user specifically authorizes that exact path. Prefer checked-in redistributable fixtures and temporary directories.
- Do not infer that a removable drive is the expected device from its mount path alone.

## Sync rules

- Sync is split into pure `plan` and side-effecting `apply` stages. The plan is deterministic for identical inputs and is serializable for UI review and tests.
- Validate free space, target containment, case-insensitive conflicts, reserved names, path length, duplicate destinations, and missing source files before apply.
- Copy into a temporary destination, verify according to the profile, then rename. Write the new manifest last.
- Keep enough previous manifest state to explain or resume a partial run.
- Unknown target files are never silently adopted, replaced, or removed.
- Mirror mode remains opt-in and its exact deletion set must be displayed.

## External providers

- All MusicBrainz traffic shares one global limiter capped at one request per second and sends a meaningful versioned/contact `User-Agent`.
- Cache and deduplicate requests; use cancellation and exponential backoff with jitter for transient failures.
- Cover artwork is fetched through the Cover Art Archive API.
- AcoustID has its own limiter (currently no more than three requests per second) and needs a registered application key. Fingerprinting remains optional.
- Provider live tests are opt-in. Normal CI uses recorded, scrubbed fixtures and must never consume public API capacity unexpectedly.
- Before changing commercial behavior or shipping a new provider integration, check current terms and record the decision. Do not assume public endpoints are free for commercial distribution.
- Distinguish provider facts from inference: “first seen in MusicBrainz” is not the same as “released today.”

## Cross-platform expectations

- macOS and Windows are initial supported targets. Linux must continue to compile and is treated as beta until its storage/tag manual matrix passes.
- Do not merge platform-dependent behavior without either coverage on that platform or a documented, narrowly scoped fallback.
- Keep platform-specific code in adapters. Avoid target-condition checks scattered through domain or UI code.
- Test packaged applications early; browser-only success is insufficient for file permissions, native dialogs, sidecars, updates, or removable storage.
- UI behavior must tolerate Chromium upgrades and platform font/input/accessibility differences. Prefer standard, well-supported web APIs.
- Follow `docs/release-runbook.md` for every release, including the exact-tag build, native Windows manual handoff, Linux artifact, checksum/remote-asset audit, honest CI-budget fallback reporting, and Gitflow back-merge/cleanup. A release is incomplete while any required platform artifact or evidence is missing.

## Implementation conventions

- Use the repository's pinned toolchain and lockfiles. Do not upgrade broad dependency sets as part of an unrelated feature.
- Prefer small, typed modules with names from the domain over generic managers, helpers, or `utils` collections.
- Model expected failures with structured error types suitable for user-facing recovery. Do not discard file/provider context or return opaque strings across every layer.
- Comments explain safety constraints or non-obvious reasoning, not line-by-line mechanics.
- Avoid speculative abstractions. Add an interface where the plan identifies a real boundary or where tests need a substitute.
- Keep user-visible terminology consistent: Library, Workbench, Radar, Sync, DAP profile, plan, and apply.
- Preserve existing user changes and keep a task's diff focused.

Once the project is scaffolded, follow the formatters and linters configured in the repository. Until then, use strict TypeScript, Prettier, ESLint with type-aware rules, and an import-boundary rule that prevents renderer/shared code from importing privileged Electron or Node modules.

## Testing requirements

Every behavior change needs tests at the lowest useful layer, plus a higher-level test when an adapter boundary or safety invariant is involved.

At minimum:

- Tag changes: read/write/re-read fixture test and failure-path test.
- Scan changes: incremental/unchanged behavior plus corrupt or inaccessible input.
- Match changes: recorded response fixtures, ambiguous candidates, and confidence explanation.
- Radar changes: initial snapshot, repeat refresh, partial dates, changed dates, and seen/dismiss persistence.
- Path/template changes: Unicode, traversal, reserved names, case collisions, and property tests.
- Sync changes: plan golden test, interrupted apply, unknown target files, changed source, capacity error, and manifest-last behavior.
- Schema changes: migrate a database from the previous released schema and verify durable user state survives.
- UI mutations: preview, confirmation, progress, recoverable failure, and keyboard access.

Run focused tests while iterating and the relevant full TypeScript, integration, and packaged-app suites before handoff. If a platform test cannot be run locally, state exactly which CI/manual check remains.

## Agent workflow

1. Read this file, the relevant part of `PLAN.md`, and nearby code/tests before proposing changes.
2. Check the worktree and preserve unrelated edits.
3. For risky workflows, state the invariants and failure modes before implementation.
4. Implement the smallest complete vertical behavior rather than disconnected scaffolding.
5. Add or update tests and fixtures in the same change.
6. Run formatters, static checks, and relevant tests.
7. Review the final diff for accidental permissions, destructive behavior, path leaks, provider calls, and unrelated churn.
8. Hand off with the outcome, files changed, verification performed, and any unverified platform/risk.

Do not claim a phase or feature is complete when its acceptance criteria, error states, or safety tests are missing. Update `PLAN.md` only when product scope or a recorded decision genuinely changes—not as a progress log.
