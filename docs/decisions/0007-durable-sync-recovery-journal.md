# ADR 0007: Durable write-ahead journal for DAP sync recovery

## Status

Accepted.

## Context

A cooperative cancellation can roll back an active sync while the process is
alive, but it cannot explain which target files were installed if Outgroove,
the operating system, or the target disappears between filesystem operations.
Inferring ownership from filenames after restart would risk deleting an
unknown user file, while treating every partial copy as unknown would make the
confirmed sync impossible to recover or retry.

## Decision

Schema v17 adds durable `sync_runs` and `sync_run_changes` tables. Before each
temporary copy, replacement, playlist write, or manifest write, Outgroove
records the target-relative destination, internal temporary path, optional
rollback path, and expected SHA-256. The target manifest remains the last
user-visible commit. Manifest history and the journal's committed-cleanup state
change in one SQLite transaction.

On database reopen, an applying journal becomes recovery-required. The
sandboxed renderer receives a database-only summary at startup. Explicitly
opening that summary requests a read-only, runtime-validated target inspection
and recovery preview. Recovery requires separate confirmation and re-checks
containment, existence, symlinks, and hashes. It removes only exact journaled
Outgroove output, restores an earlier file only from its journaled rollback
path, and leaves a destination with unexpected contents untouched. A
disconnected target remains pending.

If the target manifest and SQLite history committed before interruption,
recovery removes only journaled internal temporary/rollback files; it never
rolls back the successful sync.

## Consequences

- Recovery state is durable across application restart and database backup.
- A profile cannot start another apply until its recovery is resolved.
- The journal is privileged SQLite state; target paths are still revalidated
  before every recovery operation and are never constructed by the renderer.
- Recovery is rollback-and-retry, not byte-offset copy resumption.
- Sudden storage failure can still leave a journaled internal file that cannot
  be cleaned until the same target is writable again.
