# Release verification matrix

The v0.13.0 release candidate requires fresh verification on native macOS arm64
and Windows x64, plus an x86-64 Debian Docker container on Apple Silicon.
Results are recorded on the release pull request before the prerelease is
published. The commands, evidence format, manual Windows handoff, Linux
container fallback, asset audit, and Gitflow cleanup are defined in the
[release runbook](release-runbook.md).

Artifact checksums are recorded only after all release documentation is final
and the macOS and Linux packages have been rebuilt from that exact source
state.

| Area                                                              | macOS arm64                                    | Windows x64                                          | Linux x64                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Strict TypeScript / lint / unit + temp integration tests          | v0.13.0 passed: 403 tests, 2 intentional skips | Fresh native v0.13.0 evidence required on release PR | v0.13.0 passed in x86-64 Debian Docker: 403 tests, 2 skips      |
| Forge package                                                     | v0.13.0 passed                                 | Fresh native v0.13.0 evidence required on release PR | v0.13.0 passed in x86-64 Debian Docker; beta only               |
| Packaged launch + native SQLite worker + sandboxed renderer smoke | v0.13.0 passed with an isolated profile        | Fresh native v0.13.0 evidence required on release PR | v0.13.0 passed under Xvfb with the documented CI sandbox bypass |
| MP3/FLAC safe replacement on native filesystem                    | Passed on fresh APFS fixture copies            | Fresh native NTFS evidence required on release PR    | Passed on fresh isolated Docker fixture copies                  |
| Locked manifest-owned sync destination                            | Passed fresh simulated failure test            | Fresh real `FileShare.None` evidence required        | Unverified                                                      |
| exFAT safe replacement and copy                                   | Manual probe available; not run                | Manual probe available; not run                      | Manual probe available; not run                                 |
| Synthetic large-library catalog pipeline                          | 100,000 passed locally                         | 5,250-file CI functional profile                     | 5,250-file CI functional profile                                |
| Real DAP / SD card                                                | Not run                                        | Not run                                              | Not run                                                         |
| Signed/notarized artifact                                         | Not implemented                                | Not implemented                                      | Not applicable                                                  |

No cross-platform support claim should be made from CI alone. The Windows lock
test exercises real NTFS sharing rules but not a packaged UI workflow. macOS
Intel, real exFAT behavior, Linux mounts, and actual DAP playlist behavior
remain manual release checks. The exFAT row changes to passed only after the
controlled procedure in `docs/filesystem-conformance.md` is run on that exact
OS/filesystem combination.
