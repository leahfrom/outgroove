import { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";
import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ScanDatabaseWorkerRequest } from "../../../shared/contracts/scan-database-worker";
import { pathComparisonKey, ScanLibrary } from "../../application/scan-library";
import { NodeLibraryFileSystem } from "../filesystem/library-filesystem";
import { MusicMetadataReader } from "../metadata/metadata-reader";
import { LocalMetadataJobRunner } from "../../jobs/metadata-runner";
import { CatalogDatabase } from "./catalog-database";
import {
  type ScanDatabaseWorker,
  WorkerScanCatalog,
} from "./worker-scan-catalog";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function createTypeScriptWorker(
  workerPath: string,
  databasePath: string,
): ScanDatabaseWorker {
  return new Worker(workerPath, {
    workerData: { databasePath },
    execArgv: ["--import", "tsx"],
  });
}

describe("worker scan catalog", () => {
  it("releases its native database handle after the final scan", async () => {
    let created = 0;
    let terminated = 0;
    class RespondingWorker extends EventEmitter implements ScanDatabaseWorker {
      postMessage(message: ScanDatabaseWorkerRequest): void {
        queueMicrotask(() =>
          this.emit("message", { id: message.id, ok: true }),
        );
      }

      terminate(): Promise<number> {
        terminated++;
        return Promise.resolve(0);
      }
    }
    const catalog = new WorkerScanCatalog(
      "catalog.sqlite3",
      "worker.js",
      () => {
        created++;
        return new RespondingWorker();
      },
    );

    await catalog.beginScan("first-root");
    await catalog.finishScan("first-root");
    expect({ created, terminated }).toEqual({ created: 1, terminated: 1 });

    await catalog.beginScan("second-root");
    await catalog.abandonScan("second-root");
    expect({ created, terminated }).toEqual({ created: 2, terminated: 2 });
  });

  it("completes initial and unchanged fixture scans through the worker", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-worker-scan-"));
    temporary.push(directory);
    const libraryPath = join(directory, "library");
    await cp(join(process.cwd(), "fixtures", "audio", "album"), libraryPath, {
      recursive: true,
    });
    const databasePath = join(directory, "catalog.sqlite3");
    const database = new CatalogDatabase(databasePath);
    const root = database.addLibraryRoot(
      libraryPath,
      pathComparisonKey(libraryPath),
    );
    const catalog = new WorkerScanCatalog(
      databasePath,
      join(process.cwd(), "src", "workers", "scan-database-worker.ts"),
      createTypeScriptWorker,
    );
    const scanner = new ScanLibrary(
      database,
      new LocalMetadataJobRunner(new MusicMetadataReader()),
      new NodeLibraryFileSystem(),
      catalog,
    );

    try {
      await expect(scanner.execute(root.id)).resolves.toEqual({
        parsed: 2,
        unchanged: 0,
        errors: 1,
      });
      await expect(scanner.execute(root.id)).resolves.toEqual({
        parsed: 0,
        unchanged: 3,
        errors: 0,
      });
      expect(database.listAlbums()[0]?.tracks).toHaveLength(2);
      expect(database.listScanErrors()[0]?.path).toContain("corrupt.mp3");
      await catalog.close();
      database.close();
      const movedDatabasePath = join(directory, "moved-catalog.sqlite3");
      await rename(databasePath, movedDatabasePath);
      await rename(movedDatabasePath, databasePath);
    } finally {
      await catalog.close();
      database.close();
    }
  });

  it("classifies and persists a repeat scan without interrupting the active job", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "outgroove-scan-db-worker-"),
    );
    temporary.push(directory);
    const databasePath = join(directory, "catalog.sqlite3");
    const database = new CatalogDatabase(databasePath);
    const libraryPath = join(directory, "library");
    const filePath = join(libraryPath, "track.mp3");
    const pathKey = pathComparisonKey(filePath);
    const root = database.addLibraryRoot(
      libraryPath,
      pathComparisonKey(libraryPath),
    );
    const job = database.createScanJob(root.id);
    database.updateScanJob(job.id, { state: "running" });
    const catalog = new WorkerScanCatalog(
      databasePath,
      join(process.cwd(), "src", "workers", "scan-database-worker.ts"),
      createTypeScriptWorker,
    );

    try {
      await catalog.beginScan(root.id);
      await expect(
        catalog.recordScanDiscoveryBatch(root.id, [
          {
            kind: "file",
            path: filePath,
            pathKey,
            size: 123,
            modifiedMs: 456,
          },
        ]),
      ).resolves.toEqual({ changed: 1, unchanged: 0 });
      await expect(
        catalog.listChangedScanPaths(root.id, -1, 100),
      ).resolves.toEqual([{ sequence: 0, path: filePath }]);
      await catalog.upsertScannedFiles(root.id, [
        {
          pathKey,
          file: {
            path: filePath,
            size: 123,
            modifiedMs: 456,
            format: "MP3",
            durationSeconds: 12,
            tags: {
              title: "Worker track",
              album: "Worker album",
              artist: "Worker artist",
              albumArtist: "Worker artist",
              trackNumber: 1,
              discNumber: 1,
              year: "2026",
            },
            nativeTags: [{ id: "TIT2", value: "Worker track" }],
          },
        },
      ]);
      await catalog.finishScan(root.id);

      expect(database.getScanJob(job.id)?.state).toBe("running");
      expect(database.listAlbums()[0]?.tracks[0]?.tags.title).toBe(
        "Worker track",
      );

      await catalog.beginScan(root.id);
      await expect(
        catalog.recordScanDiscoveryBatch(root.id, [
          {
            kind: "file",
            path: filePath,
            pathKey,
            size: 123,
            modifiedMs: 456,
          },
        ]),
      ).resolves.toEqual({ changed: 0, unchanged: 1 });
      await expect(
        catalog.listChangedScanPaths(root.id, -1, 100),
      ).resolves.toEqual([]);
      await catalog.finishScan(root.id);
    } finally {
      await catalog.close();
      database.close();
    }
  });

  it("rejects pending work when its worker crashes", async () => {
    class CrashingWorker extends EventEmitter implements ScanDatabaseWorker {
      postMessage(): void {
        queueMicrotask(() => this.emit("error", new Error("fixture crash")));
      }

      terminate(): Promise<number> {
        return Promise.resolve(1);
      }
    }

    const catalog = new WorkerScanCatalog(
      "/fixture/catalog.sqlite3",
      "/fixture/worker.js",
      () => new CrashingWorker(),
    );
    await expect(catalog.beginScan("root-id")).rejects.toThrow("fixture crash");
    await catalog.close();
  });

  it("forces one search recovery when an active writer crashes", async () => {
    let created = 0;
    let recovered = false;
    class RecoveringWorker extends EventEmitter implements ScanDatabaseWorker {
      constructor(private readonly crash: boolean) {
        super();
      }

      postMessage(message: ScanDatabaseWorkerRequest): void {
        queueMicrotask(() => {
          if (this.crash && message.operation === "record-discovery") {
            this.emit("error", new Error("fixture mid-scan crash"));
            return;
          }
          if (message.operation === "abandon")
            recovered = message.recoverSearch;
          this.emit("message", { id: message.id, ok: true });
        });
      }

      terminate(): Promise<number> {
        return Promise.resolve(0);
      }
    }
    const catalog = new WorkerScanCatalog(
      "/fixture/catalog.sqlite3",
      "/fixture/worker.js",
      () => new RecoveringWorker(created++ === 0),
    );

    await catalog.beginScan("root-id");
    await expect(
      catalog.recordScanDiscoveryBatch("root-id", []),
    ).rejects.toThrow("fixture mid-scan crash");
    await catalog.abandonScan("root-id");
    expect({ created, recovered }).toEqual({ created: 2, recovered: true });
  });
});
