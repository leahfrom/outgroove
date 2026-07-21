import { performance } from "node:perf_hooks";
import {
  copyFile,
  mkdtemp,
  mkdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { CatalogDatabase } from "../src/main/adapters/database/catalog-database";
import { WorkerScanCatalog } from "../src/main/adapters/database/worker-scan-catalog";
import {
  NodeLibraryFileSystem,
  WorkerLibraryFileSystem,
  type LibraryFileSystem,
} from "../src/main/adapters/filesystem/library-filesystem";
import { MusicMetadataReader } from "../src/main/adapters/metadata/metadata-reader";
import {
  pathComparisonKey,
  ScanLibrary,
} from "../src/main/application/scan-library";
import type {
  MetadataJobResult,
  MetadataJobRunner,
} from "../src/main/jobs/metadata-runner";
import { LocalMetadataJobRunner } from "../src/main/jobs/metadata-runner";
import { ScanJobCoordinator } from "../src/main/jobs/scan-job-coordinator";
import type { ScanJobDto } from "../src/shared/contracts/api";

const tracksPerAlbum = 10;

export interface LibraryBenchmarkReport {
  readonly files: number;
  readonly albums: number;
  readonly timingsMs: {
    readonly fixtureGeneration: number;
    readonly initialScan: number;
    readonly initialScanMaxEventLoopDelay: number;
    readonly unchangedRescan: number;
    readonly unchangedRescanMaxEventLoopDelay: number;
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
  readonly baselineHeapUsedBytes: number;
  readonly peakHeapUsedBytes: number;
  readonly databaseBytes: number;
}

export interface RealMetadataBenchmarkReport {
  readonly files: number;
  readonly initialScanMs: number;
  readonly unchangedRescanMs: number;
  readonly parsed: number;
  readonly unchanged: number;
  readonly errors: number;
  readonly peakRssBytes: number;
  readonly peakHeapUsedBytes: number;
}

function elapsed(start: number): number {
  return Math.round((performance.now() - start) * 100) / 100;
}

async function measureEventLoopDelay<T>(
  action: () => Promise<T>,
): Promise<{ result: T; elapsedMs: number; maxDelayMs: number }> {
  const intervalMs = 10;
  let expected = performance.now() + intervalMs;
  let maxDelayMs = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    maxDelayMs = Math.max(maxDelayMs, now - expected);
    expected = now + intervalMs;
  }, intervalMs);
  const started = performance.now();
  try {
    const result = await action();
    await new Promise<void>((resolve) => setImmediate(resolve));
    return {
      result,
      elapsedMs: elapsed(started),
      maxDelayMs: Math.round(maxDelayMs * 100) / 100,
    };
  } finally {
    clearInterval(timer);
  }
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
): Promise<string> {
  const albumCount = Math.ceil(fileCount / tracksPerAlbum);
  const albumDirectories = Array.from({ length: albumCount }, (_, index) =>
    join(root, `album-${String(index).padStart(6, "0")}`),
  );
  await boundedForEach(albumDirectories, 32, async (directory) => {
    await mkdir(directory);
    const albumIndex = Number(directory.slice(directory.lastIndexOf("-") + 1));
    const firstTrack = albumIndex * tracksPerAlbum;
    const tracksInAlbum = Math.min(tracksPerAlbum, fileCount - firstTrack);
    await Promise.all(
      Array.from({ length: tracksInAlbum }, (_, offset) =>
        writeFile(
          join(
            directory,
            `track-${String(firstTrack + offset).padStart(6, "0")}.mp3`,
          ),
          "",
        ),
      ),
    );
  });
  return join(albumDirectories[0] ?? root, "track-000000.mp3");
}

function indexFromPath(path: string): number {
  const match = /track-(\d+)\.mp3$/u.exec(basename(path));
  if (!match?.[1]) throw new Error(`Unexpected synthetic path: ${path}`);
  return Number(match[1]);
}

class SyntheticMetadataRunner implements MetadataJobRunner {
  constructor(private readonly totalFiles: number) {}

  async processAll(
    paths: readonly string[],
    onResult: (result: MetadataJobResult) => void | Promise<void>,
    onItem: (completed: number, total: number, path: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
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
        const result: MetadataJobResult = {
          ok: true,
          file: {
            path,
            size: info.size,
            modifiedMs: info.mtimeMs,
            format: "Synthetic fixture",
            durationSeconds: 1,
            tags: {
              title:
                itemIndex === this.totalFiles - 1
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
        const pending = onResult(result);
        if (pending !== undefined) await pending;
        onItem(++completed, paths.length, path);
      }
    };
    await Promise.all(Array.from({ length: Math.min(16, paths.length) }, work));
  }
}

class BlockingMetadataRunner implements MetadataJobRunner {
  private startedResolve: (() => void) | undefined;
  readonly started = new Promise<void>((resolve) => {
    this.startedResolve = resolve;
  });

  processAll(
    _paths: readonly string[],
    _onResult: (result: MetadataJobResult) => void | Promise<void>,
    _onItem: (completed: number, total: number, path: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
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
  fileSystem: LibraryFileSystem = new NodeLibraryFileSystem(),
  scanDatabaseWorkerPath?: string,
): Promise<LibraryBenchmarkReport> {
  if (!Number.isInteger(fileCount) || fileCount < 1 || fileCount > 100_000)
    throw new Error(
      "Benchmark file count must be an integer from 1 to 100000.",
    );
  const directory = await mkdtemp(join(tmpdir(), "outgroove-benchmark-"));
  const baselineMemory = process.memoryUsage();
  const baselineRssBytes = baselineMemory.rss;
  const baselineHeapUsedBytes = baselineMemory.heapUsed;
  let peakRssBytes = baselineRssBytes;
  let peakHeapUsedBytes = baselineHeapUsedBytes;
  const sampleMemory = (): void => {
    const memory = process.memoryUsage();
    peakRssBytes = Math.max(peakRssBytes, memory.rss);
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
  };
  const memorySampler = setInterval(() => {
    sampleMemory();
  }, 20);
  let database: CatalogDatabase | undefined;
  let workerScanCatalog: WorkerScanCatalog | undefined;
  try {
    const library = join(directory, "library");
    await mkdir(library);
    let started = performance.now();
    const firstPath = await generateLibrary(library, fileCount);
    sampleMemory();
    const fixtureGeneration = elapsed(started);

    const databasePath = join(directory, "catalog.sqlite3");
    database = new CatalogDatabase(databasePath);
    workerScanCatalog = scanDatabaseWorkerPath
      ? new WorkerScanCatalog(databasePath, resolve(scanDatabaseWorkerPath))
      : undefined;
    const scanCatalog = workerScanCatalog ?? database;
    const root = database.addLibraryRoot(library, pathComparisonKey(library));
    const scanner = new ScanLibrary(
      database,
      new SyntheticMetadataRunner(fileCount),
      fileSystem,
      scanCatalog,
    );
    const initialMeasurement = await measureEventLoopDelay(() =>
      scanner.execute(root.id),
    );
    const initialResult = initialMeasurement.result;
    sampleMemory();
    const initialScan = initialMeasurement.elapsedMs;

    const unchangedMeasurement = await measureEventLoopDelay(() =>
      scanner.execute(root.id),
    );
    const unchangedResult = unchangedMeasurement.result;
    sampleMemory();
    const unchangedRescan = unchangedMeasurement.elapsedMs;

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

    await writeFile(firstPath, "changed");
    const blocking = new BlockingMetadataRunner();
    const coordinator = new ScanJobCoordinator(
      database,
      new ScanLibrary(database, blocking, fileSystem, scanCatalog),
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
        initialScanMaxEventLoopDelay: initialMeasurement.maxDelayMs,
        unchangedRescan,
        unchangedRescanMaxEventLoopDelay: unchangedMeasurement.maxDelayMs,
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
      baselineHeapUsedBytes,
      peakHeapUsedBytes,
      databaseBytes: (await stat(databasePath)).size,
    };
  } finally {
    clearInterval(memorySampler);
    await workerScanCatalog?.close();
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

export async function runRealMetadataBenchmark(
  fileCount: number,
): Promise<RealMetadataBenchmarkReport> {
  if (!Number.isInteger(fileCount) || fileCount < 1 || fileCount > 5_000)
    throw new Error(
      "Real metadata file count must be an integer from 1 to 5000.",
    );
  const directory = await mkdtemp(
    join(tmpdir(), "outgroove-metadata-benchmark-"),
  );
  let peakRssBytes = process.memoryUsage().rss;
  let peakHeapUsedBytes = process.memoryUsage().heapUsed;
  const sampleMemory = (): void => {
    const memory = process.memoryUsage();
    peakRssBytes = Math.max(peakRssBytes, memory.rss);
    peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
  };
  const sampler = setInterval(sampleMemory, 20);
  let database: CatalogDatabase | undefined;
  try {
    const library = join(directory, "library");
    await mkdir(library);
    const paths = Array.from({ length: fileCount }, (_, index) =>
      join(library, `fixture-${String(index).padStart(5, "0")}.mp3`),
    );
    const fixture = join(
      process.cwd(),
      "fixtures",
      "audio",
      "preservation",
      "preservation.mp3",
    );
    await boundedForEach(paths, 32, (path) => copyFile(fixture, path));
    database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(library, pathComparisonKey(library));
    const scanner = new ScanLibrary(
      database,
      new LocalMetadataJobRunner(new MusicMetadataReader(), 2),
    );
    let started = performance.now();
    const initial = await scanner.execute(root.id);
    sampleMemory();
    const initialScanMs = elapsed(started);
    started = performance.now();
    const repeated = await scanner.execute(root.id);
    sampleMemory();
    return {
      files: fileCount,
      initialScanMs,
      unchangedRescanMs: elapsed(started),
      parsed: initial.parsed,
      unchanged: repeated.unchanged,
      errors: initial.errors + repeated.errors,
      peakRssBytes,
      peakHeapUsedBytes,
    };
  } finally {
    clearInterval(sampler);
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function requestedFileCount(args: readonly string[]): number {
  const index = args.indexOf("--files");
  return index === -1 ? 5_000 : Number(args[index + 1]);
}

function requestedFileSystem(args: readonly string[]): LibraryFileSystem {
  const index = args.indexOf("--worker-path");
  if (index === -1) return new NodeLibraryFileSystem();
  const workerPath = args[index + 1];
  if (!workerPath) throw new Error("--worker-path requires a file path.");
  return new WorkerLibraryFileSystem(resolve(workerPath));
}

function requestedScanDatabaseWorker(
  args: readonly string[],
): string | undefined {
  const index = args.indexOf("--database-worker-path");
  if (index === -1) return undefined;
  const workerPath = args[index + 1];
  if (!workerPath)
    throw new Error("--database-worker-path requires a file path.");
  return workerPath;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const args = process.argv.slice(2);
  const realIndex = args.indexOf("--real-files");
  const benchmark =
    realIndex === -1
      ? runLibraryBenchmark(
          requestedFileCount(args),
          requestedFileSystem(args),
          requestedScanDatabaseWorker(args),
        )
      : runRealMetadataBenchmark(Number(args[realIndex + 1]));
  void benchmark
    .then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
