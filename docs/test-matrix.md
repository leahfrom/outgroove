# Release verification matrix

The v0.9.0 release candidate was verified locally on macOS arm64 and under an
x86-64 Debian Docker container on Apple Silicon. Native Windows x64 packaging
and smoke verification remain required before the release is tagged or
published.

| Area                                                              | macOS arm64                     | Windows x64                                                                               | Linux x64                                                              |
| ----------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Strict TypeScript / lint / unit + temp integration tests          | v0.9.0 candidate passed locally | v0.9.0 native verification pending; release CI configured                                 | v0.9.0 candidate passed in x86-64 Debian Docker emulation              |
| Forge package                                                     | v0.9.0 ZIP passed locally       | v0.9.0 native packaging pending; release CI configured                                    | v0.9.0 ZIP passed in x86-64 Debian Docker emulation; beta only         |
| Packaged launch + native SQLite worker + sandboxed renderer smoke | v0.9.0 candidate passed locally | v0.9.0 native smoke pending; release CI configured                                        | v0.9.0 candidate passed under Xvfb using the documented CI launch path |
| MP3/FLAC safe replacement on native filesystem                    | Passed on APFS fixture copies   | Passed on CI runner filesystem, including `FileShare.None`; manual packaged check pending | Unverified                                                             |
| Locked manifest-owned sync destination                            | Passed simulated failure test   | Passed real `FileShare.None` CI test; manual packaged check pending                       | Unverified                                                             |
| exFAT safe replacement and copy                                   | Manual probe available; not run | Manual probe available; not run                                                           | Manual probe available; not run                                        |
| Synthetic large-library catalog pipeline                          | 100,000 passed locally          | 5,250-file CI functional profile                                                          | 5,250-file CI functional profile                                       |
| Real DAP / SD card                                                | Not run                         | Not run                                                                                   | Not run                                                                |
| Signed/notarized artifact                                         | Not implemented                 | Not implemented                                                                           | Not applicable                                                         |

No cross-platform support claim should be made from CI alone. The Windows lock
test exercises real NTFS sharing rules but not a packaged UI workflow. macOS
Intel, real exFAT behavior, Linux mounts, and actual DAP playlist behavior
remain manual release checks. The exFAT row changes to passed only after the
controlled procedure in `docs/filesystem-conformance.md` is run on that exact
OS/filesystem combination.
