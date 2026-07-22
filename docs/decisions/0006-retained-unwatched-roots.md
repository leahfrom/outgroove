# ADR 0006: Retain catalog state for unwatched Library roots

- Status: accepted
- Date: 2026-07-22

## Context

Outgroove must let a user remove a watched Library folder without touching
source audio. Catalog files are rebuildable, but tag snapshots, edit operations,
DAP profiles, and sync manifests are durable user state and currently reference
catalog identities. Physically deleting a root and its files would either break
those references or silently discard history. The scan workflow also requires
catalog purging to remain a separate confirmed maintenance operation.

## Decision

Migration 13 adds a nullable `removed_at` marker to `library_roots`. Removing a
watched root sets that marker, marks its catalog files missing, clears its
rebuildable published directory-problem projection, and rebuilds visible catalog
projections in one transaction. File problems remain with their retained catalog
rows but are hidden while the root is unwatched. The workflow never calls the
filesystem and never deletes catalog, edit, DAP, sync, or scan-job records.

Removal uses a preview bound to the root path and current impact counts. Apply
rejects an invalid or stale confirmation and any active scan. Selecting the same
path later clears `removed_at` on the existing root identity. Its catalog stays
hidden until a scan rediscovers each file; unchanged rediscovered files return to
the visible catalog without unnecessary metadata parsing.

## Consequences

- “Remove” means stop watching and hide the root, not erase history or audio.
- Re-adding a path preserves file, album, edit, and sync identities.
- Old catalog values never become visible merely because a path was re-added;
  discovery must first observe the files.
- Database backups retain unwatched roots and their durable history.
- Permanent catalog purging remains a future, separately previewed maintenance
  workflow with explicit durable-state policy.
