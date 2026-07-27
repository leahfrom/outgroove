# ADR 0012: Explicit MusicBrainz track mapping

- Status: accepted
- Date: 2026-07-27

## Context

ADR 0011 deliberately excludes track-specific data from release-search tag
drafts because a release result does not establish which local file represents
which MusicBrainz release track. Automatically aligning by position, title, or
duration could silently attach the wrong identities or numbering.

MusicBrainz models a release track separately from its recording and groups
tracks by ordered media. The existing Outgroove batch editor already provides
per-file preview, confirmation, snapshot, stale checks, safe writes, re-read
verification, partial failure, history, and verified undo.

## Decision

Add a separate, explicit action that looks up one selected release by its UUID.
The fixed provider request asks for recordings, artist credits, and ISRCs and
sends no local file path, tag value, artwork, fingerprint, or audio. Search and
release lookup share the same global one-request-per-second limiter, bounded
retry behavior, response validation, cache, and cancellation.

The renderer initially maps no tracks and enables no fields. A person selects
each one-to-one local/release-track relationship and then opts into:

- track title;
- ordered track artist credit;
- track number, track total, disc number, and disc total as one group;
- one unambiguous ISRC;
- recording ID, release-track ID, and one unambiguous track-artist ID.

Do not auto-align or auto-select fields. Omit multi-value ISRCs and artist IDs
when the current writer cannot make and restore a lossless single-value
proposal. Display the omission.

Use a narrow runtime-validated lookup IPC method and mapped-preview IPC method.
The preview request carries only catalog IDs, provider IDs, and the exact
values already displayed to the user. Reuse the existing batch apply and undo
methods. Store per-file proposals as the existing array-shaped batch payload;
legacy shared-field object payloads remain readable. Keep the existing
`track-tags-batch-edit` operation kind and distinguish mapping history by its
descriptive title. No durable provider decision, table, or migration is added.

The safety sequence remains:

select → propose → validate → preview → confirm → snapshot → write → re-read →
verify

## Consequences

- A provider response can never establish or write a local mapping by itself.
- Track/disc totals cannot silently change their corresponding number; the
  numbering group proposes all four values explicitly.
- One album-level confirmation can safely cover distinct per-file proposals.
- Stale or failed files remain independent and successful writes retain verified
  undo.
- Mapping choices are renderer draft state and are not durable after closing
  the workflow.
- Automatic matching, durable manual mapping decisions, acoustic fingerprints,
  cover art lookup, and multi-value writes remain out of scope.
