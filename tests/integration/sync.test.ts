import {
  access,
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { MusicMetadataReader } from "../../src/main/adapters/metadata/metadata-reader";
import { DeviceSync } from "../../src/main/application/device-sync";
import {
  pathComparisonKey,
  ScanLibrary,
} from "../../src/main/application/scan-library";
import { LocalMetadataJobRunner } from "../../src/main/jobs/metadata-runner";

const temporary: string[] = [];
const databases: CatalogDatabase[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup(): Promise<{
  directory: string;
  database: CatalogDatabase;
  target: string;
  profileId: string;
  albumId: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-sync-"));
  temporary.push(directory);
  const library = join(directory, "library");
  const target = join(directory, "target");
  await cp(join(process.cwd(), "fixtures", "audio", "album"), library, {
    recursive: true,
  });
  await mkdir(target);
  const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
  databases.push(database);
  const root = database.addLibraryRoot(library, pathComparisonKey(library));
  await new ScanLibrary(
    database,
    new LocalMetadataJobRunner(new MusicMetadataReader()),
  ).execute(root.id);
  const album = database.listAlbums()[0];
  if (!album) throw new Error("Fixture album missing");
  const profile = database.createSyncProfile("Fixture DAP", target, [album.id]);
  return {
    directory,
    database,
    target,
    profileId: profile.id,
    albumId: album.id,
  };
}

describe("deterministic manifest-based sync", () => {
  it("invalidates old previews after a profile revision and refuses revisions during apply", async () => {
    const { database, profileId, albumId } = await setup();
    let releaseCopy: () => void = () => undefined;
    let markCopyStarted: () => void = () => undefined;
    const copyStarted = new Promise<void>((resolve) => {
      markCopyStarted = resolve;
    });
    const copyGate = new Promise<void>((resolve) => {
      releaseCopy = resolve;
    });
    const sync = new DeviceSync(database, {
      beforeCopy: async () => {
        markCopyStarted();
        await copyGate;
      },
    });
    const stale = await sync.plan(profileId);
    expect(sync.updateProfileAlbums(profileId, [albumId]).albumIds).toEqual([
      albumId,
    ]);
    await expect(sync.apply(stale.id, stale.confirmationToken)).rejects.toThrow(
      "current preview",
    );

    const fresh = await sync.plan(profileId);
    const applying = sync.apply(fresh.id, fresh.confirmationToken);
    await copyStarted;
    expect(() => sync.updateProfileAlbums(profileId, [albumId])).toThrow(
      "active sync",
    );
    releaseCopy();
    await expect(applying).resolves.toMatchObject({
      copied: 2,
      unchanged: 0,
      errors: [],
    });
  });

  it("matches the golden plan, applies verified copies, leaves unknown files, and repeats as a no-op", async () => {
    const { database, target, profileId } = await setup();
    const unknown = join(target, "user-note.txt");
    await writeFile(unknown, "keep me");
    const sync = new DeviceSync(database);
    const first = await sync.plan(profileId);
    const repeatedPlan = await sync.plan(profileId);
    expect(repeatedPlan).toEqual(first);
    expect(first).toMatchObject({
      copies: [
        {
          relativeDestination: join(
            "Fixture Artist",
            "Fixture Album",
            "01-01 First Track.mp3",
          ),
        },
        {
          relativeDestination: join(
            "Fixture Artist",
            "Fixture Album",
            "01-02 Second Track.flac",
          ),
        },
      ],
      unchanged: [],
      conflicts: [],
      errors: [],
    });
    const result = await sync.apply(first.id, first.confirmationToken);
    expect(result).toMatchObject({ copied: 2, unchanged: 0, errors: [] });
    expect(await readFile(unknown, "utf8")).toBe("keep me");
    expect(
      JSON.parse(
        await readFile(join(target, ".outgroove", "manifest.json"), "utf8"),
      ),
    ).toMatchObject({ version: 1, profileId });
    expect(await readFile(join(target, "Outgroove.m3u8"), "utf8")).toContain(
      "#EXTM3U",
    );
    const noOp = await sync.plan(profileId);
    expect(noOp.copies).toHaveLength(0);
    expect(noOp.unchanged).toHaveLength(2);
    database.close();
  });

  it("plans, applies, manifests, and repeats an explicit multi-album selection deterministically", async () => {
    const { directory, database, target, albumId } = await setup();
    const root = database.listLibraryRoots()[0];
    const source = database.getAlbum(albumId)?.tracks[0]?.path;
    if (!root || !source) throw new Error("Sync fixture source missing");
    const secondPath = join(directory, "library", "second-album.mp3");
    await copyFile(source, secondPath);
    const info = await stat(secondPath);
    database.upsertScannedFile(root.id, pathComparisonKey(secondPath), {
      path: secondPath,
      size: info.size,
      modifiedMs: info.mtimeMs,
      format: "MPEG",
      durationSeconds: 1,
      tags: {
        title: "Other Track",
        album: "Second Album",
        artist: "Other Artist",
        albumArtist: "Other Artist",
        trackNumber: 1,
        discNumber: 1,
        year: "2025",
      },
      nativeTags: [],
    });
    const secondAlbum = database
      .listAlbums()
      .find((album) => album.title === "Second Album");
    if (!secondAlbum) throw new Error("Second sync album missing");
    expect(() =>
      database.createSyncProfile("Duplicate selection", target, [
        albumId,
        albumId,
      ]),
    ).toThrow("distinct albums");
    const profile = database.createSyncProfile("Two albums", target, [
      secondAlbum.id,
      albumId,
    ]);
    expect(profile.albumIds).toEqual([...profile.albumIds].sort());
    expect(database.getSyncProfile(profile.id)?.album_ids).toEqual(
      profile.albumIds,
    );
    const sync = new DeviceSync(database);
    const first = await sync.plan(profile.id);
    await expect(sync.plan(profile.id)).resolves.toEqual(first);
    expect(first.copies).toHaveLength(3);
    expect(first.conflicts).toEqual([]);
    expect(first.errors).toEqual([]);
    const result = await sync.apply(first.id, first.confirmationToken);
    expect(result).toMatchObject({ copied: 3, unchanged: 0, errors: [] });
    const playlist = await readFile(join(target, "Outgroove.m3u8"), "utf8");
    expect(playlist).toContain("Fixture Album");
    expect(playlist).toContain("Second Album");
    const manifest = JSON.parse(
      await readFile(join(target, ".outgroove", "manifest.json"), "utf8"),
    ) as { entries: unknown[] };
    expect(manifest.entries).toHaveLength(3);
    const noOp = await sync.plan(profile.id);
    expect(noOp.copies).toHaveLength(0);
    expect(noOp.unchanged).toHaveLength(3);
    database.close();
  });

  it("refuses an unknown file at a generated destination", async () => {
    const { database, target, profileId } = await setup();
    const destination = join(
      target,
      "Fixture Artist",
      "Fixture Album",
      "01-01 First Track.mp3",
    );
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "user owned");
    const plan = await new DeviceSync(database).plan(profileId);
    expect(plan.conflicts).toEqual([
      expect.stringContaining("Unknown target file"),
    ]);
    expect(await readFile(destination, "utf8")).toBe("user owned");
    database.close();
  });

  it("reports an unavailable selected album in the preview instead of silently omitting it", async () => {
    const { database, profileId } = await setup();
    database.connection
      .prepare("UPDATE audio_files SET scan_state='missing'")
      .run();
    const plan = await new DeviceSync(database).plan(profileId);
    expect(plan.copies).toEqual([]);
    expect(plan.unchanged).toEqual([]);
    expect(plan.errors).toEqual([
      "Selected album “Fixture Album” is unavailable.",
    ]);
    database.close();
  });

  it("reports a destination collision across selected albums before apply", async () => {
    const { directory, database, target, albumId } = await setup();
    const root = database.listLibraryRoots()[0];
    const original = database.getAlbum(albumId)?.tracks[0];
    if (!root || !original) throw new Error("Collision fixture missing");
    const duplicatePath = join(directory, "library", "collision.mp3");
    await copyFile(original.path, duplicatePath);
    const info = await stat(duplicatePath);
    const duplicateFileId = database.upsertScannedFile(
      root.id,
      pathComparisonKey(duplicatePath),
      {
        ...original,
        path: duplicatePath,
        size: info.size,
        modifiedMs: info.mtimeMs,
      },
    );
    const duplicateAlbumId = "00000000-0000-4000-8000-000000000001";
    database.connection
      .prepare(
        `INSERT INTO albums (id, grouping_key, title, album_artist)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        duplicateAlbumId,
        "collision-fixture",
        original.tags.album,
        original.tags.albumArtist,
      );
    database.connection
      .prepare("UPDATE tracks SET album_id=? WHERE file_id=?")
      .run(duplicateAlbumId, duplicateFileId);
    const profile = database.createSyncProfile("Collision", target, [
      albumId,
      duplicateAlbumId,
    ]);
    const sync = new DeviceSync(database);
    const plan = await sync.plan(profile.id);
    expect(plan.conflicts).toEqual([
      expect.stringContaining("Destination collision"),
    ]);
    await expect(sync.apply(plan.id, plan.confirmationToken)).rejects.toThrow(
      "Resolve sync conflicts",
    );
    database.close();
  });

  it("does not clobber an unknown file that appears after preview", async () => {
    const { database, target, profileId } = await setup();
    let created = false;
    const sync = new DeviceSync(database, {
      beforeCopy: async (item) => {
        if (created) return;
        created = true;
        const destination = join(target, item.relativeDestination);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, "appeared after preview");
      },
    });
    const plan = await sync.plan(profileId);
    const result = await sync.apply(plan.id, plan.confirmationToken);
    expect(result.errors).toEqual([
      expect.stringContaining("appeared after preview"),
    ]);
    const firstCopy = plan.copies[0];
    if (!firstCopy) throw new Error("Fixture copy missing");
    const destination = join(target, firstCopy.relativeDestination);
    expect(await readFile(destination, "utf8")).toBe("appeared after preview");
    await expect(
      access(join(target, ".outgroove", "manifest.json")),
    ).rejects.toThrow();
    database.close();
  });

  it("detects a source changed after preview and does not commit a manifest", async () => {
    const { database, target, profileId } = await setup();
    const sync = new DeviceSync(database);
    const plan = await sync.plan(profileId);
    const source = plan.copies[0]?.sourcePath;
    if (!source) throw new Error("Plan source missing");
    await writeFile(
      source,
      Buffer.concat([await readFile(source), Buffer.from("changed")]),
    );
    const result = await sync.apply(plan.id, plan.confirmationToken);
    expect(result.errors).toEqual([
      expect.stringContaining("Source changed after preview"),
    ]);
    await expect(
      access(join(target, ".outgroove", "manifest.json")),
    ).rejects.toThrow();
    database.close();
  });

  it("stops an interrupted copy locally and writes no playlist or manifest", async () => {
    const { database, target, profileId } = await setup();
    const sync = new DeviceSync(database, {
      beforeCopy: () => Promise.reject(new Error("simulated disconnect")),
    });
    const plan = await sync.plan(profileId);
    const result = await sync.apply(plan.id, plan.confirmationToken);
    expect(result.errors).toEqual([
      expect.stringContaining("simulated disconnect"),
    ]);
    await expect(access(join(target, "Outgroove.m3u8"))).rejects.toThrow();
    await expect(
      access(join(target, ".outgroove", "manifest.json")),
    ).rejects.toThrow();
    database.close();
  });

  it("writes the manifest last and does not record success if that final stage fails", async () => {
    const { database, target, profileId } = await setup();
    const sync = new DeviceSync(database, {
      beforeManifest: () =>
        Promise.reject(new Error("simulated manifest failure")),
    });
    const plan = await sync.plan(profileId);
    await expect(sync.apply(plan.id, plan.confirmationToken)).rejects.toThrow(
      "simulated manifest failure",
    );
    expect((await stat(join(target, "Outgroove.m3u8"))).isFile()).toBe(true);
    await expect(
      access(join(target, ".outgroove", "manifest.json")),
    ).rejects.toThrow();
    expect(database.getLatestManifest(profileId)).toBeUndefined();
    database.close();
  });
});
