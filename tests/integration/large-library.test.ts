import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runLibraryBenchmark } from "../../scripts/library-benchmark";
import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { pathComparisonKey } from "../../src/main/application/scan-library";

describe("synthetic large-library pipeline", () => {
  it("scans incrementally, pages, searches, and cancels without thresholds", async () => {
    const report = await runLibraryBenchmark(5_250);
    expect(report).toMatchObject({
      files: 5_250,
      albums: 525,
      initialResult: { parsed: 5_250, unchanged: 0, errors: 0 },
      unchangedResult: { parsed: 0, unchanged: 5_250, errors: 0 },
      cancellationState: "cancelled",
      catalogItemsAfterCancellation: 525,
      firstPageItems: 20,
      folderItems: 20,
      folderTrackItems: 10,
      searchItems: 1,
    });
    for (const timing of Object.values(report.timingsMs))
      expect(timing).toBeGreaterThanOrEqual(0);
    expect(report.peakRssBytes).toBeGreaterThanOrEqual(report.baselineRssBytes);
    expect(report.peakHeapUsedBytes).toBeGreaterThanOrEqual(
      report.baselineHeapUsedBytes,
    );
    expect(report.databaseBytes).toBeGreaterThan(0);
  }, 30_000);
});

it("finalizes more seen paths than SQLite's parameter limit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-seen-paths-"));
  const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
  try {
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    const keptPath = join(directory, "kept.mp3");
    const missingPath = join(directory, "missing.mp3");
    for (const path of [keptPath, missingPath])
      database.upsertScannedFile(root.id, pathComparisonKey(path), {
        path,
        size: 1,
        modifiedMs: 1,
        format: "Synthetic",
        durationSeconds: 1,
        tags: {
          title: path,
          album: "Parameter Limit",
          artist: "Synthetic Artist",
          albumArtist: "Synthetic Artist",
          trackNumber: 1,
          discNumber: 1,
          year: "2026",
        },
        nativeTags: [],
      });
    database.beginScan(root.id);
    for (let offset = 0; offset < 40_000; offset += 250) {
      database.recordScanDiscoveryBatch(
        root.id,
        Array.from({ length: 250 }, (_, batchIndex) => {
          const index = offset + batchIndex;
          const path =
            index === 0
              ? keptPath
              : join(directory, "synthetic", `${index}.mp3`);
          return {
            kind: "file" as const,
            path,
            pathKey: pathComparisonKey(path),
            size: 1,
            modifiedMs: 1,
          };
        }),
      );
    }
    expect(() => database.finishScan(root.id)).not.toThrow();
    expect(
      database.getFileByPathKey(pathComparisonKey(keptPath))?.scan_state,
    ).toBe("ok");
    expect(
      database.getFileByPathKey(pathComparisonKey(missingPath))?.scan_state,
    ).toBe("missing");
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
