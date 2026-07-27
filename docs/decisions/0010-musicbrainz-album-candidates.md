# ADR 0010: Read-only MusicBrainz album candidates

- Status: accepted
- Date: 2026-07-27

## Context

Outgroove already preserves distinct MusicBrainz identifiers but does not look
them up. The first provider slice must help a person identify an album without
turning a search result into a tag change, weakening offline Library behavior,
or exposing paths and audio through the renderer.

MusicBrainz distinguishes a release (one particular edition) from a release
group (the conceptual album). Its public web service requires a meaningful
versioned/contact User-Agent and limits clients, by default, to an average of
one request per second per IP. It returns 503 when throttling. The public web
service is free for non-commercial use; commercial use requires an agreement.
Core database data is CC0, while supplementary data has different terms.

References:

- <https://musicbrainz.org/doc/MusicBrainz_API>
- <https://musicbrainz.org/doc/MusicBrainz_API/Search>
- <https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting>
- <https://musicbrainz.org/doc/About/Data_License>

## Decision

Add one explicit album action that searches MusicBrainz release editions. The
modal opens without network activity and displays the exact disclosure first.
The renderer submits only a catalog album UUID. Main resolves the current
catalog album and sends only its title and album artist to a fixed MusicBrainz
release-search endpoint. It never sends paths, audio, artwork, native tags,
fingerprints, or renderer-provided queries.

Keep the first workflow read-only. Main runtime-validates the response and maps
only bounded release evidence. A pure shared-domain comparator scores title,
album artist, track count, partial date, and consistent catalog number. It
shows evidence and conflicts and does not treat the provider search score as an
Outgroove match decision. There is no accept, metadata proposal, or write path.

Use one application-wide provider client with:

- a meaningful `Outgroove/<version>` User-Agent and project contact URL;
- request starts spaced at least one second apart;
- identical in-flight request deduplication and explicit cancellation;
- at most three attempts for 429/503 with exponential backoff and jitter;
- a 24-hour successful-response cache and an honest stale-cache fallback.

Schema v19 adds `provider_cache`, keyed by provider and canonical request key,
with response-schema version, status, timestamps, and raw JSON. This is
rebuildable provider data, not a durable match decision. Invalid or transient
responses are not cached.

Enable this public endpoint only for Outgroove's current private,
non-commercial distribution. Before commercial distribution, obtain an
appropriate MusicBrainz service agreement or disable/replace this adapter.

## Consequences

- Local scan, browse, diagnostics, editing, and Sync remain network-independent.
- The renderer gains two narrow album-ID-only IPC methods and no network,
  filesystem, provider, or generic invocation capability.
- Cached responses are included in database backups but can be safely rebuilt.
- Search cancellation is cooperative around an HTTP request or rate-limit
  wait; it never interacts with audio or DAP targets.
- Matching remains assistive and explainable. A later candidate-acceptance
  slice must add its own explicit choice, stale checks, metadata proposal,
  preview, confirmation, safe write, re-read, verification, and undo.
- Cover Art Archive, AcoustID, fingerprints, automatic matching, and tag
  proposals remain out of scope.
