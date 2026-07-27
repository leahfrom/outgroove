# ADR 0013: Cover Art Archive release preview and explicit replacement handoff

- Status: accepted
- Date: 2026-07-27

## Context

MusicBrainz release candidates identify a specific edition, while the Cover Art
Archive indexes artwork separately for releases and release groups. Falling
back across those identities could show plausible but incorrect packaging.
Remote artwork is also untrusted content and may remain copyrighted even when
it is publicly accessible.

Library browsing and the existing artwork writer are deliberately local. Making
remote artwork an automatic Library dependency, or letting a provider response
write directly, would broaden both the privacy boundary and the risk of applying
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

The UI discloses the request before it starts and labels the thumbnail as
read-only evidence for the exact release. It cannot itself propose, confirm, or
start an artwork write.

A second explicit action may prepare the displayed front cover for the existing
artwork replacement workflow. Its narrow IPC request contains only the catalog
album UUID, exact MusicBrainz release UUID, and numeric artwork ID. Main
re-resolves the release metadata and refuses the action if the selected front
artwork identity changed. It reconstructs the fixed original-image endpoint
from those validated identities, bounds the response to 8 MiB, validates JPEG
or PNG structure and dimensions, and passes the bytes directly to the existing
artwork preview service. A provider URL, byte payload, or local path is never
accepted from or exposed to the renderer.

The resulting confirmation shows the full proposed original and exact per-file
effects. Apply still requires the existing confirmation token and retains the
same snapshot, stale-artwork refusal, same-folder temporary replacement,
re-read, complete-picture verification, audio-payload verification,
partial-failure handling, and verified undo. The provider response cannot call
apply. No database migration or durable artwork table is added.

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
- A provider response cannot write, export, or persist artwork automatically;
  it can only populate a bounded pending preview after a second explicit action.
- No audio, existing artwork, tags, file paths, fingerprints, or provider query
  text leave the machine.
- Thumbnail bytes and pending original bytes disappear when the app exits; raw
  metadata remains rebuildable cache data.
- Back covers, booklets, alternate images, release-group fallback, remote
  artwork export, and rights automation remain out of scope.
