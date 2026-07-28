# Bundled fpcalc 1.6.1

These executables are the unmodified `fpcalc` files from the official
Chromaprint v1.6.1 release archives:

| Target      | Official archive SHA-256                                           | Executable SHA-256                                                 |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| macOS arm64 | `254f23cb2d290069ba1d3d28199414fbf66d2054fc2f6821c2fc62ed39470a95` | `23046544591f275c6da7b0fa57c1290535eb844df271e186e37af1715040921f` |
| Linux x64   | `fc16cd37a70168040bc9ceb45f1d4d1216f5a75bc4c9cf8564bea70ac6a45733` | `e7b14fbf9d544f6ba99b7aced3c07786258e09e37cfcb054a41d2a6eeb0887a7` |
| Windows x64 | `735d6182b38e9f364b84ce6f4ccd682c75e2851de89735711d6b762d12b92a4e` | `00dcc56d911f2dea84737aa9dc8e2d118c9eb7a037d815d1ed001d8593e8fbee` |

Source and release archives:
<https://github.com/acoustid/chromaprint/releases/tag/v1.6.1>

Outgroove invokes the executable directly with an exact catalog path and never
through a shell. The helper is copied outside `app.asar`, so a compatible
modified build can replace it without rebuilding Outgroove.
