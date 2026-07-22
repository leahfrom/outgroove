import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { ManageLibraryRoots } from "../../src/main/application/manage-library-roots";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

describe("watched Library root removal", () => {
  it("previews, hides, and reactivates a root without deleting audio or durable state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-root-remove-"));
    temporary.push(directory);
    const audioPath = join(directory, "track.mp3");
    await writeFile(audioPath, "redistributable fixture bytes");
    const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    const root = database.addLibraryRoot(directory, directory);
    database.upsertScannedFile(root.id, audioPath, {
      path: audioPath,
      size: 27,
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
    database.upsertScanError(
      root.id,
      join(directory, "broken.flac"),
      join(directory, "broken.flac"),
      0,
      0,
      "Unreadable fixture",
    );
    database.connection
      .prepare(
        `INSERT INTO scan_directory_errors
         (root_id, path, path_key, message, scanned_at)
         VALUES (?, ?, ?, 'Permission denied', '2026-01-01')`,
      )
      .run(
        root.id,
        join(directory, "unreadable"),
        join(directory, "unreadable"),
      );
    const album = database.listAlbums()[0];
    const file = album?.tracks[0];
    if (!album || !file) throw new Error("Fixture catalog missing");
    database.connection
      .prepare(
        `INSERT INTO edit_operations
         (id, album_id, proposed_title, confirmation_hash, state, created_at, completed_at)
         VALUES ('operation', ?, 'Album', 'hash', 'completed', '2026-01-01', '2026-01-01')`,
      )
      .run(album.id);
    database.connection
      .prepare(
        `INSERT INTO tag_snapshots
         (id, operation_id, file_id, before_tags_json, after_tags_json, verified)
         VALUES ('snapshot', 'operation', ?, '{}', '{}', 1)`,
      )
      .run(file.id);
    database.createSyncProfile("Fixture DAP", join(directory, "target"), [
      album.id,
    ]);
    const completedJob = database.createScanJob(root.id);
    database.updateScanJob(completedJob.id, {
      state: "completed",
      finished: true,
    });

    const service = new ManageLibraryRoots(database);
    const preview = service.previewRemoval(root.id);
    expect(preview).toMatchObject({
      rootId: root.id,
      path: directory,
      visibleTracks: 1,
      albumsHidden: 1,
      scanProblemsHidden: 2,
    });
    expect(database.listLibraryRoots()).toHaveLength(1);

    const result = service.applyRemoval(
      preview.operationId,
      preview.confirmationToken,
    );
    expect(result).toMatchObject({
      visibleTracksHidden: 1,
      albumsHidden: 1,
      audioFilesDeleted: 0,
    });
    expect(await readFile(audioPath, "utf8")).toBe(
      "redistributable fixture bytes",
    );
    expect(database.listLibraryRoots()).toHaveLength(0);
    expect(database.listAlbums()).toHaveLength(0);
    expect(
      database.connection
        .prepare("SELECT COUNT(*) FROM audio_files")
        .pluck()
        .get(),
    ).toBe(2);
    expect(
      database.connection
        .prepare("SELECT COUNT(*) FROM edit_operations")
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      database.connection
        .prepare("SELECT COUNT(*) FROM tag_snapshots")
        .pluck()
        .get(),
    ).toBe(1);
    expect(
      database.connection
        .prepare("SELECT COUNT(*) FROM sync_profiles")
        .pluck()
        .get(),
    ).toBe(1);
    expect(database.getLatestScanJob()).toBeNull();
    expect(
      database.connection.prepare("SELECT COUNT(*) FROM jobs").pluck().get(),
    ).toBe(1);

    const reactivated = database.addLibraryRoot(directory, directory);
    expect(reactivated.id).toBe(root.id);
    expect(database.listAlbums()).toHaveLength(0);
    database.beginScan(root.id);
    expect(
      database.recordScanDiscoveryBatch(root.id, [
        {
          kind: "file",
          path: audioPath,
          pathKey: audioPath,
          size: 27,
          modifiedMs: 1,
        },
      ]),
    ).toEqual({ changed: 0, unchanged: 1 });
    database.finishScan(root.id);
    expect(database.listAlbums()).toHaveLength(1);
    database.close();
  });

  it("does not claim a multi-root album will disappear when another visible track remains", () => {
    const database = new CatalogDatabase(":memory:");
    const firstRoot = database.addLibraryRoot("/first", "/first");
    const secondRoot = database.addLibraryRoot("/second", "/second");
    const file = (rootId: string, path: string, trackNumber: number) =>
      database.upsertScannedFile(rootId, path, {
        path,
        size: 10,
        modifiedMs: trackNumber,
        format: "MPEG",
        durationSeconds: 1,
        tags: {
          title: `Track ${trackNumber}`,
          album: "Shared Album",
          artist: "Artist",
          albumArtist: "Artist",
          trackNumber,
          discNumber: 1,
          year: "2026",
        },
        nativeTags: [],
      });
    file(firstRoot.id, "/first/one.mp3", 1);
    file(secondRoot.id, "/second/two.mp3", 2);

    const service = new ManageLibraryRoots(database);
    const preview = service.previewRemoval(firstRoot.id);
    expect(preview).toMatchObject({ visibleTracks: 1, albumsHidden: 0 });
    service.applyRemoval(preview.operationId, preview.confirmationToken);
    expect(database.listAlbums()).toMatchObject([
      { title: "Shared Album", tracks: [{ path: "/second/two.mp3" }] },
    ]);
    database.close();
  });

  it("rejects active scans and stale confirmations without changing the root", () => {
    const database = new CatalogDatabase(":memory:");
    const root = database.addLibraryRoot("/fixture", "/fixture");
    const service = new ManageLibraryRoots(database);
    const active = database.createScanJob(root.id);
    database.updateScanJob(active.id, { state: "running" });
    expect(() => service.previewRemoval(root.id)).toThrow("active scan");
    database.updateScanJob(active.id, { state: "cancelled", finished: true });
    const preview = service.previewRemoval(root.id);
    expect(() =>
      service.applyRemoval(preview.operationId, "stale-token-long-enough"),
    ).toThrow("current preview");
    const replacementPreview = service.previewRemoval(root.id);
    expect(() =>
      service.applyRemoval(preview.operationId, preview.confirmationToken),
    ).toThrow("current preview");
    database.upsertScannedFile(root.id, "/fixture/new.mp3", {
      path: "/fixture/new.mp3",
      size: 1,
      modifiedMs: 1,
      format: "MPEG",
      durationSeconds: 1,
      tags: {
        title: "New",
        album: "New",
        artist: "Artist",
        albumArtist: "Artist",
        trackNumber: 1,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [],
    });
    expect(() =>
      service.applyRemoval(
        replacementPreview.operationId,
        replacementPreview.confirmationToken,
      ),
    ).toThrow("changed after preview");
    expect(database.listLibraryRoots()).toHaveLength(1);
    database.close();
  });
});
