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
  albumArtist = "Fixture Artist",
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
      albumArtist,
      trackNumber: 1,
      discNumber: 1,
      year: "2026",
    },
    nativeTags: [],
  });
}

describe("paginated library query", () => {
  it("pages searchable album artists with exact album and track counts", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-artists-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    for (let index = 0; index < 21; index++)
      addAlbum(
        database,
        root.id,
        directory,
        index,
        `Artist ${String(index).padStart(2, "0")}`,
      );
    addAlbum(database, root.id, directory, 50, "Artist 05");

    const first = database.queryLibrary({
      query: "",
      view: "artists",
      offset: 0,
      limit: 10,
    });
    const last = database.queryLibrary({
      query: "",
      view: "artists",
      offset: 20,
      limit: 10,
    });
    expect(first.totalItems).toBe(21);
    expect(first.artists).toHaveLength(10);
    expect(first.artists[0]).toEqual({
      name: "Artist 00",
      albumCount: 1,
      trackCount: 1,
    });
    expect(last.artists.map((artist) => artist.name)).toEqual(["Artist 20"]);

    const searched = database.queryLibrary({
      query: "05",
      view: "artists",
      offset: 0,
      limit: 10,
    });
    expect(searched.artists).toEqual([
      { name: "Artist 05", albumCount: 2, trackCount: 2 },
    ]);
    const filtered = database.queryLibrary({
      query: "Album 50",
      view: "albums",
      offset: 0,
      limit: 10,
      albumArtist: "Artist 05",
    });
    expect(filtered.albums.map((album) => album.title)).toEqual(["Album 50"]);
    expect(
      database
        .queryLibrary({
          query: "50",
          view: "albums",
          offset: 0,
          limit: 10,
          albumArtist: "Artist 05",
        })
        .albums.map((album) => album.title),
    ).toEqual(["Album 50"]);
    expect(
      database.queryLibrary({
        query: "",
        view: "albums",
        offset: 0,
        limit: 10,
        albumArtist: "Artist 05",
      }).totalItems,
    ).toBe(2);
    database.close();
  });

  it("returns stable bounded pages and searches track, path, and format", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-query-"));
    temporary.push(directory);
    const databasePath = join(directory, "catalog.sqlite3");
    const database = new CatalogDatabase(databasePath);
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
    const unknownFormatPath = join(directory, "Album 08", "unknown.bin");
    database.upsertScannedFile(root.id, pathComparisonKey(unknownFormatPath), {
      path: unknownFormatPath,
      size: 80,
      modifiedMs: 80,
      format: "",
      durationSeconds: 8,
      tags: {
        title: "Unknown Format Track",
        album: "Album 08",
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
    const tracks = database.queryLibrary({
      query: "",
      view: "tracks",
      offset: 0,
      limit: 10,
    });
    expect(tracks.totalItems).toBe(27);
    expect(tracks.tracks).toHaveLength(10);
    expect(tracks.tracks[0]).toMatchObject({
      title: "Track 0",
      artist: "Fixture Artist",
      albumTitle: "Album 00",
      albumArtist: "Fixture Artist",
      trackNumber: 1,
      discNumber: 1,
      format: "FLAC",
    });
    const needleTrack = database.queryLibrary({
      query: "Needle",
      view: "tracks",
      offset: 0,
      limit: 10,
    }).tracks[0];
    expect(needleTrack).toMatchObject({
      title: "Needle Track",
      albumTitle: "Album 09",
    });
    if (!needleTrack) throw new Error("Needle track missing");
    expect(
      database.queryLibrary({
        query: "",
        view: "albums",
        offset: 0,
        limit: 10,
        albumId: needleTrack.albumId,
      }).albums[0]?.title,
    ).toBe("Album 09");
    expect(
      database.queryLibrary({
        query: "SpecialCodec",
        view: "tracks",
        offset: 0,
        limit: 10,
      }).tracks[0]?.albumTitle,
    ).toBe("Album 17");
    const firstFolders = database.queryLibrary({
      query: "",
      view: "folders",
      offset: 0,
      limit: 10,
    });
    const lastFolders = database.queryLibrary({
      query: "",
      view: "folders",
      offset: 20,
      limit: 10,
    });
    expect(firstFolders.totalItems).toBe(25);
    expect(firstFolders.folders).toHaveLength(10);
    expect(firstFolders.folders[0]).toMatchObject({
      path: join(directory, "Album 00"),
      albumCount: 1,
      trackCount: 1,
    });
    expect(lastFolders.folders.map((folder) => folder.path)).toEqual([
      join(directory, "Album 20"),
      join(directory, "Album 21"),
      join(directory, "Album 22"),
      join(directory, "Album 23"),
      join(directory, "Album 24"),
    ]);
    const folder = database.queryLibrary({
      query: "Album 09",
      view: "folders",
      offset: 0,
      limit: 10,
    }).folders[0];
    expect(folder).toMatchObject({
      path: join(directory, "Album 09"),
      albumCount: 1,
      trackCount: 2,
    });
    if (!folder) throw new Error("Folder result missing");
    const folderTracks = database.queryLibrary({
      query: "",
      view: "tracks",
      offset: 0,
      limit: 10,
      folderId: folder.id,
    });
    expect(folderTracks.totalItems).toBe(2);
    expect(folderTracks.tracks.map((track) => track.albumTitle)).toEqual([
      "Album 09",
      "Album 09",
    ]);
    expect(
      database.queryLibrary({
        query: "%",
        view: "folders",
        offset: 0,
        limit: 10,
      }).folders,
    ).toEqual([]);
    const formats = database.queryLibrary({
      query: "",
      view: "formats",
      offset: 0,
      limit: 10,
    });
    expect(formats.totalItems).toBe(3);
    expect(formats.formats).toEqual([
      { name: "FLAC", trackCount: 25 },
      { name: "SpecialCodec", trackCount: 1 },
      { name: "unknown", trackCount: 1 },
    ]);
    expect(
      database.queryLibrary({
        query: "special",
        view: "formats",
        offset: 0,
        limit: 10,
      }).formats,
    ).toEqual([{ name: "SpecialCodec", trackCount: 1 }]);
    const formatTracks = database.queryLibrary({
      query: "",
      view: "tracks",
      offset: 0,
      limit: 10,
      format: "specialcodec",
    });
    expect(formatTracks.totalItems).toBe(1);
    expect(formatTracks.tracks[0]?.albumTitle).toBe("Album 17");
    expect(
      database.queryLibrary({
        query: "",
        view: "tracks",
        offset: 0,
        limit: 10,
        format: "unknown",
      }).tracks[0],
    ).toMatchObject({ title: "Unknown Format Track", format: "unknown" });
    database.close();
    const reopened = new CatalogDatabase(databasePath);
    expect(
      reopened.queryLibrary({
        query: "Album 09",
        view: "folders",
        offset: 0,
        limit: 10,
      }).folders[0],
    ).toMatchObject({
      path: join(directory, "Album 09"),
      albumCount: 1,
      trackCount: 2,
    });
    reopened.close();
  });

  it("keeps exact Unicode, wildcard, short, and edited search values synchronized", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-search-index-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    const path = join(directory, "literal.flac");
    database.upsertScannedFile(root.id, pathComparisonKey(path), {
      path,
      size: 123,
      modifiedMs: 456,
      format: "FLAC",
      durationSeconds: 10,
      tags: {
        title: 'Quoted Needle "Hi" 100%_Mix',
        album: "Beyoncé Mix",
        artist: "Original Track Artist",
        albumArtist: "Beyoncé",
        trackNumber: 1,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [],
    });

    for (const query of ["oncé", 'le "Hi', "100%_", "Hi", "%_"])
      expect(
        database.queryLibrary({ query, view: "albums", offset: 0, limit: 10 })
          .totalItems,
        query,
      ).toBe(1);

    const original = database.queryLibrary({
      query: "Quoted Needle",
      view: "albums",
      offset: 0,
      limit: 10,
    }).albums[0]?.tracks[0];
    expect(original).toBeDefined();
    if (!original) throw new Error("Indexed fixture track missing.");
    database.updateFileAfterEdit(original.id, {
      ...original,
      tags: {
        ...original.tags,
        title: "Updated Search Token",
        album: "Renamed Search Album",
        artist: "Changed Track Artist",
      },
    });

    for (const query of ["Updated Search", "Renamed Search", "Changed Track"])
      expect(
        database.queryLibrary({ query, view: "albums", offset: 0, limit: 10 })
          .totalItems,
      ).toBe(1);
    expect(
      database.queryLibrary({
        query: "Quoted Needle",
        view: "albums",
        offset: 0,
        limit: 10,
      }).totalItems,
    ).toBe(0);
    database.close();
  });

  it("derives deterministic multi-value genre pages and exact track filters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-genres-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    const addTrack = (name: string, genres?: readonly string[]): void => {
      const path = join(directory, `${name}.flac`);
      database.upsertScannedFile(root.id, pathComparisonKey(path), {
        path,
        size: name.length,
        modifiedMs: name.length,
        format: "FLAC",
        durationSeconds: 10,
        tags: {
          title: name,
          album: name,
          artist: "Fixture Artist",
          albumArtist: "Fixture Artist",
          trackNumber: 1,
          discNumber: 1,
          year: "2026",
          ...(genres ? { genres } : {}),
        },
        nativeTags: [],
      });
    };
    addTrack("Both", ["Rock", "Ambient"]);
    addTrack("Case variant", ["rock"]);
    addTrack("Literal", ["100%_Mix"]);
    addTrack("Literal label", ["No genre tag"]);
    addTrack("Missing");

    const firstPage = database.queryLibrary({
      query: "",
      view: "genres",
      offset: 0,
      limit: 3,
    });
    expect(firstPage.totalItems).toBe(5);
    expect(firstPage.genres).toEqual([
      { name: "100%_Mix", trackCount: 1, missing: false },
      { name: "Ambient", trackCount: 1, missing: false },
      { name: "No genre tag", trackCount: 1, missing: false },
    ]);
    expect(
      database.queryLibrary({
        query: "",
        view: "genres",
        offset: 3,
        limit: 3,
      }).genres,
    ).toEqual([
      { name: "Rock", trackCount: 2, missing: false },
      { name: "No genre tag", trackCount: 1, missing: true },
    ]);
    expect(
      database.queryLibrary({
        query: "%_",
        view: "genres",
        offset: 0,
        limit: 10,
      }).genres,
    ).toEqual([{ name: "100%_Mix", trackCount: 1, missing: false }]);
    expect(
      database
        .queryLibrary({
          query: "",
          view: "tracks",
          offset: 0,
          limit: 10,
          genre: "ROCK",
        })
        .tracks.map((track) => track.title),
    ).toEqual(["Both", "Case variant"]);
    expect(
      database
        .queryLibrary({
          query: "ambient",
          view: "tracks",
          offset: 0,
          limit: 10,
        })
        .tracks.map((track) => track.title),
    ).toEqual(["Both"]);
    expect(
      database
        .queryLibrary({
          query: "",
          view: "tracks",
          offset: 0,
          limit: 10,
          missingGenre: true,
        })
        .tracks.map((track) => track.title),
    ).toEqual(["Missing"]);
    database.close();
  });

  it("re-reads unchanged legacy catalog rows once to hydrate genres", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-genres-legacy-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    const path = join(directory, "legacy.flac");
    const file = {
      path,
      size: 10,
      modifiedMs: 20,
      format: "FLAC",
      durationSeconds: 30,
      tags: {
        title: "Legacy",
        album: "Legacy",
        artist: "Fixture",
        albumArtist: "Fixture",
        trackNumber: 1,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [],
    } as const;
    database.upsertScannedFile(root.id, pathComparisonKey(path), file);
    database.connection
      .prepare(
        `UPDATE audio_files
         SET normalized_tags_json=json_remove(normalized_tags_json, '$.genres')`,
      )
      .run();
    database.beginScan(root.id);
    expect(
      database.recordScanDiscoveryBatch(root.id, [
        {
          kind: "file",
          path,
          pathKey: pathComparisonKey(path),
          size: 10,
          modifiedMs: 20,
        },
      ]),
    ).toEqual({ changed: 1, unchanged: 0 });
    database.upsertScannedFile(root.id, pathComparisonKey(path), file);
    database.finishScan(root.id);
    database.beginScan(root.id);
    expect(
      database.recordScanDiscoveryBatch(root.id, [
        {
          kind: "file",
          path,
          pathKey: pathComparisonKey(path),
          size: 10,
          modifiedMs: 20,
        },
      ]),
    ).toEqual({ changed: 0, unchanged: 1 });
    database.close();
  });

  it("publishes album visibility after missing and restored file transitions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-visibility-"));
    temporary.push(directory);
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(
      directory,
      pathComparisonKey(directory),
    );
    const path = join(directory, "visible.flac");
    const file = {
      path,
      size: 10,
      modifiedMs: 20,
      format: "FLAC",
      durationSeconds: 30,
      tags: {
        title: "Visible track",
        album: "Visibility album",
        artist: "Fixture artist",
        albumArtist: "Fixture artist",
        trackNumber: 1,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [],
    } as const;
    database.upsertScannedFile(root.id, pathComparisonKey(path), file);
    const browse = (): number =>
      database.queryLibrary({
        query: "",
        view: "albums",
        offset: 0,
        limit: 10,
      }).totalItems;

    expect(browse()).toBe(1);
    database.beginScan(root.id);
    database.finishScan(root.id);
    expect(browse()).toBe(0);
    database.upsertScannedFile(root.id, pathComparisonKey(path), file);
    expect(browse()).toBe(1);
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
        11,
        1,
        message ?? "Unknown error",
      );
    }
    database.beginScan(root.id);
    const blocked = join(directory, "blocked");
    database.recordScanDirectoryError(
      root.id,
      blocked,
      pathComparisonKey(blocked),
      "Folder permission denied",
    );
    database.finishScan(root.id);
    const problems = database.queryLibrary({
      query: "100%",
      view: "scan-errors",
      offset: 0,
      limit: 1,
    });
    expect(problems.totalItems).toBe(1);
    expect(problems.scanErrors[0]?.path).toContain("broken_100%");
    expect(problems.albums).toEqual([]);
    const folderProblem = database.queryLibrary({
      query: "folder permission",
      view: "scan-errors",
      offset: 0,
      limit: 10,
    });
    expect(folderProblem).toMatchObject({
      totalItems: 1,
      scanErrors: [{ kind: "directory", path: blocked }],
    });
    database.close();
  });
});
