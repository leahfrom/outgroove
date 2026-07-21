# First-slice verification matrix

| Area                                                     | macOS arm64                     | Windows x64                                                                               | Linux x64                            |
| -------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------ |
| Strict TypeScript / lint / unit + temp integration tests | Passed locally                  | CI configured                                                                             | CI configured                        |
| Forge package                                            | Passed locally                  | CI configured, not manually verified                                                      | CI configured, beta only             |
| Packaged launch + SQLite + sandboxed renderer smoke      | Passed locally                  | CI configured, not manually verified                                                      | CI configured, not manually verified |
| MP3/FLAC safe replacement on native filesystem           | Passed on APFS fixture copies   | Passed on CI runner filesystem, including `FileShare.None`; manual packaged check pending | Unverified                           |
| Locked manifest-owned sync destination                   | Passed simulated failure test   | Passed real `FileShare.None` CI test; manual packaged check pending                       | Unverified                           |
| exFAT safe replacement and copy                          | Manual probe available; not run | Manual probe available; not run                                                           | Manual probe available; not run      |
| Synthetic large-library catalog pipeline                 | 100,000 passed locally          | 5,250-file CI functional profile                                                          | 5,250-file CI functional profile     |
| Real DAP / SD card                                       | Not run                         | Not run                                                                                   | Not run                              |
| Signed/notarized artifact                                | Not implemented                 | Not implemented                                                                           | Not applicable                       |

No cross-platform support claim should be made from CI alone. The Windows lock
test exercises real NTFS sharing rules but not a packaged UI workflow. macOS
Intel, real exFAT behavior, Linux mounts, and actual DAP playlist behavior
remain manual release checks. The exFAT row changes to passed only after the
controlled procedure in `docs/filesystem-conformance.md` is run on that exact
OS/filesystem combination.
