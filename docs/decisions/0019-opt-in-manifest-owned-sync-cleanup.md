# ADR 0019: Per-plan manifest-owned DAP cleanup through quarantine

## Status

Accepted.

## Context

Outgroove previously retained files that became obsolete after a DAP profile
selection changed. Removing them safely requires both fresh user intent and
durable evidence that the exact target path is Outgroove-owned. Direct unlink
would make interruption before the new manifest commits difficult to explain
or reverse.

## Decision

Cleanup is an explicit option on one sync-plan request. It is off by default
and is never stored in the DAP profile or inferred from an earlier run. A plan
may propose only obsolete paths in the latest database manifest for the exact
profile and selected target, and only while the on-target manifest agrees with
that ownership record.

Planning separates new copies, owned replacements, unchanged skips, removals,
and already-absent owned paths. It hashes every existing owned target involved
in the plan. Apply first revalidates the profile target, target-root identity,
database and target manifests, source signatures, target hashes, absent paths,
and symlink-free containment. A no-op plan cannot be applied.

Each confirmed removal is renamed to a unique same-directory quarantine path
after a schema-v24 recovery-journal entry is durable. Before manifest commit,
cancellation or failure restores that quarantine. After the target manifest
and SQLite manifest history commit, cleanup removes only the recorded
quarantine. Restart recovery shows and separately confirms the same restore or
cleanup action. Directories are left in place.

## Consequences

- Unknown, unmanifested, changed, or symlink-substituted target files are never
  deleted.
- Quarantine is reversible before commit but does not free capacity for copies;
  capacity validation therefore does not subtract planned removals.
- The renderer can request only a boolean cleanup option and later apply an
  opaque reviewed plan; it cannot submit deletion paths.
- Removing a DAP profile still forgets ownership without touching its target,
  so re-adding that folder cannot regain cleanup authority.
- Target-root device/inode identity catches substitutions during one preview
  and apply cycle. Stronger persistent physical-volume identity remains
  deferred.
