# ADR 0013: Read-only Cover Art Archive release preview

- Status: accepted
- Date: 2026-07-27

## Context

MusicBrainz release candidates identify a specific edition, while the Cover Art
Archive indexes artwork separately for releases and release groups. Falling
back across those identities could show plausible but incorrect packaging.
Remote artwork is also untrusted content and may remain copyrighted even when
it is publicly accessible.

Library browsing and the existing artwork writer are deliberately local. Making
remote artwork an automatic Library dependency, or wiring it directly into a
write workflow, would broaden both the privacy boundary and the risk of applying
the wrong image.

## Decision

Add one explicit, cancellable, read-only action for each already loaded
MusicBrainz release candidate. It sends only that release UUID to the fixed
Cover Art Archive release endpoint and selects the first image marked as the
front cover. It does not fall back to a release group or another edition.

The privileged provider adapter:

- uses only HTTPS Cover Art Archive and Internet Archive hosts, including
  validated manual redirects;
- sends a meaningful Outgroove user agent;
- bounds metadata to 2 MB, image metadata to 100 entries, and the selected
  thumbnail to 2 MiB;
- prefers the fixed 500-pixel thumbnail and falls back to 250 pixels only when
  the larger fixed endpoint returns 404;
- accepts only locally validated JPEG or PNG data;
- reuses the schema-v19 rebuildable provider cache for raw response metadata
  and missing-art responses, while retaining at most eight thumbnail byte
  payloads in memory;
- retries only the provider's temporary HTTP 503 refusal with bounded backoff;
  and
- returns a locally encoded data URL through one narrow runtime-validated IPC
  method, never a provider URL, file path, or arbitrary fetch primitive.

The UI discloses the request before it starts and labels the result as
read-only evidence for the exact release. The preview cannot propose, confirm,
or start an artwork write. No database migration or durable artwork table is
added.

The integration remains limited to Outgroove's current private,
non-commercial scope. The Cover Art Archive documents that images are publicly
accessible but may still carry third-party rights and are used at the user's
own risk. Any commercial distribution or reuse workflow needs a fresh legal and
product review.

References:

- <https://musicbrainz.org/doc/Cover_Art_Archive/API>
- <https://musicbrainz.org/doc/Cover_Art_Archive>

## Consequences

- Exact-edition evidence is available without making Library browsing depend on
  the network.
- A provider response cannot write, replace, export, or persist artwork.
- No audio, existing artwork, tags, file paths, fingerprints, or provider query
  text leave the machine.
- Thumbnail bytes disappear when the app exits; raw metadata remains
  rebuildable cache data.
- Back covers, booklets, alternate images, release-group fallback, remote
  artwork replacement, and rights automation remain out of scope.
