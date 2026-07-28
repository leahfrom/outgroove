# ADR 0016: Distribute macOS releases through the notarized DMG only

## Status

Accepted

## Context

ADR 0015 introduced a signed, notarized, and stapled DMG as the primary macOS
artifact while retaining a ZIP as a secondary archive. The implemented release
pipeline notarizes and staples the final DMG because it is the outermost
distributed container. A separately published ZIP is a different outermost
download and does not inherit the DMG's stapled ticket or verification
evidence.

Maintaining two macOS downloads would therefore require two complete
distribution and verification paths. The ZIP adds no required installation
workflow: the DMG already provides the familiar drag-to-Applications layout
and can be verified offline through its stapled ticket.

## Decision

- Publish one macOS artifact: the signed, notarized, and stapled arm64 DMG.
- Keep the cross-platform ZIP maker only for the Windows portable download and
  Linux beta download.
- Keep historical release assets unchanged. This decision applies to new
  releases and does not remove earlier macOS ZIPs.
- Do not restore a macOS ZIP unless it receives its own explicit exact-artifact
  notarization, verification, release-documentation, and manual-test design.

## Consequences

New releases contain five assets: the macOS DMG, Windows ZIP, Windows Setup
application, Linux ZIP, and checksum manifest. Users have one supported macOS
installation path, and the asset whose signature, notarization ticket,
Gatekeeper assessment, checksum, and manual installation were verified is the
same artifact they download.

Historical releases remain reproducible as historical source states, but their
existing assets are neither deleted nor retroactively changed.
