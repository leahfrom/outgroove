import { cp, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import {
  NodeLibraryFileSystem,
  type LibraryDiscoveryItem,
  type LibraryFileSystem,
} from "../../src/main/adapters/filesystem/library-filesystem";
import { MusicMetadataReader } from "../../src/main/adapters/metadata/metadata-reader";
import {
  ScanLibrary,
  pathComparisonKey,
} from "../../src/main/application/scan-library";
import { LocalMetadataJobRunner } from "../../src/main/jobs/metadata-runner";

const temporary: string[] = [];
async function* discovered(
  ...items: readonly LibraryDiscoveryItem[]
): AsyncGenerator<LibraryDiscoveryItem> {
  await Promise.resolve();
  yield* items;
}

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

  it("reports a disconnected root without marking catalog files missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-disconnected-"));
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
    await scanner.execute(root.id);
    const indexedPath = database.listAlbums()[0]?.tracks[0]?.path;
    expect(indexedPath).toBeDefined();

    await rename(library, join(directory, "disconnected-library"));
    await expect(scanner.execute(root.id)).resolves.toEqual({
      parsed: 0,
      unchanged: 0,
      errors: 1,
    });
    expect(
      indexedPath &&
        database.getFileByPathKey(pathComparisonKey(indexedPath))?.scan_state,
    ).toBe("ok");
    expect(database.listScanErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "directory",
          path: library,
        }),
      ]),
    );
    database.close();
  });

  it("continues past a folder error, then clears it after a complete scan", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-folder-error-"));
    temporary.push(directory);
    const library = join(directory, "library");
    await cp(join(process.cwd(), "fixtures", "audio", "album"), library, {
      recursive: true,
    });
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(library, pathComparisonKey(library));
    const hiddenPath = join(library, "previously-indexed.mp3");
    database.upsertScannedFile(root.id, pathComparisonKey(hiddenPath), {
      path: hiddenPath,
      size: 1,
      modifiedMs: 1,
      format: "Synthetic",
      durationSeconds: 1,
      tags: {
        title: "Previously indexed",
        album: "Folder error safety",
        artist: "Fixture artist",
        albumArtist: "Fixture artist",
        trackNumber: 1,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [],
    });
    const readablePath = join(library, "01-first.mp3");
    const nodeFileSystem = new NodeLibraryFileSystem();
    const partialFileSystem: LibraryFileSystem = {
      discover: () =>
        discovered(
          { kind: "file", path: readablePath },
          {
            kind: "directory-error",
            path: join(library, "blocked"),
            message: "EACCES: fixture directory is inaccessible",
          },
        ),
      statFile: (path) => nodeFileSystem.statFile(path),
    };
    const metadata = new LocalMetadataJobRunner(new MusicMetadataReader());
    await expect(
      new ScanLibrary(database, metadata, partialFileSystem).execute(root.id),
    ).resolves.toEqual({ parsed: 1, unchanged: 0, errors: 1 });
    expect(
      database.getFileByPathKey(pathComparisonKey(hiddenPath))?.scan_state,
    ).toBe("ok");
    expect(database.listScanErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "directory",
          path: join(library, "blocked"),
        }),
      ]),
    );

    await new ScanLibrary(database, metadata).execute(root.id);
    expect(database.listScanErrors()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "directory" })]),
    );
    expect(
      database.getFileByPathKey(pathComparisonKey(hiddenPath))?.scan_state,
    ).toBe("missing");
    database.close();
  });

  it("records an inaccessible file without invoking metadata parsing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-file-error-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    const inaccessiblePath = join(directory, "inaccessible.mp3");
    const fileSystem: LibraryFileSystem = {
      discover: () => discovered({ kind: "file", path: inaccessiblePath }),
      statFile: () => Promise.reject(new Error("EACCES: fixture file")),
    };
    const processAll = vi.fn(() => Promise.resolve());
    await expect(
      new ScanLibrary(database, { processAll }, fileSystem).execute(root.id),
    ).resolves.toEqual({ parsed: 0, unchanged: 0, errors: 1 });
    expect(processAll).not.toHaveBeenCalled();
    expect(database.listScanErrors()).toEqual([
      {
        kind: "file",
        path: inaccessiblePath,
        message: "EACCES: fixture file",
      },
    ]);
    database.close();
  });
});
