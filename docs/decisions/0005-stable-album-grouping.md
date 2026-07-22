# ADR 0005: Merge-only album grouping aliases

- Status: accepted
- Date: 2026-07-22

## Context

The initial catalog grouped albums by normalized album artist and album title.
That kept identically titled releases by different artists separate, but it
also split tracks from one folder when their album-artist tags disagreed. The
split made the Workbench's inconsistent-album-artist diagnostic impossible to
observe from a real scanned catalog. Replacing the grouping key with a folder
key would split existing multi-folder and multi-disc albums and could silently
change the meaning of durable edit history and DAP sync profiles.

## Decision

Keep normalized album artist plus title as the primary grouping identity. Add
an append-only alias table for every grouping key and a secondary rule: tracks
with the same normalized album title and exact comparison-key parent folder
belong to the same catalog album even when album-artist tags differ.

Migration 12 reconciles existing catalog groups with a merge-only operation.
It never splits an album and never guesses across folders. When two groups are
merged, the lexically first existing album ID remains canonical; tracks, edit
operations, DAP profiles, grouping aliases, and rebuildable search projections
are repointed in one transaction. A pending marker makes reconciliation
restartable if opening the upgraded database is interrupted.

Verified metadata edits retain the track's established album ID. This lets a
partial album-artist edit remain visible as an inconsistency until the user
finishes or undoes it, rather than making the edited track disappear into a
new album group.

## Consequences

- Mixed album-artist tags in one folder are now visible to deterministic local
  diagnostics and the existing preview-only batch workflow.
- Existing albums may merge during v11-to-v12 migration, but never split.
  Durable references follow the canonical album transactionally.
- Albums with inconsistent album artists across different folders remain
  separate unless the original artist/title rule already grouped them.
- Folder comparison uses the stored privileged-layer path comparison key; the
  renderer and shared domain gain no filesystem access.
- A future first-class release identity (for example, a confirmed MusicBrainz
  release ID) can supersede these local heuristics without discarding aliases.
