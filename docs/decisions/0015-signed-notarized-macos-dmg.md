# ADR 0015: Sign and notarize the outermost macOS DMG

## Status

Accepted

## Context

ADR 0014 established the stable `de.leahfrom.outgroove` bundle identifier and
kept local macOS packaging unsigned until Developer ID credentials were
available. A portable ZIP does not provide the familiar drag-to-Applications
installation experience, and the ZIP container itself cannot be signed.

Apple's direct-distribution guidance requires nested code and containers to be
signed inside-out. When nested containers are used, Apple recommends
notarizing only the outermost distributed container and stapling the ticket to
that container. Notarizing the application before placing it in an unsigned
DMG would leave the actual download container outside that verification
boundary.

GitHub-hosted runners are ephemeral and must not receive long-lived secrets
through repository files, command arguments, logs, or artifacts. The known
Actions spending restriction can also prevent jobs from starting, so local
exact-tag signing must remain a documented release fallback without being
described as successful CI.

## Decision

- Add an Electron Forge DMG maker for macOS while retaining the macOS ZIP.
  Use a read-only UDZO image with the default application and Applications
  alias layout.
- Keep unsigned local packaging available and offline. Enable signing only
  through `OUTGROOVE_MAC_SIGNING=1` plus one explicit Developer ID Application
  identity.
- Sign the application during packaging and the completed DMG during making.
  Do not use a Developer ID Installer identity because Outgroove is not
  producing a `.pkg`. Give the container its own
  `de.leahfrom.outgroove.dmg` signing identifier and require a secure
  timestamp.
- Notarize and staple only final Darwin DMG artifacts in Forge's `postMake`
  hook. Accept either one local `notarytool` keychain profile or one complete
  App Store Connect Team API-key set. Reject partial, conflicting, or unsigned
  notarization configuration.
- Require tagged GitHub macOS builds to import the `.p12` certificate into a
  temporary keychain and the `.p8` API key into `RUNNER_TEMP`. Remove the
  keychain and files in an unconditional cleanup step.
- Before upload, independently verify DMG and mounted-app signatures, the
  stapled ticket, Gatekeeper assessments, and the disk image structure.
- Treat the signed/notarized DMG as the primary macOS download. Retain the ZIP
  as a secondary archive whose contained application is signed, while being
  explicit that ZIP containers themselves cannot be signed or stapled.

## Consequences

A successful tagged macOS job produces two artifacts: a signed and notarized
DMG and a ZIP containing the signed application. The DMG has the stronger
offline Gatekeeper story because its notarization ticket is stapled directly
to the distributed container.

Release publication now depends on five repository Actions secrets. Missing or
invalid credentials fail the macOS job; the workflow cannot silently publish
an unsigned substitute. Certificate rotation requires replacing the `.p12`
secret, while API-key rotation requires replacing the `.p8`, key ID, and issuer
secrets.

The first real signed build still requires manual testing on macOS, including
installation from the DMG and native Radar notification delivery. GitHub
Actions remains unverified until a runner actually starts past the current
budget restriction.
