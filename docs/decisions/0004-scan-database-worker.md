# ADR 0004: Scan-scoped SQLite access runs in a worker

- Status: Accepted
- Date: 2026-07-21

## Context

The Phase 1 catalog now streams filesystem discovery and metadata parsing from
bounded workers, but each discovered file still caused a synchronous
`better-sqlite3` lookup in Electron main. Staging discovery state and committing
metadata batches also ran synchronous transactions there. The 100,000-file
profile therefore proved bounded memory and incremental behavior without
proving the PLAN invariant that a large scan cannot stall Electron main.

PLAN originally described SQLite as a main-process adapter. It also requires
CPU-heavy and high-volume work to stay out of the main event loop and explicitly
allows worker threads or utility processes for scans. At current catalog sizes,
the synchronous native binding makes those statements incompatible if all scan
transactions remain on Electron main.

## Decision

Keep the `CatalogDatabase` adapter and SQLite file as the single source of
truth, but run scan-specific classification, temporary staging tables, and
catalog write batches through one serialized worker connection shared by
active scans. The connection closes after the final scan finishes or abandons
its temporary state. Electron main
continues to own library queries, job state, backup/restore coordination, IPC,
and application lifecycle.

The worker receives only explicit typed scan commands. It does not expose SQL,
paths, or a generic invoke surface to the renderer. Discovery and metadata
results remain bounded to 250-item write transactions. WAL mode permits main's
read connection and the scan writer to coexist. Opening the scan connection
must not mark main's active persisted job as interrupted.

Cancellation waits only for the current bounded transaction, then abandons the
temporary scan state. A worker crash closes its connection and therefore drops
its temporary staging tables; it is surfaced as a failed scan and must never
trigger missing-file finalization.

## Consequences

- Large scan database work no longer executes synchronously on Electron main.
- The packaged build must include and exercise a worker that loads the native
  SQLite binding on every platform.
- Backup restore remains forbidden while a scan is active, so replacing the
  database cannot race the worker connection.
- General catalog queries stay synchronous in main for now; they are paginated
  and are not part of this high-volume write path. A later measured bottleneck
  can justify moving the entire repository behind an asynchronous owner.
