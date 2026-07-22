import { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { LibraryPageDto } from "../../../shared/contracts/api";
import type { LibraryQualityWorkerMessage } from "../../../shared/contracts/library-quality-worker";
import { pathComparisonKey } from "../../application/scan-library";
import { CatalogDatabase } from "./catalog-database";
import {
  type LibraryQualityWorker,
  WorkerLibraryQualityQuery,
} from "./worker-library-quality-query";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const emptyPage: LibraryPageDto = {
  albums: [],
  scanErrors: [],
  totalItems: 0,
  offset: 0,
  limit: 20,
};

class ControlledWorker extends EventEmitter implements LibraryQualityWorker {
  terminated = 0;

  terminate(): Promise<number> {
    this.terminated++;
    return Promise.resolve(0);
  }

  send(message: LibraryQualityWorkerMessage): void {
    this.emit("message", message);
  }
}

describe("worker-backed Library data-quality query", () => {
  it("reports progress, returns the worker page, and closes the worker", async () => {
    const worker = new ControlledWorker();
    const progress: string[] = [];
    const query = new WorkerLibraryQualityQuery(
      "/fixture/catalog.sqlite3",
      "/fixture/worker.js",
      () => worker,
    );

    const pending = query.query(
      { query: "", offset: 0, limit: 20, qualityFilter: "all" },
      (_completed, _total, detail) => progress.push(detail),
    );
    await Promise.resolve();
    worker.send({ type: "progress", completed: 50, total: 75 });
    worker.send({ type: "complete", page: emptyPage });

    await expect(pending).resolves.toEqual(emptyPage);
    expect(progress).toEqual(["Checked 50 of 75 albums."]);
    expect(worker.terminated).toBe(1);
  });

  it("terminates and rejects a superseded query without affecting its successor", async () => {
    const workers: ControlledWorker[] = [];
    const query = new WorkerLibraryQualityQuery(
      "/fixture/catalog.sqlite3",
      "/fixture/worker.js",
      () => {
        const worker = new ControlledWorker();
        workers.push(worker);
        return worker;
      },
    );

    const first = query.query({
      query: "first",
      offset: 0,
      limit: 20,
      qualityFilter: "all",
    });
    await Promise.resolve();
    const firstResult = first.catch((error: unknown) => error);
    const second = query.query({
      query: "second",
      offset: 0,
      limit: 20,
      qualityFilter: "all",
    });
    await expect(firstResult).resolves.toMatchObject({ name: "AbortError" });
    expect(workers[0]?.terminated).toBe(1);
    expect(workers).toHaveLength(2);
    await Promise.resolve();
    workers[1]?.send({ type: "complete", page: emptyPage });
    await expect(second).resolves.toEqual(emptyPage);
  });

  it("allows only the newest same-turn query to spawn a worker", async () => {
    const workers: ControlledWorker[] = [];
    const query = new WorkerLibraryQualityQuery(
      "/fixture/catalog.sqlite3",
      "/fixture/worker.js",
      () => {
        const worker = new ControlledWorker();
        workers.push(worker);
        return worker;
      },
    );

    const first = query.query({
      query: "first",
      offset: 0,
      limit: 20,
      qualityFilter: "all",
    });
    const firstResult = first.catch((error: unknown) => error);
    const second = query.query({
      query: "second",
      offset: 0,
      limit: 20,
      qualityFilter: "all",
    });
    await expect(firstResult).resolves.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    expect(workers).toHaveLength(1);
    workers[0]?.send({ type: "complete", page: emptyPage });
    await expect(second).resolves.toEqual(emptyPage);
  });

  it("pages and searches exact findings through a real SQLite worker", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "outgroove-quality-worker-"),
    );
    temporary.push(directory);
    const databasePath = join(directory, "catalog.sqlite3");
    const database = new CatalogDatabase(databasePath);
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    const addTrack = (
      album: string,
      title: string,
      trackNumber: number | null,
      changes: Partial<{
        albumArtist: string;
        year: string | null;
      }> = {},
    ): void => {
      const path = join(directory, album, `${title}.flac`);
      database.upsertScannedFile(root.id, pathComparisonKey(path), {
        path,
        size: 100,
        modifiedMs: 1,
        format: "FLAC",
        durationSeconds: 60,
        tags: {
          title,
          album,
          artist: "Fixture Artist",
          albumArtist: "Fixture Artist",
          trackNumber,
          discNumber: 1,
          year: "2026",
          ...changes,
        },
        nativeTags: [],
      });
    };
    addTrack("Clean Album", "Clean Track", 1);
    addTrack("Flagged Alpha", "Unknown title", 1);
    addTrack("Needle Flagged", "Needle Track", null);
    addTrack("Mixed Credits", "First", 1);
    addTrack("Mixed Credits", "Second", 2, {
      year: "2025",
    });
    database.queryLibrary({ query: "", view: "albums", offset: 0, limit: 20 });

    const progress: number[] = [];
    const query = new WorkerLibraryQualityQuery(
      databasePath,
      join(process.cwd(), "src", "workers", "library-quality-worker.ts"),
      (workerPath, catalogPath, request) =>
        new Worker(workerPath, {
          workerData: { databasePath: catalogPath, request },
          execArgv: ["--import", "tsx"],
        }),
    );
    try {
      const first = await query.query(
        { query: "", offset: 0, limit: 1, qualityFilter: "all" },
        (completed) => progress.push(completed),
      );
      expect(first).toMatchObject({ totalItems: 3, offset: 0, limit: 1 });
      expect(first.albums.map((album) => album.title)).toEqual([
        "Flagged Alpha",
      ]);
      const second = await query.query({
        query: "",
        offset: 1,
        limit: 1,
        qualityFilter: "all",
      });
      expect(second.albums.map((album) => album.title)).toEqual([
        "Mixed Credits",
      ]);
      const searched = await query.query({
        query: "Needle",
        offset: 0,
        limit: 20,
        qualityFilter: "numbering",
      });
      expect(searched).toMatchObject({
        totalItems: 1,
        albums: [{ title: "Needle Flagged" }],
      });
      const consistency = await query.query({
        query: "",
        offset: 0,
        limit: 20,
        qualityFilter: "consistency",
      });
      expect(consistency.albums.map((album) => album.title)).toEqual([
        "Mixed Credits",
      ]);
      const missingTags = await query.query({
        query: "",
        offset: 0,
        limit: 20,
        qualityFilter: "missing-tags",
      });
      expect(missingTags.albums.map((album) => album.title)).toEqual([
        "Flagged Alpha",
      ]);
      expect(progress.at(-1)).toBe(4);
    } finally {
      await query.close();
      database.close();
    }
  });
});
