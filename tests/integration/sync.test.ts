import {
  access,
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  utimes,
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

async function firstRecovery(
  sync: DeviceSync,
): Promise<Awaited<ReturnType<DeviceSync["previewRecovery"]>>> {
  const summary = sync.listRecoverySummaries()[0];
  if (!summary) throw new Error("Sync recovery summary missing.");
  return sync.previewRecovery(summary.runId);
}

describe("deterministic manifest-based sync", () => {
  it("detects a copy-stage process interruption and recovers after reconnect", async () => {
    const { directory, database, target, profileId } = await setup();
    let markInstalled: () => void = () => undefined;
    const installed = new Promise<void>((resolve) => {
      markInstalled = resolve;
    });
    const neverResume = new Promise<void>(() => undefined);
    const sync = new DeviceSync(database, {
      afterCopyInstalled: async () => {
        markInstalled();
        await neverResume;
      },
    });
    const plan = await sync.plan(profileId);
    void sync.apply(plan.id, plan.confirmationToken);
    await installed;
    const firstDestination = plan.copies[0]?.relativeDestination;
    if (!firstDestination) throw new Error("Recovery fixture copy missing.");
    expect(await readFile(join(target, firstDestination))).toBeDefined();
    database.close();

    const reopened = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    databases.push(reopened);
    const recoverySync = new DeviceSync(reopened);
    const disconnected = `${target}-disconnected`;
    await rename(target, disconnected);
    const unavailable = await firstRecovery(recoverySync);
    expect(unavailable).toMatchObject({
      profileId,
      phase: "copying",
      mode: "rollback",
      canRecover: false,
    });
    await rename(disconnected, target);
    const preview = await firstRecovery(recoverySync);
    expect(preview.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: join(target, firstDestination),
          action: "remove",
        }),
      ]),
    );
    await expect(
      recoverySync.recover(preview.runId, preview.confirmationToken),
    ).resolves.toMatchObject({ complete: true, recovered: 1, errors: [] });
    await expect(access(join(target, firstDestination))).rejects.toThrow();
    expect(reopened.listSyncRuns()).toEqual([]);
    const retry = await recoverySync.plan(profileId);
    expect(retry.conflicts).toEqual([]);
    expect(retry.copies).toHaveLength(2);
  });

  it("restores manifest-owned bytes after a replacement process interruption", async () => {
    const { directory, database, target, profileId } = await setup();
    const initial = new DeviceSync(database);
    const initialPlan = await initial.plan(profileId);
    await initial.apply(initialPlan.id, initialPlan.confirmationToken);
    const first = initialPlan.copies[0];
    if (!first) throw new Error("Replacement recovery fixture missing.");
    const destination = join(target, first.relativeDestination);
    const previousBytes = await readFile(destination);
    const sourceInfo = await stat(first.sourcePath);
    await writeFile(
      first.sourcePath,
      Buffer.concat([await readFile(first.sourcePath), Buffer.from("changed")]),
    );
    const changedTime = new Date(sourceInfo.mtimeMs + 2_000);
    await utimes(first.sourcePath, changedTime, changedTime);

    let markInstalled: () => void = () => undefined;
    const installed = new Promise<void>((resolve) => {
      markInstalled = resolve;
    });
    const neverResume = new Promise<void>(() => undefined);
    const interrupted = new DeviceSync(database, {
      afterCopyInstalled: async () => {
        markInstalled();
        await neverResume;
      },
    });
    const replacement = await interrupted.plan(profileId);
    void interrupted.apply(replacement.id, replacement.confirmationToken);
    await installed;
    expect(await readFile(destination)).not.toEqual(previousBytes);
    database.close();

    const reopened = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    databases.push(reopened);
    const recoverySync = new DeviceSync(reopened);
    const preview = await firstRecovery(recoverySync);
    expect(preview.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: destination, action: "restore" }),
      ]),
    );
    await recoverySync.recover(preview.runId, preview.confirmationToken);
    expect(await readFile(destination)).toEqual(previousBytes);
    expect(reopened.listSyncHistory(profileId)).toHaveLength(1);
  });

  it("rolls back copies and playlist after a finalization interruption", async () => {
    const { directory, database, target, profileId } = await setup();
    let markFinalizing: () => void = () => undefined;
    const finalizing = new Promise<void>((resolve) => {
      markFinalizing = resolve;
    });
    const neverResume = new Promise<void>(() => undefined);
    const sync = new DeviceSync(database, {
      beforeManifest: async () => {
        markFinalizing();
        await neverResume;
      },
    });
    const plan = await sync.plan(profileId);
    void sync.apply(plan.id, plan.confirmationToken);
    await finalizing;
    expect(await readFile(join(target, "Outgroove.m3u8"), "utf8")).toContain(
      "#EXTM3U",
    );
    database.close();

    const reopened = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    databases.push(reopened);
    const recoverySync = new DeviceSync(reopened);
    const preview = await firstRecovery(recoverySync);
    expect(preview).toMatchObject({ phase: "finalizing", mode: "rollback" });
    expect(preview.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: join(target, "Outgroove.m3u8"),
          action: "remove",
        }),
      ]),
    );
    await recoverySync.recover(preview.runId, preview.confirmationToken);
    await expect(access(join(target, "Outgroove.m3u8"))).rejects.toThrow();
    await expect(
      access(join(target, ".outgroove", "manifest.json")),
    ).rejects.toThrow();
    for (const item of plan.copies)
      await expect(
        access(join(target, item.relativeDestination)),
      ).rejects.toThrow();
    expect(reopened.listSyncHistory(profileId)).toEqual([]);
  });

  it("rolls back a target manifest installed before SQLite commit", async () => {
    const { directory, database, target, profileId } = await setup();
    let markManifestInstalled: () => void = () => undefined;
    const manifestInstalled = new Promise<void>((resolve) => {
      markManifestInstalled = resolve;
    });
    const neverResume = new Promise<void>(() => undefined);
    const sync = new DeviceSync(database, {
      afterTargetManifestInstalled: async () => {
        markManifestInstalled();
        await neverResume;
      },
    });
    const plan = await sync.plan(profileId);
    void sync.apply(plan.id, plan.confirmationToken);
    await manifestInstalled;
    expect(
      await readFile(join(target, ".outgroove", "manifest.json"), "utf8"),
    ).toContain(profileId);
    expect(database.listSyncHistory(profileId)).toEqual([]);
    database.close();

    const reopened = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    databases.push(reopened);
    const recoverySync = new DeviceSync(reopened);
    const preview = await firstRecovery(recoverySync);
    expect(preview.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: join(target, ".outgroove", "manifest.json"),
          action: "remove",
        }),
      ]),
    );
    await recoverySync.recover(preview.runId, preview.confirmationToken);
    await expect(
      access(join(target, ".outgroove", "manifest.json")),
    ).rejects.toThrow();
    expect(reopened.listSyncHistory(profileId)).toEqual([]);
  });

  it("leaves a destination changed after process interruption untouched", async () => {
    const { directory, database, target, profileId } = await setup();
    let markInstalled: () => void = () => undefined;
    const installed = new Promise<void>((resolve) => {
      markInstalled = resolve;
    });
    const neverResume = new Promise<void>(() => undefined);
    const sync = new DeviceSync(database, {
      afterCopyInstalled: async () => {
        markInstalled();
        await neverResume;
      },
    });
    const plan = await sync.plan(profileId);
    void sync.apply(plan.id, plan.confirmationToken);
    await installed;
    const firstDestination = plan.copies[0]?.relativeDestination;
    if (!firstDestination) throw new Error("External-change fixture missing.");
    const destination = join(target, firstDestination);
    await writeFile(destination, "external replacement");
    database.close();

    const reopened = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    databases.push(reopened);
    const recoverySync = new DeviceSync(reopened);
    const preview = await firstRecovery(recoverySync);
    expect(preview.warnings).toEqual([
      expect.stringContaining("will remain untouched"),
    ]);
    expect(preview.actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: destination, action: "remove" }),
      ]),
    );
    await expect(
      recoverySync.recover(preview.runId, preview.confirmationToken),
    ).resolves.toMatchObject({
      complete: true,
      errors: [expect.stringContaining("left untouched")],
    });
    expect(await readFile(destination, "utf8")).toBe("external replacement");
    const retry = await recoverySync.plan(profileId);
    expect(retry.conflicts).toEqual([
      expect.stringContaining("Unknown target file"),
    ]);
  });

  it("refuses recovery through a target path replaced by a symbolic link", async () => {
    const { directory, database, target, profileId } = await setup();
    let markInstalled: () => void = () => undefined;
    const installed = new Promise<void>((resolve) => {
      markInstalled = resolve;
    });
    const neverResume = new Promise<void>(() => undefined);
    const sync = new DeviceSync(database, {
      afterCopyInstalled: async () => {
        markInstalled();
        await neverResume;
      },
    });
    const plan = await sync.plan(profileId);
    void sync.apply(plan.id, plan.confirmationToken);
    await installed;
    const firstDestination = plan.copies[0]?.relativeDestination;
    const firstSegment = firstDestination?.split(/[\\/]/u)[0];
    if (!firstSegment) throw new Error("Symlink recovery fixture missing.");
    const originalDirectory = join(target, firstSegment);
    const retainedDirectory = join(target, "retained-original");
    const outside = join(directory, "outside");
    await rename(originalDirectory, retainedDirectory);
    await mkdir(outside);
    await symlink(outside, originalDirectory, "dir");
    database.close();

    const reopened = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    databases.push(reopened);
    const recoverySync = new DeviceSync(reopened);
    const preview = await firstRecovery(recoverySync);
    expect(preview.canRecover).toBe(false);
    expect(preview.warnings).toEqual([
      expect.stringContaining("symbolic link"),
    ]);
    await expect(
      recoverySync.recover(preview.runId, preview.confirmationToken),
    ).rejects.toThrow("before applying recovery");
    expect(await access(outside)).toBeUndefined();
  });

  it("finishes internal cleanup without rolling back a committed manifest", async () => {
    const { directory, database, target, profileId } = await setup();
    let markCommitted: () => void = () => undefined;
    const committed = new Promise<void>((resolve) => {
      markCommitted = resolve;
    });
    const neverResume = new Promise<void>(() => undefined);
    const sync = new DeviceSync(database, {
      afterManifestCommitted: async () => {
        markCommitted();
        await neverResume;
      },
    });
    const plan = await sync.plan(profileId);
    void sync.apply(plan.id, plan.confirmationToken);
    await committed;
    database.close();

    const reopened = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    databases.push(reopened);
    const recoverySync = new DeviceSync(reopened);
    const preview = await firstRecovery(recoverySync);
    expect(preview).toMatchObject({
      mode: "committed-cleanup",
      canRecover: true,
    });
    await expect(
      recoverySync.recover(preview.runId, preview.confirmationToken),
    ).resolves.toMatchObject({ complete: true });
    expect(reopened.listSyncHistory(profileId)).toHaveLength(1);
    expect(
      await readFile(join(target, ".outgroove", "manifest.json"), "utf8"),
    ).toContain(profileId);
    for (const item of plan.copies)
      expect(
        await readFile(join(target, item.relativeDestination)),
      ).toBeDefined();
  });

  it("cancels between copies, rolls back this run, and retries the same preview", async () => {
    const { database, target, profileId } = await setup();
    let hookCalls = 0;
    let releaseSecondCopy: () => void = () => undefined;
    let markSecondCopyStarted: () => void = () => undefined;
    const secondCopyStarted = new Promise<void>((resolve) => {
      markSecondCopyStarted = resolve;
    });
    const secondCopyGate = new Promise<void>((resolve) => {
      releaseSecondCopy = resolve;
    });
    const sync = new DeviceSync(database, {
      beforeCopy: async () => {
        hookCalls++;
        if (hookCalls === 2) {
          markSecondCopyStarted();
          await secondCopyGate;
        }
      },
    });
    const plan = await sync.plan(profileId);
    const applying = sync.apply(plan.id, plan.confirmationToken);
    await secondCopyStarted;
    expect(sync.cancel(plan.id)).toEqual({
      planId: plan.id,
      accepted: true,
      state: "cancelling",
    });
    releaseSecondCopy();
    await expect(applying).resolves.toMatchObject({
      outcome: "cancelled",
      copied: 1,
      rolledBack: 1,
      errors: [],
    });
    for (const item of plan.copies)
      await expect(
        access(join(target, item.relativeDestination)),
      ).rejects.toThrow();
    await expect(access(join(target, "Outgroove.m3u8"))).rejects.toThrow();
    await expect(
      access(join(target, ".outgroove", "manifest.json")),
    ).rejects.toThrow();
    expect(database.listSyncHistory(profileId)).toEqual([]);
    expect(sync.cancel(plan.id)).toEqual({
      planId: plan.id,
      accepted: false,
      state: "not-running",
    });
    await expect(
      sync.apply(plan.id, plan.confirmationToken),
    ).resolves.toMatchObject({
      outcome: "completed",
      copied: 2,
      rolledBack: 0,
      errors: [],
    });
    expect(database.listSyncHistory(profileId)).toHaveLength(1);
  });

  it("refuses cancellation after manifest finalization begins", async () => {
    const { database, profileId } = await setup();
    let releaseManifest: () => void = () => undefined;
    let markManifestStarted: () => void = () => undefined;
    const manifestStarted = new Promise<void>((resolve) => {
      markManifestStarted = resolve;
    });
    const manifestGate = new Promise<void>((resolve) => {
      releaseManifest = resolve;
    });
    const sync = new DeviceSync(database, {
      beforeManifest: async () => {
        markManifestStarted();
        await manifestGate;
      },
    });
    const plan = await sync.plan(profileId);
    const applying = sync.apply(plan.id, plan.confirmationToken);
    await manifestStarted;
    expect(sync.cancel(plan.id)).toEqual({
      planId: plan.id,
      accepted: false,
      state: "finalizing",
    });
    releaseManifest();
    await expect(applying).resolves.toMatchObject({ outcome: "completed" });
  });

  it("restores earlier manifest-owned copies when a replacement run is cancelled", async () => {
    const { database, target, profileId } = await setup();
    const initialSync = new DeviceSync(database);
    const initialPlan = await initialSync.plan(profileId);
    await initialSync.apply(initialPlan.id, initialPlan.confirmationToken);
    const manifestPath = join(target, ".outgroove", "manifest.json");
    const playlistPath = join(target, "Outgroove.m3u8");
    const manifestBefore = await readFile(manifestPath);
    const playlistBefore = await readFile(playlistPath);
    const targetBefore = new Map<string, Buffer>();
    for (const item of initialPlan.copies) {
      targetBefore.set(
        item.relativeDestination,
        await readFile(join(target, item.relativeDestination)),
      );
      const sourceInfo = await stat(item.sourcePath);
      await writeFile(
        item.sourcePath,
        Buffer.concat([
          await readFile(item.sourcePath),
          Buffer.from("changed"),
        ]),
      );
      const changedTime = new Date(sourceInfo.mtimeMs + 2_000);
      await utimes(item.sourcePath, changedTime, changedTime);
    }

    let copyNumber = 0;
    let releaseSecondCopy: () => void = () => undefined;
    let markSecondCopyStarted: () => void = () => undefined;
    const secondCopyStarted = new Promise<void>((resolve) => {
      markSecondCopyStarted = resolve;
    });
    const secondCopyGate = new Promise<void>((resolve) => {
      releaseSecondCopy = resolve;
    });
    const cancellingSync = new DeviceSync(database, {
      beforeCopy: async () => {
        copyNumber++;
        if (copyNumber === 2) {
          markSecondCopyStarted();
          await secondCopyGate;
        }
      },
    });
    const replacementPlan = await cancellingSync.plan(profileId);
    expect(replacementPlan.copies).toHaveLength(2);
    const applying = cancellingSync.apply(
      replacementPlan.id,
      replacementPlan.confirmationToken,
    );
    await secondCopyStarted;
    expect(cancellingSync.cancel(replacementPlan.id).accepted).toBe(true);
    releaseSecondCopy();
    await expect(applying).resolves.toMatchObject({
      outcome: "cancelled",
      copied: 1,
      rolledBack: 1,
      errors: [],
    });
    for (const item of replacementPlan.copies)
      expect(await readFile(join(target, item.relativeDestination))).toEqual(
        targetBefore.get(item.relativeDestination),
      );
    expect(await readFile(manifestPath)).toEqual(manifestBefore);
    expect(await readFile(playlistPath)).toEqual(playlistBefore);
    expect(database.listSyncHistory(profileId)).toHaveLength(1);
  });

  it("does not remove a completed destination changed externally before rollback", async () => {
    const { database, target, profileId } = await setup();
    let firstDestination: string | undefined;
    let copyNumber = 0;
    let releaseSecondCopy: () => void = () => undefined;
    let markSecondCopyStarted: () => void = () => undefined;
    const secondCopyStarted = new Promise<void>((resolve) => {
      markSecondCopyStarted = resolve;
    });
    const secondCopyGate = new Promise<void>((resolve) => {
      releaseSecondCopy = resolve;
    });
    const sync = new DeviceSync(database, {
      beforeCopy: async (item) => {
        copyNumber++;
        if (copyNumber === 1)
          firstDestination = join(target, item.relativeDestination);
        if (copyNumber === 2) {
          if (!firstDestination) throw new Error("First destination missing.");
          await writeFile(firstDestination, "external replacement");
          markSecondCopyStarted();
          await secondCopyGate;
        }
      },
    });
    const plan = await sync.plan(profileId);
    const applying = sync.apply(plan.id, plan.confirmationToken);
    await secondCopyStarted;
    sync.cancel(plan.id);
    releaseSecondCopy();
    await expect(applying).resolves.toMatchObject({
      outcome: "cancelled",
      copied: 1,
      rolledBack: 0,
      errors: [expect.stringContaining("changed externally")],
    });
    if (!firstDestination) throw new Error("First destination missing.");
    expect(await readFile(firstDestination, "utf8")).toBe(
      "external replacement",
    );
    expect(database.listSyncHistory(profileId)).toEqual([]);
  });

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
    expect(database.renameSyncProfile(profileId, "Pocket DAP").name).toBe(
      "Pocket DAP",
    );
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
    expect(result).toMatchObject({ outcome: "failed", rolledBack: 0 });
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
