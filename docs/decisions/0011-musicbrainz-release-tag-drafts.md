# ADR 0011: Explicit MusicBrainz release tag drafts

- Status: accepted
- Date: 2026-07-27

## Context

ADR 0010 intentionally stopped at read-only MusicBrainz release candidates.
Outgroove can now show bounded release evidence and local confidence, but a
person must still copy supported values manually into the tag editors. The
next slice must connect an explicitly chosen release to safe editing without
turning provider confidence into acceptance or creating a second metadata
write path.

MusicBrainz release results can contain ordered artist credits, multiple label
catalog numbers, aggregate media track counts, and both release and
release-group identities. Outgroove's current writer can safely propose only
one catalog number and one release-artist ID. Album-title editing is a separate
operation with its own preview and history.

## Decision

An explicit candidate action creates a local tag draft and does not preview or
write it. Preserve ordered artist credits as structured name, join phrase, and
artist-ID facts; format the credit only when proposing the existing Album
artist text field.

Draft only values that the current writer can represent and restore:

- formatted Album artist;
- a valid partial Release date;
- one unambiguous Catalog number;
- MusicBrainz release and release-group IDs;
- one unambiguous MusicBrainz release-artist ID.

Omit a catalog number or release-artist ID when either the candidate or a
selected track has multiple values. Never infer Track total, Disc total,
Compilation, or any track-specific identity from release-search evidence.
Album title remains in its separate album-title workflow.

Reuse the established tag-edit pipelines. A one-track album opens the
single-track comparison; an album with multiple tracks selects every track and
opens Shared fields with only effective candidate fields enabled. Both routes
still require:

select → propose → validate → preview → confirm → snapshot → write → re-read →
verify

Existing per-file stale checks, format warnings, partial failure, history, and
verified undo remain authoritative. No new IPC method, preload capability,
database table, migration, or renderer privilege is added.

## Consequences

- MusicBrainz confidence remains explanation only; weak candidates can never
  apply automatically.
- A candidate choice is reversible renderer draft state until the normal
  confirmation sequence completes.
- No-op values are excluded before the editor opens, and unsupported or
  ambiguous values are disclosed beside the candidate.
- The accepted release identity becomes durable only if the user confirms the
  corresponding MusicBrainz ID tag writes.
- Track-level MusicBrainz mapping, album-title coordination, cover art,
  fingerprints, automatic acceptance, and durable provider match decisions
  remain out of scope.
