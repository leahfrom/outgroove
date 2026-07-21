# Outgroove

Outgroove is a local-first Electron application for understanding a local music library, safely previewing tag changes, and copying selected albums to a folder-backed DAP target. This repository currently contains the first narrow vertical slice, not the whole product roadmap.

## What works

- Choose one library folder with a native dialog and scan supported audio extensions in a bounded worker pool.
- Observe a persisted scan job, cancel it safely from the UI, and retry completed, cancelled, failed, or restart-interrupted scans through the incremental path.
- Store normalized and native tag views, technical properties, per-file failures, and incremental scan signatures in migrated SQLite.
- Browse albums and tracks in a sandboxed React renderer.
- Preview an album-title change per file, explicitly confirm it, snapshot the before-state, write through a same-volume temporary file, verify the audio payload and tags, replace, re-read, and report per-file results.
- Choose a normal folder as a fake DAP, preview a deterministic copy-only plan, apply verified temporary copies, write UTF-8 M3U8, and commit `.outgroove/manifest.json` last.
- Repeat scans skip unchanged files; repeat syncs plan no unnecessary copies.

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
npm run test:smoke     # launch package; verify SQLite, renderer, and metadata worker
npm run make           # ZIP artifact for the current platform
```

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

## Format status

The scanner asks `music-metadata` to read MP3, FLAC, M4A/MP4, Ogg Vorbis, Opus, WAV, AIFF, APE, and WavPack extensions. Actual malformed/unsupported inputs remain visible as item-level errors.

Album-title writing is deliberately narrower:

| Format                | Read        | Album-title write | Evidence                                                                          |
| --------------------- | ----------- | ----------------- | --------------------------------------------------------------------------------- |
| MP3                   | Yes         | Yes               | Write/re-read, private `TXXX` preservation, identical audio-payload hash          |
| FLAC                  | Yes         | Yes               | Write/re-read, private Vorbis field preservation, identical FLAC audio-frame hash |
| Other scanner formats | Best effort | No                | Preview warns and confirmation is disabled                                        |

The production writer is `@akabeko/music-metadata-editor`, wrapped by Outgroove's `MetadataWriter`. See [ADR 0001](docs/decisions/0001-foundation-and-metadata-writer.md). This is fixture evidence, not a claim that every unusual tag/frame in the wild is safe. Broadening the write matrix requires a new preservation fixture and round-trip test.

## Safety status and limitations

- The renderer has no Node, Electron, SQL, path, or generic IPC access. Requests are a fixed `contextBridge` allowlist and are runtime-validated again in main.
- Folder selection is explicit. For development, choose only `fixtures/audio/` or another disposable test folder unless you intentionally authorize an exact real path.
- Tag writes retain a rollback copy until the replacement is re-read and verified. Recovery across sudden power loss and exFAT behavior still require manual matrix testing.
- Sync is copy-only. Unknown target files are not adopted or replaced, and there is no deletion implementation.
- Target identity is currently the explicitly selected folder path plus manifest/profile identity; removable-volume identity is deferred.
- Tag audio-payload verification and sync copy verification use bounded-memory streaming SHA-256. MP3/FLAC container-boundary parsing remains deliberately format-specific and fixture-tested.
- Scan jobs persist progress and terminal state. An app restart marks unfinished work as interrupted and offers a safe incremental retry; exact mid-file queue resumption is not implemented.
- macOS arm64 is the only packaged platform verified locally. Windows and Linux package jobs are configured in CI; Windows locking/rename behavior, macOS Intel, Linux storage behavior, and real exFAT/DAP tests remain unverified.
- Packages are unsigned and not notarized.

## Repository boundaries

- `src/renderer`: presentation and intent only
- `src/preload`: fixed typed bridge
- `src/main`: Electron orchestration, validated IPC, SQLite, filesystem, metadata, edit, and sync services
- `src/shared`: serializable contracts and pure domain rules
- `src/workers`: bounded metadata worker entry point
- `migrations`: append-only schema history
- `tests`: architecture, temporary-filesystem integration, and packaged smoke tests

The next smallest valuable slice is a larger redistributable writer/corrupt-file fixture corpus plus paginated catalog search and problem filters, followed by manual Windows locking and exFAT verification—not online metadata or mirror deletion.
