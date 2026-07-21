import { performance } from "node:perf_hooks";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import { CatalogDatabase } from "../src/main/adapters/database/catalog-database";
import {
  pathComparisonKey,
  ScanLibrary,
} from "../src/main/application/scan-library";
import type {
  MetadataJobResult,
  MetadataJobRunner,
} from "../src/main/jobs/metadata-runner";
import { ScanJobCoordinator } from "../src/main/jobs/scan-job-coordinator";
import type { ScanJobDto } from "../src/shared/contracts/api";

const tracksPerAlbum = 10;

export interface LibraryBenchmarkReport {
  readonly files: number;
  readonly albums: number;
  readonly timingsMs: {
    readonly fixtureGeneration: number;
    readonly initialScan: number;
    readonly unchangedRescan: number;
    readonly firstPageQuery: number;
    readonly searchQuery: number;
    readonly cancellation: number;
  };
  readonly initialResult: {
    readonly parsed: number;
    readonly unchanged: number;
    readonly errors: number;
  };
  readonly unchangedResult: {
    readonly parsed: number;
    readonly unchanged: number;
    readonly errors: number;
  };
  readonly cancellationState: string;
  readonly catalogItemsAfterCancellation: number;
  readonly firstPageItems: number;
  readonly searchItems: number;
  readonly baselineRssBytes: number;
  readonly peakRssBytes: number;
}

function elapsed(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

async function boundedForEach<T>(
  items: readonly T[],
  concurrency: number,
  action: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const work = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await action(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, work),
  );
}

async function generateLibrary(
  root: string,
  fileCount: number,
): Promise<readonly string[]> {
  const albumCount = Math.ceil(fileCount / tracksPerAlbum);
  const albumDirectories = Array.from({ length: albumCount }, (_, index) =>
    join(root, `album-${String(index).padStart(6, "0")}`),
  );
  await boundedForEach(albumDirectories, 32, (path) => mkdir(path));
  const paths = Array.from({ length: fileCount }, (_, index) =>
    join(
      albumDirectories[Math.floor(index / tracksPerAlbum)] ?? root,
      `track-${String(index).padStart(6, "0")}.mp3`,
    ),
  );
  await boundedForEach(paths, 64, (path) => writeFile(path, ""));
  return paths;
}

function indexFromPath(path: string): number {
  const match = /track-(\d+)\.mp3$/u.exec(basename(path));
  if (!match?.[1]) throw new Error(`Unexpected synthetic path: ${path}`);
  return Number(match[1]);
}

class SyntheticMetadataRunner implements MetadataJobRunner {
  async readAll(
    paths: readonly string[],
    onItem: (completed: number, total: number, path: string) => void,
    signal?: AbortSignal,
  ): Promise<readonly MetadataJobResult[]> {
    const results: MetadataJobResult[] = paths.map((path) => ({
      ok: false,
      path,
      error: "Pending",
    }));
    let next = 0;
    let completed = 0;
    const work = async (): Promise<void> => {
      while (next < paths.length) {
        if (signal?.aborted)
          throw new DOMException("Scan cancelled", "AbortError");
        const index = next++;
        const path = paths[index];
        if (!path) continue;
        const itemIndex = indexFromPath(path);
        const info = await stat(path);
        results[index] = {
          ok: true,
          file: {
            path,
            size: info.size,
            modifiedMs: info.mtimeMs,
            format: "Synthetic fixture",
            durationSeconds: 1,
            tags: {
              title:
                itemIndex === paths.length - 1
                  ? `Needle Track ${itemIndex}`
                  : `Track ${itemIndex}`,
              album: `Album ${Math.floor(itemIndex / tracksPerAlbum)}`,
              artist: "Synthetic Artist",
              albumArtist: "Synthetic Artist",
              trackNumber: (itemIndex % tracksPerAlbum) + 1,
              discNumber: 1,
              year: "2026",
            },
            nativeTags: [],
          },
        };
        onItem(++completed, paths.length, path);
      }
    };
    await Promise.all(Array.from({ length: Math.min(16, paths.length) }, work));
    return results;
  }
}

class BlockingMetadataRunner implements MetadataJobRunner {
  private startedResolve: (() => void) | undefined;
  readonly started = new Promise<void>((resolve) => {
    this.startedResolve = resolve;
  });

  readAll(
    _paths: readonly string[],
    _onItem: (completed: number, total: number, path: string) => void,
    signal?: AbortSignal,
  ): Promise<readonly MetadataJobResult[]> {
    this.startedResolve?.();
    return new Promise((_resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Scan cancelled", "AbortError"));
        return;
      }
      signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Scan cancelled", "AbortError")),
        { once: true },
      );
    });
  }
}

function terminalJob(coordinator: ScanJobCoordinator): Promise<ScanJobDto> {
  return new Promise((resolve) => {
    const unsubscribe = coordinator.onUpdated((job) => {
      if (["completed", "cancelled", "failed"].includes(job.state)) {
        unsubscribe();
        resolve(job);
      }
    });
  });
}

export async function runLibraryBenchmark(
  fileCount: number,
): Promise<LibraryBenchmarkReport> {
  if (!Number.isInteger(fileCount) || fileCount < 1 || fileCount > 100_000)
    throw new Error(
      "Benchmark file count must be an integer from 1 to 100000.",
    );
  const directory = await mkdtemp(join(tmpdir(), "outgroove-benchmark-"));
  const baselineRssBytes = process.memoryUsage().rss;
  let peakRssBytes = baselineRssBytes;
  const sampleMemory = (): void => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  };
  const memorySampler = setInterval(() => {
    sampleMemory();
  }, 20);
  let database: CatalogDatabase | undefined;
  try {
    const library = join(directory, "library");
    await mkdir(library);
    let started = performance.now();
    const paths = await generateLibrary(library, fileCount);
    sampleMemory();
    const fixtureGeneration = elapsed(started);

    database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(library, pathComparisonKey(library));
    const scanner = new ScanLibrary(database, new SyntheticMetadataRunner());
    started = performance.now();
    const initialResult = await scanner.execute(root.id);
    sampleMemory();
    const initialScan = elapsed(started);

    started = performance.now();
    const unchangedResult = await scanner.execute(root.id);
    sampleMemory();
    const unchangedRescan = elapsed(started);

    started = performance.now();
    const firstPage = database.queryLibrary({
      query: "",
      view: "albums",
      offset: 0,
      limit: 20,
    });
    const firstPageQuery = elapsed(started);

    started = performance.now();
    const search = database.queryLibrary({
      query: `Needle Track ${fileCount - 1}`,
      view: "albums",
      offset: 0,
      limit: 20,
    });
    const searchQuery = elapsed(started);

    const firstPath = paths[0];
    if (!firstPath) throw new Error("Synthetic library did not create a file.");
    await writeFile(firstPath, "changed");
    const blocking = new BlockingMetadataRunner();
    const coordinator = new ScanJobCoordinator(
      database,
      new ScanLibrary(database, blocking),
    );
    const terminal = terminalJob(coordinator);
    const job = coordinator.start(root.id);
    await blocking.started;
    started = performance.now();
    coordinator.cancel(job.id);
    const cancelled = await terminal;
    const cancellation = elapsed(started);
    sampleMemory();
    const afterCancellation = database.queryLibrary({
      query: "",
      view: "albums",
      offset: 0,
      limit: 1,
    });

    return {
      files: fileCount,
      albums: Math.ceil(fileCount / tracksPerAlbum),
      timingsMs: {
        fixtureGeneration,
        initialScan,
        unchangedRescan,
        firstPageQuery,
        searchQuery,
        cancellation,
      },
      initialResult,
      unchangedResult,
      cancellationState: cancelled.state,
      catalogItemsAfterCancellation: afterCancellation.totalItems,
      firstPageItems: firstPage.albums.length,
      searchItems: search.albums.length,
      baselineRssBytes,
      peakRssBytes,
    };
  } finally {
    clearInterval(memorySampler);
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function requestedFileCount(args: readonly string[]): number {
  const index = args.indexOf("--files");
  return index === -1 ? 5_000 : Number(args[index + 1]);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  void runLibraryBenchmark(requestedFileCount(process.argv.slice(2)))
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
