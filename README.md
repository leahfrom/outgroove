# Outgroove

Outgroove is a local-first desktop music-library manager for people who keep
their own audio files and sync selected music to a digital audio player (DAP)
or SD card.

It scans and organizes a local collection, provides carefully reviewed metadata
editing, follows favorite artists through Radar, and creates deterministic,
manifest-backed DAP sync plans. Local scanning, browsing, editing, and sync do
not require an account or network connection.

Outgroove is under active pre-1.0 development. Releases are prereleases, macOS
and Windows are the initial supported targets, and Linux packages remain beta.

## Highlights

- Browse a local catalog by album, artist, track, genre, format, folder, saved
  filter, and data-quality finding.
- Edit supported MP3 and FLAC metadata and artwork through explicit
  current-to-proposed comparison, per-file preview, confirmation, verified
  write, and undo workflows.
- Search MusicBrainz for album candidates or optionally identify one recording
  with a local Chromaprint fingerprint and separately confirmed AcoustID
  lookup. Remote candidates never apply automatically.
- Follow exact MusicBrainz artist identities in Radar with durable,
  offline-readable release snapshots and optional native notifications.
- Build deterministic DAP plans with path validation, temporary copies,
  verification, manifest-last commit, cancellation, and restart-safe recovery.
  Cleanup is off by default and can remove only exact obsolete paths proved
  Outgroove-owned by the applicable earlier manifest after full preview and
  confirmation. Unknown target files are never deleted.
- Back up and verify the local SQLite catalog without copying or changing audio.

The complete implemented behavior, format matrix, and known limitations are in
[Current capabilities, safety, and limitations](docs/current-capabilities.md).
The broader product direction and acceptance criteria are in [PLAN.md](PLAN.md).

## Safety model

Outgroove treats music libraries and removable storage as irreplaceable:

- Audio changes always require a visible proposal, exact preview, and explicit
  confirmation.
- DAP sync never modifies source audio.
- Sync cannot generate a destination outside the selected target root.
- Unknown target files are never silently adopted, replaced, or removed.
- Remote matching is explicit, privacy-disclosed, rate-limited, and never
  applied automatically.
- A malformed file, provider failure, or disconnected drive fails locally
  without aborting unrelated work.

The renderer remains sandboxed and has no direct Node.js, filesystem, SQLite,
shell, provider-client, or generic IPC access. See [AGENTS.md](AGENTS.md) for
the non-negotiable product and architecture invariants.

## Downloads

The [GitHub Releases](https://github.com/leahfrom/outgroove/releases) page
provides:

- a signed and notarized drag-to-Applications DMG for macOS arm64;
- an unsigned Windows x64 Setup application and portable ZIP;
- a Linux x64 beta ZIP; and
- `SHA256SUMS.txt` for all application artifacts.

Windows may show a SmartScreen warning because Windows signing is not yet
implemented. Back up important files before testing prerelease metadata writes.
Every release follows the exact-tag, cross-platform verification and artifact
audit in the [release runbook](docs/release-runbook.md).

## Development

Requirements:

- Node.js 24 or newer
- npm 11 or newer
- macOS, Windows, or Linux

Install exactly from the lockfile:

```sh
npm ci
```

Common commands:

```sh
npm start
npm run format:check
npm run lint
npm run typecheck
npm run verify
npm run package
npm run test:smoke
npm run inspect:package
```

Automated write tests use only generated, redistributable fixtures copied into
temporary directories. Never point tests at a real music library or mounted
DAP. See [CONTRIBUTING.md](CONTRIBUTING.md) for Gitflow, verification, fixture,
and contribution requirements.

## Network and privacy

No provider call occurs automatically. MusicBrainz, Cover Art Archive, and
AcoustID actions explain the exact outgoing data and require user intent.
Outgroove never sends audio content. Local Library and Sync functionality stays
available offline.

The public provider endpoints are approved only for Outgroove's current
non-commercial distribution. Commercial distribution requires a fresh terms
review and, where necessary, an agreement or replacement provider. See the
[AcoustID setup guide](docs/acoustid.md) and provider ADRs under
[docs/decisions](docs/decisions).

## Documentation

- [Current capabilities and limitations](docs/current-capabilities.md)
- [Product and architecture plan](PLAN.md)
- [Contributing](CONTRIBUTING.md)
- [Development details](docs/development.md)
- [Security policy](SECURITY.md)
- [Release runbook](docs/release-runbook.md)
- [Architecture decisions](docs/decisions)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

Outgroove's original source code is licensed under the
[GNU General Public License version 3 or later](LICENSE).

Third-party components retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The generated audio fixtures
under `fixtures/audio/` are CC0-1.0. Cover artwork obtained through the Cover
Art Archive may remain subject to third-party copyright.
