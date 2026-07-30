# Diagnostic reports

Outgroove can export a JSON diagnostic report from **Settings → Database
safety**. The report is intended for troubleshooting build, runtime, database,
and catalog-scale problems without exposing the user's music collection.

The user chooses the destination through the operating system's save dialog.
The sandboxed renderer cannot provide a path. Outgroove writes and flushes a
same-directory temporary file, replaces an existing selected report
recoverably, re-reads the published file, and verifies its SHA-256 digest
before reporting success.

## Included

- Outgroove version and whether the build is packaged.
- Operating-system platform and processor architecture.
- Electron, Chromium, and Node.js versions.
- Database schema version and a redacted integrity status.
- Aggregate counts for watched roots, catalog files and states, albums,
  tracks, scan problems and jobs, edit operations, DAP profiles and pending
  recoveries, saved filters, favorites, Radar items, and provider-cache
  entries.
- An explicit privacy-policy block describing the exclusions below.

## Excluded

Reports never include:

- Library, database, DAP, or destination paths.
- Filenames, normalized tags, native tags, album/track/artist names, saved
  filter names or queries, or DAP profile names.
- MusicBrainz, AcoustID, Radar, local catalog, profile, manifest, volume, or
  operation identifiers.
- Provider cache request keys or payloads.
- Raw scan, job, provider, filesystem, or application error messages, because
  those may contain paths or metadata.
- Audio content, artwork, fingerprints, secrets, or API keys.

The current report is a point-in-time aggregate, not a crash log. Crash-safe
structured logging remains separate future release-hardening work. A user
should still review any diagnostic file before sharing it.
