# ADR 0002: Staged database restore with automatic rollback

## Status

Accepted for the first local catalog slice.

## Context

SQLite backup can safely snapshot a live connection, but replacing the active
database while application services retain that connection is unsafe. A chosen
backup may also be corrupt, from an incompatible future schema, or contain an
older schema that requires migration. SQLite WAL/SHM sidecars must not be left
beside a replacement database.

## Decision

Outgroove copies a selected backup to a same-volume staging path, checks the
source integrity and supported schema range, migrates only the staged copy, and
shows summary counts before confirmation. Apply is refused while a scan is
active. On confirmation Outgroove creates and verifies an automatic backup of
the current database, closes the live connection, moves the database and any
sidecars aside, installs and reopens the staged copy, checks integrity again,
then restarts. Any replacement failure moves the original files back before the
restart.

The renderer receives fixed backup/preview/apply methods and confirmation DTOs;
it never receives filesystem capabilities or supplies a path.

## Consequences

Restore intentionally restarts the application. Automatic pre-restore backups
remain in Outgroove's user-data directory for manual recovery and are not yet
aged out. Power-loss and real exFAT behavior still require manual platform
testing; the implementation does not claim stronger atomicity than the host
filesystem provides.
