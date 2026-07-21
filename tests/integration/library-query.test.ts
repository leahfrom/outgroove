import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { pathComparisonKey } from "../../src/main/application/scan-library";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

function addAlbum(
  database: CatalogDatabase,
  rootId: string,
  directory: string,
  index: number,
): void {
  const album = `Album ${String(index).padStart(2, "0")}`;
  const path = join(
    directory,
    album,
    index === 13 ? "secret-path-token.flac" : "song.flac",
  );
  database.upsertScannedFile(rootId, pathComparisonKey(path), {
    path,
    size: 100 + index,
    modifiedMs: index,
    format: index === 17 ? "SpecialCodec" : "FLAC",
    durationSeconds: 10,
    tags: {
      title: index === 9 ? "Needle Track" : `Track ${index}`,
      album,
      artist: index === 5 ? "Guest Track Artist" : "Fixture Artist",
      albumArtist: "Fixture Artist",
      trackNumber: 1,
      discNumber: 1,
      year: "2026",
    },
    nativeTags: [],
  });
}

describe("paginated library query", () => {
  it("returns stable bounded pages and searches track, path, and format", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-query-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    for (let index = 0; index < 25; index++)
      addAlbum(database, root.id, directory, index);
    const companionPath = join(directory, "Album 09", "companion.flac");
    database.upsertScannedFile(root.id, pathComparisonKey(companionPath), {
      path: companionPath,
      size: 90,
      modifiedMs: 90,
      format: "FLAC",
      durationSeconds: 10,
      tags: {
        title: "Companion Track",
        album: "Album 09",
        artist: "Fixture Artist",
        albumArtist: "Fixture Artist",
        trackNumber: 2,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [],
    });

    const first = database.queryLibrary({
      query: "",
      view: "albums",
      offset: 0,
      limit: 10,
    });
    const last = database.queryLibrary({
      query: "",
      view: "albums",
      offset: 20,
      limit: 10,
    });
    expect(first.totalItems).toBe(25);
    expect(first.albums).toHaveLength(10);
    expect(first.albums[0]?.title).toBe("Album 00");
    expect(last.albums.map((album) => album.title)).toEqual([
      "Album 20",
      "Album 21",
      "Album 22",
      "Album 23",
      "Album 24",
    ]);
    for (const [query, title] of [
      ["Needle", "Album 09"],
      ["SpecialCodec", "Album 17"],
      ["secret-path-token", "Album 13"],
      ["Guest Track Artist", "Album 05"],
    ] as const)
      expect(
        database.queryLibrary({ query, view: "albums", offset: 0, limit: 10 })
          .albums[0]?.title,
      ).toBe(title);
    expect(
      database.queryLibrary({
        query: "Needle",
        view: "albums",
        offset: 0,
        limit: 10,
      }).albums[0]?.tracks,
    ).toHaveLength(2);
    database.close();
  });

  it("pages scan problems separately and treats wildcard characters literally", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-problems-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    for (const [name, message] of [
      ["broken_100%.mp3", "Invalid MPEG header"],
      ["other.mp3", "Permission denied"],
    ]) {
      const path = join(directory, name ?? "missing");
      database.upsertScanError(
        root.id,
        path,
        pathComparisonKey(path),
        10,
        1,
        message ?? "Unknown error",
      );
    }
    const problems = database.queryLibrary({
      query: "100%",
      view: "scan-errors",
      offset: 0,
      limit: 1,
    });
    expect(problems.totalItems).toBe(1);
    expect(problems.scanErrors[0]?.path).toContain("broken_100%");
    expect(problems.albums).toEqual([]);
    database.close();
  });
});
