import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import type { LibraryFileSystem } from "../../src/main/adapters/filesystem/library-filesystem";
import {
  ScanLibrary,
  pathComparisonKey,
} from "../../src/main/application/scan-library";
import type { MetadataJobRunner } from "../../src/main/jobs/metadata-runner";
import { ScanJobCoordinator } from "../../src/main/jobs/scan-job-coordinator";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

function terminalJob(coordinator: ScanJobCoordinator) {
  return new Promise<ReturnType<ScanJobCoordinator["latest"]>>((resolve) => {
    const unsubscribe = coordinator.onUpdated((job) => {
      if (["completed", "cancelled", "failed"].includes(job.state)) {
        unsubscribe();
        resolve(job);
      }
    });
  });
}

describe("persistent scan jobs", () => {
  it("persists completion and safely reruns from the same root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-jobs-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    const runner: MetadataJobRunner = {
      processAll: () => Promise.resolve(),
    };
    const coordinator = new ScanJobCoordinator(
      database,
      new ScanLibrary(database, runner),
    );
    const finished = terminalJob(coordinator);
    const started = coordinator.start(root.id);
    expect(started.state).toBe("queued");
    await expect(finished).resolves.toMatchObject({
      rootId: root.id,
      state: "completed",
      result: { parsed: 0, unchanged: 0, errors: 0 },
    });
    expect(database.listLibraryRoots()[0]?.lastScanAt).not.toBeNull();
    database.close();
  });

  it("cancels active metadata work without completing the root scan", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-cancel-"));
    temporary.push(directory);
    await writeFile(join(directory, "waiting.mp3"), "fixture");
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    const previouslyIndexedPath = join(directory, "previously-indexed.mp3");
    database.upsertScannedFile(
      root.id,
      pathComparisonKey(previouslyIndexedPath),
      {
        path: previouslyIndexedPath,
        size: 1,
        modifiedMs: 1,
        format: "Synthetic",
        durationSeconds: 1,
        tags: {
          title: "Previously indexed",
          album: "Cancellation safety",
          artist: "Fixture artist",
          albumArtist: "Fixture artist",
          trackNumber: 1,
          discNumber: 1,
          year: "2026",
        },
        nativeTags: [],
      },
    );
    const runner: MetadataJobRunner = {
      processAll: (_paths, _onResult, _onItem, signal) =>
        new Promise((_resolve, reject) =>
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          ),
        ),
    };
    const coordinator = new ScanJobCoordinator(
      database,
      new ScanLibrary(database, runner),
    );
    const finished = terminalJob(coordinator);
    const started = coordinator.start(root.id);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(coordinator.cancel(started.id).state).toBe("cancelling");
    await expect(finished).resolves.toMatchObject({ state: "cancelled" });
    expect(database.listLibraryRoots()[0]?.lastScanAt).toBeNull();
    expect(
      database.getFileByPathKey(pathComparisonKey(previouslyIndexedPath))
        ?.scan_state,
    ).toBe("ok");
    database.close();
  });

  it("persists discovery counts and cancels before metadata starts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-discovery-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    const discoveredPath = join(directory, "found.mp3");
    const fileSystem: LibraryFileSystem = {
      async *discover(_root, signal) {
        yield { kind: "file", path: discoveredPath } as const;
        await new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("cancelled", "AbortError"));
            return;
          }
          signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        });
      },
      statFile: () => Promise.resolve({ size: 1, modifiedMs: 1 }),
    };
    const runner: MetadataJobRunner = {
      processAll: () => Promise.reject(new Error("Metadata must not start")),
    };
    const coordinator = new ScanJobCoordinator(
      database,
      new ScanLibrary(database, runner, fileSystem),
    );
    const discoveryUpdate = new Promise<ReturnType<typeof coordinator.latest>>(
      (resolve) => {
        const unsubscribe = coordinator.onUpdated((job) => {
          if (job.detail.includes("1 audio file found")) {
            unsubscribe();
            resolve(job);
          }
        });
      },
    );
    const finished = terminalJob(coordinator);
    const started = coordinator.start(root.id);
    await expect(discoveryUpdate).resolves.toMatchObject({
      state: "running",
      completed: 1,
      total: 0,
      detail: "Discovering: 1 audio file found, 0 folder problems.",
    });
    coordinator.cancel(started.id);
    await expect(finished).resolves.toMatchObject({ state: "cancelled" });
    expect(database.listLibraryRoots()[0]?.lastScanAt).toBeNull();
    database.close();
  });
});
