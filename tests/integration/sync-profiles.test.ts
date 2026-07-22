import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

describe("saved DAP profiles", () => {
  it("lists persisted profiles and their albums in deterministic order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-profiles-"));
    temporary.push(directory);
    const databasePath = join(directory, "catalog.sqlite3");
    const database = new CatalogDatabase(databasePath);
    const root = database.addLibraryRoot(directory, directory);
    const addAlbum = (
      fileName: string,
      title: string,
      albumArtist: string,
    ): string => {
      database.upsertScannedFile(root.id, fileName, {
        path: join(directory, fileName),
        size: 100,
        modifiedMs: 1,
        format: "FLAC",
        durationSeconds: 60,
        tags: {
          title: `${title} Track`,
          album: title,
          artist: albumArtist,
          albumArtist,
          trackNumber: 1,
          discNumber: 1,
          year: "2026",
        },
        nativeTags: [],
      });
      const album = database
        .listAlbums()
        .find((candidate) => candidate.title === title);
      if (!album) throw new Error("DAP profile album fixture missing.");
      return album.id;
    };
    const zetaId = addAlbum("zeta.flac", "Zeta", "Second Artist");
    const alphaId = addAlbum("alpha.flac", "Alpha", "First Artist");
    const older = database.createSyncProfile("Older DAP", "/targets/older", [
      zetaId,
    ]);
    const newer = database.createSyncProfile("Road DAP", "/targets/road", [
      zetaId,
      alphaId,
    ]);
    database.connection
      .prepare("UPDATE sync_profiles SET created_at=? WHERE id=?")
      .run("2026-01-01T00:00:00.000Z", older.id);
    database.connection
      .prepare("UPDATE sync_profiles SET created_at=? WHERE id=?")
      .run("2026-02-01T00:00:00.000Z", newer.id);

    expect(database.listSyncProfiles()).toEqual([
      {
        id: newer.id,
        name: "Road DAP",
        targetPath: "/targets/road",
        albumIds: [alphaId, zetaId],
        albums: [
          { id: alphaId, title: "Alpha", albumArtist: "First Artist" },
          { id: zetaId, title: "Zeta", albumArtist: "Second Artist" },
        ],
        createdAt: "2026-02-01T00:00:00.000Z",
      },
      {
        id: older.id,
        name: "Older DAP",
        targetPath: "/targets/older",
        albumIds: [zetaId],
        albums: [{ id: zetaId, title: "Zeta", albumArtist: "Second Artist" }],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    database.saveManifest(older.id, "/targets/older", { entries: [] });
    const previousManifest = database.getLatestManifest(older.id);
    expect(() =>
      database.updateSyncProfileAlbums(older.id, [zetaId, zetaId]),
    ).toThrow("distinct albums");
    expect(
      database.listSyncProfiles().find((profile) => profile.id === older.id)
        ?.albumIds,
    ).toEqual([zetaId]);
    expect(
      database.updateSyncProfileAlbums(older.id, [zetaId, alphaId]),
    ).toMatchObject({
      id: older.id,
      name: "Older DAP",
      targetPath: "/targets/older",
      albumIds: [alphaId, zetaId],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(database.getLatestManifest(older.id)).toEqual(previousManifest);
    expect(() => database.renameSyncProfile(older.id, "   ")).toThrow(
      "between 1 and 100",
    );
    expect(() =>
      database.renameSyncProfile(
        "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
        "Missing DAP",
      ),
    ).toThrow("no longer exists");
    expect(
      database.renameSyncProfile(older.id, "  Pocket DAP  "),
    ).toMatchObject({
      id: older.id,
      name: "Pocket DAP",
      targetPath: "/targets/older",
      albumIds: [alphaId, zetaId],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(database.getLatestManifest(older.id)).toEqual(previousManifest);
    database.close();

    const reopened = new CatalogDatabase(databasePath);
    expect(reopened.listSyncProfiles().map((profile) => profile.name)).toEqual([
      "Road DAP",
      "Pocket DAP",
    ]);
    expect(reopened.listSyncProfiles()[0]?.albums).toHaveLength(2);
    expect(
      reopened.listSyncProfiles().find((profile) => profile.id === older.id)
        ?.albumIds,
    ).toEqual([alphaId, zetaId]);
    reopened.close();
  });
});
