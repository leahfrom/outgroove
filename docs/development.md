# Development details

The short setup in the README is enough for most contributors. This document
keeps the toolchain, dependency, and specialized verification notes that are
useful when maintaining or packaging Outgroove.

## Install and dependency review

Use Node.js 24 or newer and npm 11 or newer, then install exactly from the
lockfile with `npm ci`.

The reviewed install scripts are limited in `package.json` to `better-sqlite3`,
`esbuild`, and `unrs-resolver`. `better-sqlite3` is a privileged native
dependency and Electron Forge rebuilds it for the packaged Electron ABI.

Forge 7 currently resolves vulnerable older `tar` and `tmp` development
transitive dependencies, so the lockfile applies narrow overrides to patched
`tar` 7.5.22 and `tmp` 0.2.7. Packaging and smoke tests cover their exercised
rebuild and archive path.

The npm advisory database also reports CVE-2026-14257 through transitive
development-tool `brace-expansion` paths. Its officially recognized fixed
release changes the module API and breaks minimatch versions used by the pinned
Forge and ESLint stack, so a global override is not safe. These build globs
receive repository-controlled patterns, not Library, provider, or user input.
Revisit this when compatible upstream consumers are available; do not use
`npm audit fix --force`.

## Commands

```sh
npm start
npm run format:check
npm run lint
npm run typecheck
npm test
npm run verify
npm run package
npm run test:smoke
npm run inspect:package
npm run make
npm run fixtures:generate
npm run benchmark:library
npm run benchmark:library:100k
npm run benchmark:metadata
```

Automated write tests copy the CC0 generated fixtures under `fixtures/audio/`
into operating-system temporary directories. They never scan or modify a real
music library or mounted device. The Library benchmarks similarly create
temporary generated data; their interpretation is documented in the
[performance baseline](performance-baseline.md).

## Packaged-app inspection

Use the dedicated inspection harness for manual accessibility, responsive
layout, and Computer Use checks:

```sh
npm run inspect:package
```

The command builds a production-equivalent package with an inspection-only
compile-time gate and a distinct **Outgroove Inspection** application identity
and package output. It creates one
`outgroove-inspection-*` directory under the operating-system temporary
directory, copies in the redistributable preservation fixture, launches
the app, and prints one `OUTGROOVE_INSPECTION_READY` JSON record. That record
contains the exact app path, Electron PID, user-data/database path, fixture
target, session ID, and configuration path for automation to verify before
interacting.

The renderer displays an **Isolated inspection profile** banner for the same
session. A normal package compiles this startup path out and cannot accept the
inspection configuration argument. The inspection build also refuses paths
outside its generated temporary root, symlink escapes, a reused ready marker,
or combined smoke/inspection mode.

Leave the command running during inspection. Press `Ctrl+C` when finished; the
harness terminates the marker-recorded Electron process and removes the whole
temporary inspection directory. Use `npm run inspect:package -- --empty` only
when an empty disposable catalog is specifically needed. The command never
uses a real catalog, music library, or mounted DAP.

## Platform-specific checks

Windows verification also opens fixture files from a separate PowerShell
process with an exclusive `FileShare.None` lock. It confirms that a locked
metadata source and a locked manifest-owned sync destination fail without
changing the existing file or advancing the manifest.

The real-volume exFAT conformance probe is intentionally manual and requires an
exact absolute path to an explicitly authorized disposable target:

```sh
npm run test:exfat -- --target "/absolute/path/to/disposable-target" --confirm-disposable-exfat-probe
```

The command verifies the filesystem before writing, creates one unique
`.outgroove-exfat-probe-*` child, uses only generated fixtures, and removes only
that child. Never point it at a music library or an unbacked-up card. See the
[filesystem conformance procedure](filesystem-conformance.md).

Release-specific native checks, signing, manual fallbacks, artifact audits, and
Gitflow cleanup are documented in the [release runbook](release-runbook.md).
