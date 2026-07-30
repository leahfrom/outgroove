# Security policy

Outgroove handles local audio libraries, removable storage, provider
credentials, and signed application artifacts. Please report vulnerabilities
privately so they can be investigated before public disclosure.

## Reporting a vulnerability

Use GitHub's
[private vulnerability reporting](https://github.com/leahfrom/outgroove/security/advisories/new).
If that form is unavailable, contact the maintainer using the email address in
the repository's Git commit metadata. Do not open a public issue for an
unpatched vulnerability.

Include the affected Outgroove version and operating system, the security
boundary involved, reproduction steps using generated or redistributable test
data, and the expected impact. Do not attach real music, a catalog database,
credentials, signing material, private paths, or an unredacted diagnostic
export.

You should receive an acknowledgement within seven days. A fix timeline depends
on severity and reproducibility; coordinated disclosure will be discussed with
the reporter. This is a volunteer pre-1.0 project and does not offer a bug
bounty.

## Supported versions

Only the newest published prerelease and the current `develop` branch receive
security fixes. Older prereleases may be used to establish whether a regression
exists, but are not maintained.

## Scope

Particularly relevant reports include:

- an audio write without explicit preview and confirmation;
- source-audio modification during DAP sync;
- path traversal, symlink, junction, or manifest-ownership failures;
- renderer sandbox or narrow-IPC boundary escapes;
- secret exposure in logs, diagnostics, workflows, or packaged artifacts;
- signature, notarization, update, or release-artifact integrity failures; and
- network requests that upload audio or undisclosed local data.

Ordinary correctness bugs without a security impact belong in the public issue
tracker after checking that the report contains no sensitive data.
