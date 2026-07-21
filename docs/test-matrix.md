# First-slice verification matrix

| Area                                                     | macOS arm64                   | Windows x64                          | Linux x64                            |
| -------------------------------------------------------- | ----------------------------- | ------------------------------------ | ------------------------------------ |
| Strict TypeScript / lint / unit + temp integration tests | Passed locally                | CI configured                        | CI configured                        |
| Forge package                                            | Passed locally                | CI configured, not manually verified | CI configured, beta only             |
| Packaged launch + SQLite + sandboxed renderer smoke      | Passed locally                | CI configured, not manually verified | CI configured, not manually verified |
| MP3/FLAC safe replacement on native filesystem           | Passed on APFS fixture copies | Unverified file-lock behavior        | Unverified                           |
| exFAT safe replacement and copy                          | Unverified                    | Unverified                           | Unverified                           |
| Real DAP / SD card                                       | Not run                       | Not run                              | Not run                              |
| Signed/notarized artifact                                | Not implemented               | Not implemented                      | Not applicable                       |

No cross-platform support claim should be made from CI compilation alone. Windows rename/locking, macOS Intel, real exFAT timestamp/atomicity, Linux mounts, and actual DAP playlist behavior remain manual release checks.
