# ADR 0018: Public GPL project

## Status

Accepted

## Context

Outgroove began as a private local project. Its releases, provider integrations,
native packaging, and safety model are now developed enough to benefit from
public source review and outside contributions. Making a GitHub repository
public exposes its complete reachable history, pull requests, Actions logs, and
release metadata, and public forks cannot later be recalled.

The application incorporates permissively licensed JavaScript dependencies and
separately replaceable LGPL WebAssembly and executable components documented in
`THIRD_PARTY_NOTICES.md`. MusicBrainz and AcoustID public endpoints are approved
only for the project's current non-commercial distribution.

## Decision

Outgroove's original source code is licensed under GPL-3.0-or-later. Existing
third-party material retains its own license and notices. Contributions are
accepted under GPL-3.0-or-later and must have redistributable provenance.

The npm package remains marked `"private": true`; this prevents accidental npm
publication and does not describe the GitHub repository's visibility or source
license.

Repository visibility is an operational change performed only after a final
history, secret, workflow, release, and settings audit. Public fork pull
requests use the ordinary read-only `pull_request` workflow and never receive
release secrets. Tagged release jobs remain the only workflows that use
notarization, signing, or provider credentials.

Commercial distribution is outside this decision. It requires a fresh provider
terms review and any necessary agreement or replacement before a commercial
build can use the public MusicBrainz or AcoustID endpoints.

## Consequences

- Anyone may inspect, copy, modify, and redistribute Outgroove under the GPL.
- Public repository history, existing releases, pull-request metadata, and
  Actions logs become visible; maintainers must treat accidental disclosure as
  a security incident.
- LGPL components remain separately replaceable and their source/build
  references and license notices must continue to ship.
- Branch protection, private vulnerability reporting, secret scanning, and
  related repository safeguards must be enabled or rechecked after the
  visibility change.
- Documentation must distinguish public source availability, prerelease support
  status, and the separate non-commercial provider constraint.
