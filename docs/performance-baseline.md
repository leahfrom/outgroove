# Large-library performance baseline

The benchmark uses generated empty `.mp3` paths and a deterministic synthetic
metadata adapter. It measures the real filesystem enumeration, signature
comparison, SQLite catalog, missing-file finalization, pagination/search, and
persisted cancellation paths. It does not measure `music-metadata` parsing or
worker-thread throughput and never reads a user library.

No hardware-independent pass threshold is enforced. The 500-file functional
profile runs in the normal test suite; larger profiles are explicit developer
commands whose JSON output should be retained when investigating a regression.

## Commands

```sh
npm run benchmark:library
npm run benchmark:library:100k
```

Both commands create and remove their own OS-temporary directory. The 100,000
profile is opt-in because creating that many directory entries is inappropriate
for routine CI.

## Evidence and first fix

The initial 5,000-file run on macOS arm64 exposed two concrete limits:

- scan finalization failed independently at 40,000 seen paths with SQLite's
  `too many SQL variables` error; and
- peak process RSS reached approximately 407 MiB, with a 1.20 s initial scan
  and 0.31 s unchanged rescan.

The catalog now reuses the hot scan statements, commits successful files in
bounded 250-record transactions, and uses a connection-local temporary table
for seen paths. That table is rebuildable, never enters backups, and avoids
coupling durable state to an interrupted scan.

The same 5,000-file profile after the change measured:

| Measurement      | Before  | After   |
| ---------------- | ------- | ------- |
| Initial scan     | 1.20 s  | 0.32 s  |
| Unchanged rescan | 0.31 s  | 0.15 s  |
| Peak process RSS | 407 MiB | 147 MiB |

These are local observations, not universal performance guarantees.

## 100,000-file result

On the same macOS arm64 development machine and temporary filesystem:

| Measurement                   | Two observed runs |
| ----------------------------- | ----------------- |
| Fixture-tree generation       | 5.80–5.87 s       |
| Initial catalog scan          | 10.47–11.73 s     |
| Unchanged rescan              | 2.75–3.32 s       |
| First 20-album page           | 305–351 ms        |
| Exact synthetic track search  | 289–355 ms        |
| Active metadata cancellation  | 0.57–0.74 ms      |
| Peak process RSS              | 572–608 MiB       |
| Albums available after cancel | 10,000            |

The cancellation measurement begins after enumeration, when a deliberately
blocked metadata runner has started. Enumeration itself checks the same abort
signal per directory entry, but this report does not claim a measured
enumeration-cancellation latency.

## Remaining limit

The run completes and the unchanged path is materially faster, but the observed
peak is too high for a final large-library claim. `MetadataJobRunner.readAll` and
`ScanLibrary` still retain complete path and result arrays. The next focused
performance change should stream bounded metadata-result batches into the
catalog, then add a smaller profile that parses real redistributable fixtures.
