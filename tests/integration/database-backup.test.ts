import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { DatabaseBackupService } from "../../src/main/application/database-backup";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

describe("database backup and restore", () => {
  it("exports a verified snapshot without changing the live database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-export-"));
    temporary.push(directory);
    const livePath = join(directory, "live.sqlite3");
    const exportPath = join(directory, "export.sqlite3");
    const live = new CatalogDatabase(livePath);
    live.addLibraryRoot("/current/library", "/current/library");
    const service = new DatabaseBackupService(live, livePath);
    await expect(service.exportTo(exportPath)).resolves.toEqual({
      path: exportPath,
    });
    expect(live.listLibraryRoots()).toHaveLength(1);
    const exported = new CatalogDatabase(exportPath);
    expect(exported.listLibraryRoots()[0]?.path).toBe("/current/library");
    exported.close();
    live.close();
  });

  it("previews, confirms, verifies, and preserves a rollback backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-restore-"));
    temporary.push(directory);
    const livePath = join(directory, "live.sqlite3");
    const selectedPath = join(directory, "selected.sqlite3");
    const live = new CatalogDatabase(livePath);
    live.addLibraryRoot("/current/library", "/current/library");
    const donor = new CatalogDatabase(join(directory, "donor.sqlite3"));
    donor.addLibraryRoot("/restored/library", "/restored/library");
    donor.createSyncProfile(
      "Fixture DAP",
      "/fixture/target",
      createAlbum(donor, "restored-album"),
    );
    await donor.backup(selectedPath);
    donor.close();

    const service = new DatabaseBackupService(live, livePath);
    const preview = await service.previewRestore(selectedPath);
    expect(preview).toMatchObject({
      sourceName: "selected.sqlite3",
      schemaVersion: 10,
      summary: { libraryRoots: 1, albums: 1, tracks: 1, syncProfiles: 1 },
    });
    const result = await service.applyRestore(
      preview.operationId,
      preview.confirmationToken,
    );
    expect(result.restarting).toBe(true);
    const restored = new CatalogDatabase(livePath);
    expect(restored.listLibraryRoots()[0]?.path).toBe("/restored/library");
    restored.close();
    const rollback = new CatalogDatabase(result.rollbackBackupPath);
    expect(rollback.listLibraryRoots()[0]?.path).toBe("/current/library");
    rollback.close();
  });

  it("rejects corrupt input and stale confirmation without closing the live database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-restore-fail-"));
    temporary.push(directory);
    const livePath = join(directory, "live.sqlite3");
    const live = new CatalogDatabase(livePath);
    live.addLibraryRoot("/current/library", "/current/library");
    const service = new DatabaseBackupService(live, livePath);
    const corrupt = join(directory, "corrupt.sqlite3");
    await writeFile(corrupt, "not sqlite");
    await expect(service.previewRestore(corrupt)).rejects.toThrow();

    const valid = join(directory, "valid.sqlite3");
    await live.backup(valid);
    const preview = await service.previewRestore(valid);
    await expect(
      service.applyRestore(preview.operationId, "stale-token-long-enough"),
    ).rejects.toThrow("current preview");
    const root = live.listLibraryRoots()[0];
    if (!root) throw new Error("Fixture root missing");
    const activeJob = live.createScanJob(root.id);
    live.updateScanJob(activeJob.id, { state: "running" });
    await expect(
      service.applyRestore(preview.operationId, preview.confirmationToken),
    ).rejects.toThrow("Cancel active scans");
    expect(live.connection.open).toBe(true);
    expect(live.listLibraryRoots()).toHaveLength(1);
    live.close();
  });
});

function createAlbum(database: CatalogDatabase, suffix: string): string {
  const root = database.listLibraryRoots()[0];
  if (!root) throw new Error("Fixture root missing");
  database.upsertScannedFile(root.id, `/fixture/${suffix}.mp3`, {
    path: `/fixture/${suffix}.mp3`,
    size: 10,
    modifiedMs: 1,
    format: "MPEG",
    durationSeconds: 1,
    tags: {
      title: "Track",
      album: "Album",
      artist: "Artist",
      albumArtist: "Artist",
      trackNumber: 1,
      discNumber: 1,
      year: "2026",
    },
    nativeTags: [],
  });
  const album = database.listAlbums()[0];
  if (!album) throw new Error("Fixture album missing");
  return album.id;
}
