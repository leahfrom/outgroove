import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { MusicMetadataReader } from "../../src/main/adapters/metadata/metadata-reader";
import {
  ScanLibrary,
  pathComparisonKey,
} from "../../src/main/application/scan-library";
import { LocalMetadataJobRunner } from "../../src/main/jobs/metadata-runner";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

describe("incremental library scan", () => {
  it("indexes good files, retains a corrupt item error, and skips every unchanged file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-scan-"));
    temporary.push(directory);
    const library = join(directory, "library");
    await cp(join(process.cwd(), "fixtures", "audio", "album"), library, {
      recursive: true,
    });
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(library, pathComparisonKey(library));
    const scanner = new ScanLibrary(
      database,
      new LocalMetadataJobRunner(new MusicMetadataReader()),
    );

    await expect(scanner.execute(root.id)).resolves.toEqual({
      parsed: 2,
      unchanged: 0,
      errors: 1,
    });
    expect(database.listAlbums()).toHaveLength(1);
    expect(database.listAlbums()[0]?.tracks).toHaveLength(2);
    expect(database.listScanErrors()).toHaveLength(1);
    expect(database.listScanErrors()[0]?.path).toContain("corrupt.mp3");
    await expect(scanner.execute(root.id)).resolves.toEqual({
      parsed: 0,
      unchanged: 3,
      errors: 0,
    });
    expect(database.listScanErrors()).toHaveLength(1);
    database.close();
  });

  it("records each distinct malformed container without aborting the scan", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-corrupt-"));
    temporary.push(directory);
    const library = join(directory, "library");
    await cp(join(process.cwd(), "fixtures", "audio", "corrupt"), library, {
      recursive: true,
    });
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(library, pathComparisonKey(library));
    const scanner = new ScanLibrary(
      database,
      new LocalMetadataJobRunner(new MusicMetadataReader()),
    );
    await expect(scanner.execute(root.id)).resolves.toEqual({
      parsed: 0,
      unchanged: 0,
      errors: 3,
    });
    expect(database.listScanErrors().map((error) => error.path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("truncated-id3.mp3"),
        expect.stringContaining("truncated-metadata.flac"),
        expect.stringContaining("unsupported.ogg"),
      ]),
    );
    expect(database.listAlbums()).toEqual([]);
    database.close();
  });
});
