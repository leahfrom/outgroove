# ADR 0001: Forge Vite foundation, native SQLite, and narrow pure-TS metadata writing

- Status: accepted for the first implementation slice
- Date: 2026-07-21

## Context

Phase 0 requires real evidence for Electron bundling, SQLite packaging, and metadata writing. A wrong writer can silently destroy private tags or audio; a native SQLite binding can work in Node development and fail under Electron's ABI or ASAR packaging.

## Decision

Use Electron Forge 7 with its Vite plugin and explicit main, preload, metadata-worker, and renderer entries. Use `better-sqlite3` only behind the main-process database adapter, with append-only migrations and Forge's native-unpack plugin. Use `music-metadata` for reads.

Use `@akabeko/music-metadata-editor` behind `MetadataWriter` for album-title writes to MP3 and FLAC only. The adapter never asks it to overwrite a source: it writes a same-directory temporary output, flushes it, re-reads intended metadata, compares an independently extracted audio-payload hash, moves the original to a rollback path, installs the candidate, re-reads again, and removes rollback only after verification. Any failed verification restores or retains the original and is reported per file.

Keep `taglib-wasm` as a development-only comparison, not a shipped runtime dependency in this slice.

## Evidence

The checked-in sub-second CC0 fixtures contain an MP3 private `TXXX:OUTGROOVE_PRIVATE` value and a FLAC private Vorbis `OUTGROOVE_PRIVATE` value. `scripts/metadata-writer-spike.ts` wrote a changed album title through both `@akabeko/music-metadata-editor` 1.0.1 and `taglib-wasm` 1.5.3.

For both candidates and both formats:

- `music-metadata` re-read the intended new album title;
- the private value remained `preserve-me`;
- duration stayed stable;
- FFmpeg packet-copy hashes were identical before and after.

Observed packet SHA-256 values:

- MP3 before / Akabeko / TagLib-Wasm: `a2d23cf8d9b1c5ffc6c06131590b8c23ce44f903fa810642b9c171a2493d98d2`
- FLAC before / Akabeko / TagLib-Wasm: `c1183ec46f2e3377c74d4386668cfdfc12bb244224bcbb3f6493b0f8b3df9710`

Akabeko was selected because the tested implementation is pure TypeScript, MIT licensed, emits a separate output path, and avoids shipping the TagLib WASM/LGPL-MPL relinking surface. This evidence does not justify advertising other formats or arbitrary unknown-frame preservation.

The Forge Vite build successfully emitted distinct main, preload, worker, and renderer bundles. The native SQLite binding loaded and migrated under Node. The packaged Electron app and native ABI are verified by `npm run package` plus `npm run test:smoke`; platform results are tracked in `docs/test-matrix.md`.

For sync, an ordinary rename of a newly created destination could overwrite an unknown file created between preview and apply on POSIX. New targets therefore commit a verified same-directory temporary file with an atomic no-clobber hard link, falling back to `COPYFILE_EXCL` plus re-verification where hard links are unsupported. Replacement by rollback/rename is used only when the previous Outgroove manifest owns the exact destination. This is a deliberate safety-first refinement of the plan's generic “rename” wording.

## Consequences

- Runtime requires Node 24 for development because the chosen writer requires it; Electron 43 provides the packaged runtime.
- Write support stays MP3/FLAC until more format-specific preservation fixtures pass.
- Vite remains an experimental Forge plugin risk; distinct entry names and the packaged smoke test guard its output contract.
- `better-sqlite3` remains a native packaging risk and must be exercised on every packaged platform.
- Full-file writer/payload hashing is memory-heavy and must be replaced with streaming or format-aware bounded IO before large-file claims.
