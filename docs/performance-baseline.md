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
npm run benchmark:metadata
```

After Forge has built `.vite/build/library-discovery-worker.js`, the synthetic
profile can exercise both production worker boundaries explicitly:

```sh
npm run benchmark:library -- --files 100000 --worker-path .vite/build/library-discovery-worker.js --database-worker-path .vite/build/scan-database-worker.js
```

All commands create and remove their own OS-temporary directory. The 100,000
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

## Streaming-result experiment

`MetadataJobRunner` now delivers each result to an async consumer with
backpressure. Both local and worker-thread implementations retain only their
active concurrency window, and `ScanLibrary` commits each bounded catalog batch
as results arrive. A regression test blocks both consumers and proves a
concurrency-two runner performs no additional reads until they resume.

This removed the complete metadata-result array, but subsequent 100,000-file
runs measured approximately 538–613 MiB peak RSS—overlapping the earlier
572–608 MiB range. Result retention was therefore not the dominant RSS cost.
The latest instrumented run measured 389 MiB peak JavaScript heap and a 150 MiB
SQLite file. Replacing the remaining complete path arrays without weakening
deterministic discovery or missing-file safety is the next evidence-backed
performance task.

## Streaming discovery and path state

The benchmark originally retained its own 100,000-path fixture array after
generation. Removing that measurement artifact produced a corrected pre-change
peak of approximately 415 MiB RSS and 233 MiB JavaScript heap. The scanner now:

- discovers supported files through a deterministic async iterator;
- commits seen paths and changed-file work to connection-local temporary SQLite
  tables in 250-entry discovery batches;
- reads changed work back in bounded 5,000-path metadata pages; and
- clears temporary state on cancellation or failure without marking unseen
  catalog files missing.

The same macOS arm64 100,000-file profile then measured:

| Measurement          | Corrected before | Streaming path state |
| -------------------- | ---------------- | -------------------- |
| Initial scan         | 13.05 s          | 13.37 s              |
| Unchanged rescan     | 4.07 s           | 4.20 s               |
| Peak process RSS     | 415 MiB          | 269 MiB              |
| Peak JavaScript heap | 233 MiB          | 76 MiB               |

The cancellation path took 54 ms in the streamed run because it synchronously
discarded the temporary 100,000-entry seen set before reporting completion.
The disconnected-root regression test proves an enumeration failure abandons
that state and preserves the prior catalog instead of treating the library as
empty. These figures remain local observations, not platform-independent
thresholds or evidence from real user media.

## Discovery worker boundary

The Electron app runs deterministic traversal and bulk file stat calls in a
dedicated worker. It sends at most 250 results and then waits for main to consume
and acknowledge that batch before continuing. Cancellation terminates the
worker; a crash rejects the scan and abandons temporary scan state instead of
finalizing an apparently empty library.

The default synthetic benchmark deliberately retains its in-process filesystem
adapter so it can run without a Forge build. Use the explicit `--worker-path`
form above when measuring cross-thread overhead.

The first macOS arm64 100,000-file worker-backed run measured a 13.18 s initial
scan, 3.70 s unchanged rescan, approximately 323 MiB peak process RSS, and
71 MiB peak main-process JavaScript heap. The higher RSS than the in-process
adapter includes the additional worker isolate; this boundary is intended to
protect Electron main responsiveness and failure isolation, not reduce total
process memory. These remain local synthetic observations.

## Scan database worker boundary

Discovery classification, temporary seen/changed staging, and catalog write
transactions now run through a serialized, scan-scoped SQLite worker. The
worker owns its temporary tables, commits at most 250 discovered or parsed
files per transaction, and closes after the final active scan finishes or is
abandoned. Electron main retains paginated queries, persisted job state, and
backup/restore orchestration. A crash drops the connection-local staging tables
and fails the scan without running missing-file finalization.

The benchmark samples a 10 ms timer while each scan runs and reports the
largest delay beyond the expected timer deadline. On the same macOS arm64
machine, consecutive 100,000-file runs measured:

| Measurement                        | Main-owned scan writes | SQLite scan worker |
| ---------------------------------- | ---------------------- | ------------------ |
| Initial scan                       | 13.83 s                | 12.58 s            |
| Initial maximum event-loop delay   | 41.08 ms               | 2.49 ms            |
| Unchanged rescan                   | 3.43 s                 | 3.68 s             |
| Unchanged maximum event-loop delay | 4.16 ms                | 2.02 ms            |
| Peak total process RSS             | 314 MiB                | 349 MiB            |
| Peak main-process JavaScript heap  | 66 MiB                 | 68 MiB             |

The timer is a regression signal, not a hard real-time guarantee. Total RSS
increases because the native worker adds another V8 isolate and SQLite
connection. The packaged smoke now scans through discovery, metadata, and
SQLite workers before verifying a database backup on every release platform.

## Real metadata parsing profile

`npm run benchmark:metadata` copies the redistributable preservation MP3 1,000
times into a temporary library and parses it through `music-metadata` with the
streaming local runner. The first observed macOS arm64 run parsed all 1,000
files without errors in 3.36 s; the unchanged rescan took 29 ms. Peak process
RSS was approximately 133 MiB and peak JavaScript heap was 27 MiB. This is a
repeatable adapter-through-catalog profile, not a claim about the variety or
storage latency of a real 1,000-file collection.
