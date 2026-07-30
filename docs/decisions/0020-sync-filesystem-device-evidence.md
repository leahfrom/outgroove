# ADR 0020: Persist filesystem-device evidence and confirm ambiguity

## Status

Accepted.

## Context

A selected folder path and matching Outgroove manifest prove where a profile
was configured and which exact files Outgroove owns. They do not prove that a
removable volume mounted at that path is the same physical device. The existing
per-plan directory `dev:ino` snapshot detected substitution between preview and
apply, but was not retained across runs.

Node exposes a filesystem device identifier on supported targets without
requiring shell commands, new renderer privileges, or platform-specific output
parsing. That identifier is useful evidence within the operating system, but it
is not a universally stable physical-volume UUID and can be unavailable or
change after a remount.

## Decision

Schema v25 stores the filesystem-device identifier available when a DAP profile
target is selected. Planning and interrupted-run recovery compare it with fresh
target evidence. An exact match proceeds through the existing plan
confirmation. Missing, unavailable, or changed evidence is displayed as
uncertain and requires a separate per-plan or per-recovery acknowledgement.

The acknowledgement is a boolean attached to the opaque reviewed plan or
recovery request. The renderer cannot submit a target path, identity, or file
list. Acknowledgement is not persisted and does not rewrite the profile's
recorded evidence. Explicit retargeting captures new evidence only after its
existing preview and confirmation, and the selected root is re-inspected before
the profile changes.

The current root `dev:ino` snapshot remains in each deterministic plan and is
revalidated immediately before apply. Manifest equality, ownership, hashes,
containment, and symlink checks remain independent requirements.

## Consequences

- A mount path alone no longer establishes target trust for Sync apply or
  recovery.
- Legacy profiles receive `NULL` evidence; migration never invents authority.
- A matching manifest proves Outgroove ownership but does not silently resolve
  uncertain volume identity.
- Filesystem-device evidence may change across remounts, so a legitimate target
  can require explicit confirmation again.
- Stable physical-volume UUID discovery remains future platform-adapter work.
