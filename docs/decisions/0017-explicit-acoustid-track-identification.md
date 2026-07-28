# ADR 0017: Explicit AcoustID track identification with bundled Chromaprint

## Status

Accepted

## Context

MusicBrainz album matching works when useful album text already exists, but an
ambiguous or poorly tagged individual track may need audio-derived evidence.
The product plan permits optional Chromaprint/AcoustID lookup while prohibiting
audio uploads, automatic matches, renderer filesystem access, and metadata
writes without the ordinary preview and confirmation sequence.

Chromaprint needs decoded audio. A renderer implementation would expose file
bytes to the sandboxed UI, while a system-installed `fpcalc` dependency would
make packaged behavior unreliable and could execute an uncontrolled program
from `PATH`. Official Chromaprint binaries are available for Outgroove's
declared macOS arm64, Windows x64, and Linux x64 release targets.

AcoustID's public service currently permits non-commercial use, requires a
registered application key, limits clients to three requests per second, and
accepts a fingerprint plus whole-file duration for lookup. Fingerprint
submission is a distinct API with different credentials and consequences.

## Decision

- Bundle the unmodified official Chromaprint 1.6.1 `fpcalc` executable for
  macOS arm64, Windows x64, and Linux x64. Resolve only Outgroove's fixed
  resource path, invoke it without a shell, and keep it outside `app.asar` so a
  compatible LGPL build remains replaceable.
- Start fingerprinting only from one explicit selected-track action. Resolve
  the source path from the catalog in main; IPC accepts only the file UUID.
- Keep one bounded pending fingerprint in main memory for ten minutes. The
  renderer receives only its algorithm, character count, duration, SHA-256
  digest, and opaque confirmation state.
- Require a second explicit confirmation before sending the fingerprint and
  duration to the fixed HTTPS AcoustID lookup endpoint. Do not implement the
  submission endpoint.
- Recheck the catalog path, size, and modification time before lookup. A stale
  target invalidates the pending preview rather than sending old evidence for
  a changed file.
- Use a separate global request-start limiter with a 334 ms minimum interval,
  bounded retry/backoff for throttling, cancellation, runtime response
  validation, and a 24-hour provider cache keyed by a SHA-256 request digest.
  The raw fingerprint is not stored in SQLite.
- Embed the registered application key into the privileged main build only
  when `OUTGROOVE_ACOUSTID_API_KEY` is present. Missing keys leave the offline
  application usable and produce a precise lookup error.
- Present candidates as read-only evidence. No candidate is selected
  automatically. The only mutation bridge in this slice is an explicit action
  that copies one returned MusicBrainz recording UUID into the existing track
  draft; the normal tag preview, confirmation, snapshot, safe write, re-read,
  verification, and undo sequence remains unchanged.

## Consequences

No schema migration is required. Packages grow by roughly 2.5–5.1 MiB for the
one platform helper they contain. Unsupported architectures can run Outgroove
but cannot fingerprint. Commercial distribution requires an AcoustID agreement
or disabling/replacing this provider.

The helper carries Chromaprint/FFmpeg LGPL obligations. Exact upstream archive
and executable hashes, the license notice, source location, and replacement
path are shipped with the application. macOS release signing must continue to
sign and verify nested executable code in the final DMG.
