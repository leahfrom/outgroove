# Release verification matrix

The v0.17.1 release candidate requires fresh verification on native macOS
arm64, Windows x64, and Linux x64 GitHub-hosted runners. Local macOS evidence
and GitHub Actions results are recorded on the release pull request before the
prerelease is published. The commands, evidence format, manual Windows
handoff, Linux container fallback, asset audit, and Gitflow cleanup are defined
in the [release runbook](release-runbook.md).

On 2026-07-30, the release branch passed the complete local baseline on macOS
26.5.2 arm64: formatting, lint, type checking, version synchronization, 594
tests with 3 intentional skips, Forge packaging, and the isolated packaged
smoke test. Packaged visual inspection used only the disposable fixture
profile and target; the minimum-width layout, long target path, inspection
banner, diagnostic-export accessible name, and keyboard reachability passed.

Artifact checksums are recorded only after all release documentation is final
and the macOS and Linux packages have been rebuilt from that exact source
state.

Routine pull-request CI also runs the complete verification suite, real NTFS
exclusive-lock tests, native persistent-volume lookup, Forge packaging, and an
isolated packaged smoke test on Windows x64. This is a required regression
gate, but it does not replace the fresh release-candidate evidence or the
manual removable-storage matrix below.

| Area                                                              | macOS arm64                                           | Windows x64                                     | Linux x64                                 |
| ----------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| Strict TypeScript / lint / unit + temp integration tests          | Fresh local and release CI evidence required          | Fresh native release CI evidence required       | Fresh native release CI evidence required |
| Forge package                                                     | Fresh local and release CI evidence required          | Fresh native release CI evidence required       | Fresh native release CI evidence required |
| Packaged launch + native SQLite worker + sandboxed renderer smoke | Fresh local and release CI evidence required          | Fresh native release CI evidence required       | Fresh native release CI evidence required |
| MP3/FLAC safe replacement on native filesystem                    | Covered on disposable APFS fixture copies             | Covered on disposable NTFS fixture copies in CI | Covered on disposable CI fixture copies   |
| Locked manifest-owned sync destination                            | Covered by simulated failure and recovery tests       | Covered by native `FileShare.None` CI evidence  | Covered by simulated failure tests        |
| exFAT safe replacement and copy                                   | Manual probe available; not run                       | Manual probe available; not run                 | Manual probe available; not run           |
| Synthetic large-library catalog pipeline                          | 100,000-file local profile available                  | 5,250-file CI functional profile                | 5,250-file CI functional profile          |
| Real DAP / SD card                                                | Not run                                               | Not run                                         | Not run                                   |
| Signed/notarized artifact                                         | Required from credentialed release CI and asset audit | Windows remains unsigned                        | Not applicable                            |

No cross-platform support claim should be made from CI alone. The Windows
runner exercises real NTFS sharing rules, persistent identity, packaging, and
an automated packaged launch, but not a manual installed application workflow
or removable target. Physical exFAT media and a real DAP are unavailable for
v0.17.1 and are explicitly unverified rather than simulated or waived as
passed. macOS Intel, Linux desktop/mount behavior, and actual DAP playlist
behavior also remain manual release checks. The exFAT row changes to passed
only after the controlled procedure in
`docs/filesystem-conformance.md` is run on that exact OS/filesystem
combination.
