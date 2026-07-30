# ADR 0021: Prefer hashed persistent target-volume identity

## Status

Accepted.

## Context

Schema v25 introduced nullable filesystem-device evidence and a separate
per-operation acknowledgement when evidence is missing or changed. A filesystem
device number is useful during one mount but is not a persistent physical-volume
identifier and can change or be reused after remounting.

macOS exposes a persistent volume UUID through `diskutil`. Windows exposes a
volume `UniqueId` through the Storage module's `Get-Volume -FilePath` command.
Node does not expose either value through its filesystem APIs.

## Decision

The privileged target-filesystem adapter may run only these two fixed native
queries:

- `/usr/sbin/diskutil info -plist <resolved volume root>` on macOS;
- the system Windows PowerShell executable with a fixed `Get-Volume` command,
  passing the selected target through a dedicated environment variable.

The adapter never invokes a shell, accepts an executable or command from the
renderer, or returns command output across IPC. Calls have a five-second
timeout and a 64 KiB output limit. UUID/UniqueId output is validated, hashed
with SHA-256, and only the platform-scoped digest is persisted.

Helper failure, malformed output, unsupported platforms, and volumes without a
persistent identifier return no identity. Planning and recovery then retain the
existing explicit per-operation volume acknowledgement. Filesystem `dev:ino`
continues to bind a preview to its selected root but no longer counts as
persistent evidence.

Existing profiles are never silently rebound. Re-selecting the same target can
produce a normal user-visible target preview when stronger evidence is
available; its saved identity changes only after the existing separate
confirmation and a second root/evidence inspection.

## Consequences

- Matching persistent evidence can survive ordinary remount/path changes more
  reliably than filesystem device numbers.
- Raw native identifiers and selected paths remain outside renderer requests
  and responses.
- Linux and unsupported volumes require acknowledgement for every plan or
  recovery.
- Legacy schema-v25 filesystem-device evidence remains stored until the user
  explicitly refreshes or changes the target and does not silently grant
  persistent trust.
- Native helper availability and behavior must be covered by platform
  packaging/manual checks; a failure safely degrades to ambiguity.
