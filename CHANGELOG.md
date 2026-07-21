# Changelog

## 0.3.0 — 2026-07-21

- Stream large-library discovery and metadata results in bounded batches, with
  cancellable filesystem and metadata workers that keep Electron responsive.
- Show discovery and metadata progress, and report unreadable files and folders
  without aborting unrelated work or incorrectly marking files as missing.
- Persist resumable scan-job state and add paginated library browsing and search.
- Add verified SQLite backup and restore operations.
- Expand metadata safety, filesystem conformance, and 100,000-file performance
  coverage.

Earlier prerelease history is available on the private GitHub Releases page.
