# ADR 0014: Gate Radar notifications on packaged application identity

## Status

Accepted

## Context

Radar can refresh favorite artists automatically while Outgroove is open. A
native notification is useful only when it is reliable, does not turn a first
discography baseline into a flood of alerts, and does not disclose local music
interests on a lock screen without explicit consent.

The existing release artifacts were unsigned portable ZIPs. macOS notification
delivery requires a signed application. Windows toast activation relies on an
installed Start Menu shortcut and stable AppUserModelID; a portable ZIP cannot
provide that identity reliably. Linux desktop notification support varies and
remains beta.

Adding a Windows installer and stable application identifiers changes release
packaging. Persisting the independent notification preference requires durable
state, so this is also a schema decision.

## Decision

- Use `de.leahfrom.outgroove` as the stable macOS bundle identifier.
- Retain portable ZIPs and additionally produce a Squirrel Windows Setup
  application. Use Squirrel's required
  `com.squirrel.Outgroove.Outgroove` AppUserModelID and early startup handling.
- Keep unsigned macOS packaging as the local default. Enable Forge signing only
  with `OUTGROOVE_MAC_SIGNING=1`, and enable notarization only with an explicit
  `OUTGROOVE_MAC_NOTARY_KEYCHAIN_PROFILE`. Commit no credentials.
- Evaluate notification availability in a privileged, platform-specific
  adapter. Development builds, unsigned macOS packages, unsupported desktops,
  and portable Windows packages report a precise unavailable reason. Main
  rejects attempts to persist an enabled preference when capability is absent.
- Add schema migration 23 with one default-off
  `radar_background_settings.notifications_enabled` flag. Existing scheduling
  state survives and all migrated users remain opted out.
- Notify only after a fully successful automatic sweep. Sum only additions for
  artists that had a successful baseline before the sweep. Manual, first
  baseline, partial, failed, cancelled, busy, offline, battery-paused, and
  zero-addition checks never notify.
- Put aggregate counts only in the native notification. Do not include artist
  names, release titles, paths, tags, provider payloads, or audio-derived data.
- Route notification clicks through one fixed payload-free main-to-renderer
  event. It focuses the existing window and opens the local unseen Radar view.
  The renderer receives no URL, path, provider response, or arbitrary channel.
- Treat a notification display failure as local to notification delivery. It
  must not roll back a committed Radar snapshot or change a successful provider
  sweep into a retry.

## Consequences

Windows releases now have two user choices: the portable ZIP and the Setup
application. Native Radar notifications are available only from the installed
choice. Release checksums and the manual Windows handoff must cover both.

Current unsigned macOS prereleases honestly show notifications as unavailable.
A future signed/notarized release can enable them without changing application
logic, but the signing identity, notarization, and real delivery still require
platform verification.

Linux can advertise the preference only when Electron reports notification
support. Delivery remains dependent on the desktop notification service and is
reported as beta rather than inferred from compilation.
