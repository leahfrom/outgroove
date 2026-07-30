import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
import { basename, dirname, join } from "node:path";

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

async function addSecondAlbum(
  directory: string,
  database: CatalogDatabase,
  albumId: string,
): Promise<{ id: string; sourcePath: string }> {
  const root = database.listLibraryRoots()[0];
  const source = database.getAlbum(albumId)?.tracks[0]?.path;
  if (!root || !source) throw new Error("Sync fixture source missing");
  const sourcePath = join(directory, "library", "second-album.mp3");
  await copyFile(source, sourcePath);
  const info = await stat(sourcePath);
  database.upsertScannedFile(root.id, pathComparisonKey(sourcePath), {
    path: sourcePath,
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
  const album = database
    .listAlbums()
    .find((candidate) => candidate.title === "Second Album");
  if (!album) throw new Error("Second sync album missing");
  return { id: album.id, sourcePath };
}

async function firstRecovery(
  sync: DeviceSync,
): Promise<Awaited<ReturnType<DeviceSync["previewRecovery"]>>> {
  const summary = sync.listRecoverySummaries()[0];
  if (!summary) throw new Error("Sync recovery summary missing.");
  return sync.previewRecovery(summary.runId);
}

describe("deterministic manifest-based sync", () => {
  it("removes a reviewed profile without reading or changing target files", async () => {
    const { database, target, profileId, albumId } = await setup();
    const sync = new DeviceSync(database);
    const plan = await sync.plan(profileId);
    await sync.apply(plan.id, plan.confirmationToken);
    const first = plan.copies[0];
    if (!first) throw new Error("Sync removal fixture copy missing.");
    const copiedPath = join(target, first.relativeDestination);
    const before = {
      copied: await readFile(copiedPath),
      playlist: await readFile(join(target, "Outgroove.m3u8")),
      manifest: await readFile(join(target, ".outgroove", "manifest.json")),
    };

    const preview = sync.previewProfileRemoval(profileId);
    expect(preview).toMatchObject({
      profileId,
      profileName: "Fixture DAP",
      targetPath: target,
      successfulSyncs: 1,
      manifestTargets: [
        { targetPath: target, ownedFileCount: plan.copies.length },
      ],
    });
    expect(preview.albums).toHaveLength(1);
    expect(() =>
      sync.applyProfileRemoval(preview.operationId, "wrong-confirmation-token"),
    ).toThrow("no longer matches");

    database.renameSyncProfile(profileId, "Changed after preview");
    expect(() =>
      sync.applyProfileRemoval(preview.operationId, preview.confirmationToken),
    ).toThrow("changed after preview");
    expect(database.getSyncProfile(profileId)).toBeDefined();

    const fresh = sync.previewProfileRemoval(profileId);
    expect(
      sync.applyProfileRemoval(fresh.operationId, fresh.confirmationToken),
    ).toEqual({
      profileId,
      profileName: "Changed after preview",
      removedSuccessfulSyncs: 1,
    });
    expect(database.getSyncProfile(profileId)).toBeUndefined();
    expect(database.listSyncProfiles()).toEqual([]);
    expect(
      database.connection
        .prepare("SELECT COUNT(*) FROM sync_manifests WHERE profile_id=?")
        .pluck()
        .get(profileId),
    ).toBe(0);
    expect(await readFile(copiedPath)).toEqual(before.copied);
    expect(await readFile(join(target, "Outgroove.m3u8"))).toEqual(
      before.playlist,
    );
    expect(await readFile(join(target, ".outgroove", "manifest.json"))).toEqual(
      before.manifest,
    );
    const replacementProfile = database.createSyncProfile(
      "Re-added target",
      target,
      [albumId],
    );
    const replacementPlan = await new DeviceSync(database).plan(
      replacementProfile.id,
      true,
    );
    expect(replacementPlan.removals).toEqual([]);
    expect(replacementPlan.conflicts).toEqual([
      expect.stringContaining("Unknown target file"),
      expect.stringContaining("Unknown target file"),
      expect.stringContaining("Unknown target file"),
      expect.stringContaining("Unknown target file"),
    ]);
  });

  it("blocks profile removal while an interrupted sync needs recovery", async () => {
    const { database, target, profileId } = await setup();
    database.createSyncRun(
      "8d920723-f52b-472b-a6fe-cc910d18ad01",
      profileId,
      target,
    );
    const sync = new DeviceSync(database);

    expect(() => sync.previewProfileRemoval(profileId)).toThrow(
      "Recover this profile's interrupted sync",
    );
    expect(() => database.deleteSyncProfile(profileId)).toThrow(
      "Recover this profile's interrupted sync",
    );
    expect(database.getSyncProfile(profileId)).toBeDefined();
    expect(database.getSyncRunForProfile(profileId)).toBeDefined();
  });

  it("retargets only after confirmation and scopes manifest ownership to that target", async () => {
    const { directory, database, target, profileId } = await setup();
    const sync = new DeviceSync(database);
    const initialPlan = await sync.plan(profileId);
    await sync.apply(initialPlan.id, initialPlan.confirmationToken);
    const firstRelative = initialPlan.copies[0]?.relativeDestination;
    if (!firstRelative) throw new Error("Sync fixture destination missing.");

    const replacement = join(directory, "replacement-target");
    await mkdir(dirname(join(replacement, firstRelative)), { recursive: true });
    await copyFile(
      join(target, firstRelative),
      join(replacement, firstRelative),
    );
    await writeFile(join(replacement, "Outgroove.m3u8"), "user playlist\n");
    const preview = sync.previewProfileTarget(profileId, replacement);
    expect(preview).toMatchObject({
      profileId,
      currentTargetPath: target,
      proposedTargetPath: replacement,
    });
    expect(() =>
      sync.applyProfileTarget(preview.operationId, "wrong-confirmation-token"),
    ).toThrow("no longer matches");
    const retargeted = sync.applyProfileTarget(
      preview.operationId,
      preview.confirmationToken,
    );
    expect(retargeted.targetPath).toBe(replacement);
    await expect(
      sync.apply(initialPlan.id, initialPlan.confirmationToken),
    ).rejects.toThrow("current preview");

    const replacementPlan = await sync.plan(profileId);
    expect(replacementPlan.conflicts).toContain(
      `Unknown target file would be replaced: ${firstRelative}`,
    );
    expect(replacementPlan.conflicts).toContain(
      "Unknown target file would be replaced: Outgroove.m3u8",
    );
    expect(replacementPlan.unchanged).toEqual([]);

    const returnPreview = sync.previewProfileTarget(profileId, target);
    sync.applyProfileTarget(
      returnPreview.operationId,
      returnPreview.confirmationToken,
    );
    const returnPlan = await sync.plan(profileId);
    expect(returnPlan.copies).toEqual([]);
    expect(returnPlan.conflicts).toEqual([]);
    expect(returnPlan.unchanged).toHaveLength(initialPlan.copies.length);
    expect(database.listSyncHistory(profileId)).toHaveLength(1);
  });

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
    // Windows directory symlinks require Developer Mode or elevation. A
    // junction is an unprivileged reparse point and exercises the same
    // recovery containment guard on a normal release-gate machine.
    await symlink(
      outside,
      originalDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
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
    expect(replacementPlan.replacements).toHaveLength(2);
    const applying = cancellingSync.apply(
      replacementPlan.id,
      replacementPlan.confirmationToken,
    );
    await secondCopyStarted;
    expect(cancellingSync.cancel(replacementPlan.id).accepted).toBe(true);
    releaseSecondCopy();
    await expect(applying).resolves.toMatchObject({
      outcome: "cancelled",
      copied: 0,
      replaced: 1,
      rolledBack: 1,
      errors: [],
    });
    for (const item of replacementPlan.replacements)
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
    expect(noOp.hasChanges).toBe(false);
    await expect(sync.apply(noOp.id, noOp.confirmationToken)).rejects.toThrow(
      "no changes",
    );
    database.close();
  });

  it("keeps cleanup off by default and removes only exact obsolete manifest-owned paths after opt-in", async () => {
    const { directory, database, target, profileId, albumId } = await setup();
    const secondAlbum = await addSecondAlbum(directory, database, albumId);
    const sync = new DeviceSync(database);
    sync.updateProfileAlbums(profileId, [albumId, secondAlbum.id]);
    const initial = await sync.plan(profileId);
    const sourceHashes = new Map(
      [...initial.copies].map((item) => [
        item.sourcePath,
        createHash("sha256")
          .update(readFileSync(item.sourcePath))
          .digest("hex"),
      ]),
    );
    await sync.apply(initial.id, initial.confirmationToken);
    const obsolete = initial.copies.filter(
      (item) => item.sourcePath !== secondAlbum.sourcePath,
    );
    const unknown = join(target, "user-note.txt");
    const unmanifested = join(target, "Other Artist", "unowned.txt");
    await writeFile(unknown, "keep unknown");
    await mkdir(dirname(unmanifested), { recursive: true });
    await writeFile(unmanifested, "keep unmanifested");

    sync.updateProfileAlbums(profileId, [secondAlbum.id]);
    const disabled = await sync.plan(profileId);
    expect(disabled.cleanupEnabled).toBe(false);
    expect(disabled.removals).toEqual([]);
    expect(disabled.hasChanges).toBe(false);
    await expect(
      sync.apply(disabled.id, disabled.confirmationToken),
    ).rejects.toThrow("no changes");
    for (const item of obsolete)
      expect(
        await readFile(join(target, item.relativeDestination)),
      ).toBeDefined();

    const enabled = await sync.plan(profileId, true);
    await expect(sync.plan(profileId, true)).resolves.toEqual(enabled);
    expect(enabled.cleanupEnabled).toBe(true);
    expect(enabled.removals.map((item) => item.relativeDestination)).toEqual(
      obsolete.map((item) => item.relativeDestination).sort(),
    );
    expect(enabled.replacements).toEqual([]);
    expect(enabled.unchanged).toHaveLength(1);
    const result = await sync.apply(enabled.id, enabled.confirmationToken);
    expect(result).toMatchObject({
      outcome: "completed",
      copied: 0,
      replaced: 0,
      removed: obsolete.length,
      unchanged: 1,
      errors: [],
    });
    for (const item of obsolete)
      await expect(
        access(join(target, item.relativeDestination)),
      ).rejects.toThrow();
    expect(
      (
        await stat(
          dirname(join(target, obsolete[0]?.relativeDestination ?? "")),
        )
      ).isDirectory(),
    ).toBe(true);
    expect(await readFile(unknown, "utf8")).toBe("keep unknown");
    expect(await readFile(unmanifested, "utf8")).toBe("keep unmanifested");
    const manifest = JSON.parse(
      await readFile(join(target, ".outgroove", "manifest.json"), "utf8"),
    ) as { entries: { relativeDestination: string }[] };
    expect(manifest.entries.map((entry) => entry.relativeDestination)).toEqual([
      expect.stringContaining("Other Track.mp3"),
    ]);
    for (const [sourcePath, hash] of sourceHashes)
      expect(
        createHash("sha256").update(readFileSync(sourcePath)).digest("hex"),
      ).toBe(hash);
  });

  it("distinguishes replacements from removals and refuses changed target or manifest state", async () => {
    const { directory, database, target, profileId, albumId } = await setup();
    const secondAlbum = await addSecondAlbum(directory, database, albumId);
    const sync = new DeviceSync(database);
    sync.updateProfileAlbums(profileId, [albumId, secondAlbum.id]);
    const initial = await sync.plan(profileId);
    await sync.apply(initial.id, initial.confirmationToken);
    sync.updateProfileAlbums(profileId, [secondAlbum.id]);
    const sourceInfo = await stat(secondAlbum.sourcePath);
    await writeFile(
      secondAlbum.sourcePath,
      Buffer.concat([
        await readFile(secondAlbum.sourcePath),
        Buffer.from("replacement"),
      ]),
    );
    const changedTime = new Date(sourceInfo.mtimeMs + 2_000);
    await utimes(secondAlbum.sourcePath, changedTime, changedTime);
    const mixed = await sync.plan(profileId, true);
    expect(mixed.copies).toEqual([]);
    expect(mixed.replacements).toHaveLength(1);
    expect(mixed.removals).toHaveLength(2);

    const removal = mixed.removals[0];
    if (!removal) throw new Error("Removal fixture missing.");
    const removalPath = join(target, removal.relativeDestination);
    const removalBefore = await readFile(removalPath);
    await writeFile(removalPath, "changed target");
    await expect(sync.apply(mixed.id, mixed.confirmationToken)).rejects.toThrow(
      "target changed after preview",
    );
    expect(database.listSyncHistory(profileId)).toHaveLength(1);

    const fresh = await sync.plan(profileId, true);
    expect(fresh.errors).toEqual([
      expect.stringContaining("size no longer matches"),
    ]);
    await expect(sync.apply(fresh.id, fresh.confirmationToken)).rejects.toThrow(
      "Resolve sync conflicts",
    );
    await writeFile(removalPath, removalBefore);
    const valid = await sync.plan(profileId, true);
    expect(valid.errors).toEqual([]);
    const targetManifestPath = join(target, ".outgroove", "manifest.json");
    await writeFile(targetManifestPath, "{}");
    await expect(sync.apply(valid.id, valid.confirmationToken)).rejects.toThrow(
      "manifest is invalid",
    );
  });

  it("forgets already-missing owned paths without deleting unknown files", async () => {
    const { directory, database, target, profileId, albumId } = await setup();
    const secondAlbum = await addSecondAlbum(directory, database, albumId);
    const sync = new DeviceSync(database);
    sync.updateProfileAlbums(profileId, [albumId, secondAlbum.id]);
    const initial = await sync.plan(profileId);
    await sync.apply(initial.id, initial.confirmationToken);
    sync.updateProfileAlbums(profileId, [secondAlbum.id]);
    const obsolete = initial.copies.filter(
      (item) => item.sourcePath !== secondAlbum.sourcePath,
    );
    const missing = obsolete[0];
    if (!missing) throw new Error("Missing-owned fixture absent.");
    await rm(join(target, missing.relativeDestination));
    const plan = await sync.plan(profileId, true);
    expect(plan.absentOwned).toEqual([missing.relativeDestination]);
    expect(plan.removals).toHaveLength(1);
    await expect(
      sync.apply(plan.id, plan.confirmationToken),
    ).resolves.toMatchObject({ outcome: "completed", removed: 1, errors: [] });
    const latest = database.getLatestManifest(profileId, target);
    expect(latest?.manifest_json).not.toContain(missing.relativeDestination);
  });

  it("refuses a symlink substituted at a reviewed removal path", async () => {
    const { directory, database, target, profileId, albumId } = await setup();
    const secondAlbum = await addSecondAlbum(directory, database, albumId);
    const sync = new DeviceSync(database);
    sync.updateProfileAlbums(profileId, [albumId, secondAlbum.id]);
    const initial = await sync.plan(profileId);
    await sync.apply(initial.id, initial.confirmationToken);
    sync.updateProfileAlbums(profileId, [secondAlbum.id]);
    const plan = await sync.plan(profileId, true);
    const removal = plan.removals[0];
    if (!removal) throw new Error("Symlink-removal fixture absent.");
    const removalPath = join(target, removal.relativeDestination);
    const outside = join(directory, "outside-owned-replacement");
    await writeFile(outside, "outside");
    await rm(removalPath);
    await symlink(outside, removalPath);

    await expect(sync.apply(plan.id, plan.confirmationToken)).rejects.toThrow(
      "symbolic link",
    );
    expect(await readFile(outside, "utf8")).toBe("outside");
    expect(database.listSyncHistory(profileId)).toHaveLength(1);
  });

  it("refuses a plan after its database ownership manifest changes", async () => {
    const { database, target, profileId } = await setup();
    const sync = new DeviceSync(database);
    const plan = await sync.plan(profileId);
    database.saveManifest(profileId, target, {
      entries: plan.copies.map((item) => ({
        sourceFileId: item.sourceFileId,
        relativeDestination: item.relativeDestination,
        signature: item.signature,
        size: item.size,
      })),
    });
    await expect(sync.apply(plan.id, plan.confirmationToken)).rejects.toThrow(
      "ownership manifest changed after preview",
    );
    for (const item of plan.copies)
      await expect(
        access(join(target, item.relativeDestination)),
      ).rejects.toThrow();
  });

  it("cancels after a removal quarantine and restores the earlier manifest-owned file", async () => {
    const { directory, database, target, profileId, albumId } = await setup();
    const secondAlbum = await addSecondAlbum(directory, database, albumId);
    const initialSync = new DeviceSync(database);
    initialSync.updateProfileAlbums(profileId, [albumId, secondAlbum.id]);
    const initial = await initialSync.plan(profileId);
    await initialSync.apply(initial.id, initial.confirmationToken);
    initialSync.updateProfileAlbums(profileId, [secondAlbum.id]);
    let markQuarantined: () => void = () => undefined;
    let releaseQuarantine: () => void = () => undefined;
    const quarantined = new Promise<void>((resolve) => {
      markQuarantined = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseQuarantine = resolve;
    });
    let hookCalls = 0;
    const sync = new DeviceSync(database, {
      afterRemovalQuarantined: async () => {
        hookCalls++;
        if (hookCalls === 1) {
          markQuarantined();
          await gate;
        }
      },
    });
    const plan = await sync.plan(profileId, true);
    const applying = sync.apply(plan.id, plan.confirmationToken);
    await quarantined;
    expect(sync.cancel(plan.id).accepted).toBe(true);
    releaseQuarantine();
    await expect(applying).resolves.toMatchObject({
      outcome: "cancelled",
      removed: 1,
      rolledBack: 1,
      errors: [],
    });
    for (const item of plan.removals)
      expect(
        await readFile(join(target, item.relativeDestination)),
      ).toBeDefined();
    expect(database.listSyncHistory(profileId)).toHaveLength(1);
  });

  it("recovers an interrupted removal quarantine without advancing the manifest", async () => {
    const { directory, database, target, profileId, albumId } = await setup();
    const secondAlbum = await addSecondAlbum(directory, database, albumId);
    const initialSync = new DeviceSync(database);
    initialSync.updateProfileAlbums(profileId, [albumId, secondAlbum.id]);
    const initial = await initialSync.plan(profileId);
    await initialSync.apply(initial.id, initial.confirmationToken);
    initialSync.updateProfileAlbums(profileId, [secondAlbum.id]);
    let markQuarantined: () => void = () => undefined;
    const quarantined = new Promise<void>((resolve) => {
      markQuarantined = resolve;
    });
    const neverResume = new Promise<void>(() => undefined);
    const interruptedSync = new DeviceSync(database, {
      afterRemovalQuarantined: async () => {
        markQuarantined();
        await neverResume;
      },
    });
    const plan = await interruptedSync.plan(profileId, true);
    void interruptedSync.apply(plan.id, plan.confirmationToken);
    await quarantined;
    database.close();

    const reopened = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    databases.push(reopened);
    const recoverySync = new DeviceSync(reopened);
    const preview = await firstRecovery(recoverySync);
    expect(preview).toMatchObject({
      mode: "rollback",
      canRecover: true,
    });
    expect(preview.actions[0]?.action).toBe("restore");
    expect(preview.actions[0]?.explanation).toContain("removal quarantine");
    await expect(
      recoverySync.recover(preview.runId, preview.confirmationToken),
    ).resolves.toMatchObject({ complete: true, recovered: 1 });
    for (const item of plan.removals)
      expect(
        await readFile(join(target, item.relativeDestination)),
      ).toBeDefined();
    expect(reopened.listSyncHistory(profileId)).toHaveLength(1);
  });

  it("finishes quarantined removal cleanup after the new manifest committed", async () => {
    const { directory, database, target, profileId, albumId } = await setup();
    const secondAlbum = await addSecondAlbum(directory, database, albumId);
    const initialSync = new DeviceSync(database);
    initialSync.updateProfileAlbums(profileId, [albumId, secondAlbum.id]);
    const initial = await initialSync.plan(profileId);
    await initialSync.apply(initial.id, initial.confirmationToken);
    initialSync.updateProfileAlbums(profileId, [secondAlbum.id]);
    let markCommitted: () => void = () => undefined;
    const committed = new Promise<void>((resolve) => {
      markCommitted = resolve;
    });
    const neverResume = new Promise<void>(() => undefined);
    const interruptedSync = new DeviceSync(database, {
      afterManifestCommitted: async () => {
        markCommitted();
        await neverResume;
      },
    });
    const plan = await interruptedSync.plan(profileId, true);
    void interruptedSync.apply(plan.id, plan.confirmationToken);
    await committed;
    database.close();

    const reopened = new CatalogDatabase(join(directory, "catalog.sqlite3"));
    databases.push(reopened);
    const recoverySync = new DeviceSync(reopened);
    const preview = await firstRecovery(recoverySync);
    expect(preview.mode).toBe("committed-cleanup");
    expect(preview.actions.some((action) => action.action === "remove")).toBe(
      true,
    );
    await expect(
      recoverySync.recover(preview.runId, preview.confirmationToken),
    ).resolves.toMatchObject({ complete: true });
    for (const item of plan.removals)
      await expect(
        access(join(target, item.relativeDestination)),
      ).rejects.toThrow();
    expect(reopened.listSyncHistory(profileId)).toHaveLength(2);
    const manifest = JSON.parse(
      await readFile(join(target, ".outgroove", "manifest.json"), "utf8"),
    ) as { entries: unknown[] };
    expect(manifest.entries).toHaveLength(1);
  });

  it("rolls back a partial removal failure and retains the previous manifest", async () => {
    const { directory, database, target, profileId, albumId } = await setup();
    const secondAlbum = await addSecondAlbum(directory, database, albumId);
    const initialSync = new DeviceSync(database);
    initialSync.updateProfileAlbums(profileId, [albumId, secondAlbum.id]);
    const initial = await initialSync.plan(profileId);
    await initialSync.apply(initial.id, initial.confirmationToken);
    initialSync.updateProfileAlbums(profileId, [secondAlbum.id]);
    const manifestBefore = database.getLatestManifest(
      profileId,
      target,
    )?.manifest_json;
    const failingSync = new DeviceSync(database, {
      afterRemovalQuarantined: () =>
        Promise.reject(new Error("simulated removal failure")),
    });
    const plan = await failingSync.plan(profileId, true);
    const result = await failingSync.apply(plan.id, plan.confirmationToken);
    expect(result).toMatchObject({
      outcome: "failed",
      removed: 1,
      rolledBack: 1,
      errors: [expect.stringContaining("simulated removal failure")],
    });
    expect(database.getLatestManifest(profileId, target)?.manifest_json).toBe(
      manifestBefore,
    );
    for (const item of plan.removals)
      expect(
        await readFile(join(target, item.relativeDestination)),
      ).toBeDefined();
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

  it("blocks a case-folded ownership collision instead of adopting or replacing it", async () => {
    const { database, target, profileId } = await setup();
    const sync = new DeviceSync(database);
    const initial = await sync.plan(profileId);
    await sync.apply(initial.id, initial.confirmationToken);
    const first = initial.copies[0];
    const stored = database.getLatestManifest(profileId, target);
    if (!first || !stored) throw new Error("Case-collision fixture missing.");
    const manifest = JSON.parse(stored.manifest_json) as {
      version: 1;
      profileId: string;
      entries: {
        sourceFileId: string;
        relativeDestination: string;
        signature: string;
        size: number;
      }[];
    };
    const variant = join(
      dirname(first.relativeDestination),
      basename(first.relativeDestination).toLocaleUpperCase("en-US"),
    );
    manifest.entries = manifest.entries.map((entry) =>
      entry.relativeDestination === first.relativeDestination
        ? { ...entry, relativeDestination: variant }
        : entry,
    );
    database.connection
      .prepare(
        `UPDATE sync_manifests SET manifest_json=?
         WHERE id=(
           SELECT id FROM sync_manifests
           WHERE profile_id=? AND target_path=?
           ORDER BY created_at DESC, id DESC LIMIT 1
         )`,
      )
      .run(JSON.stringify(manifest), profileId, target);
    await writeFile(
      join(target, ".outgroove", "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const originalPath = join(target, first.relativeDestination);
    const temporaryPath = `${originalPath}.case-change`;
    await rename(originalPath, temporaryPath);
    await rename(temporaryPath, join(target, variant));

    const plan = await sync.plan(profileId, true);
    expect(plan.conflicts).toEqual([
      expect.stringContaining("differs by case or Unicode"),
    ]);
    expect(plan.removals).toEqual([]);
    await expect(sync.apply(plan.id, plan.confirmationToken)).rejects.toThrow(
      "Resolve sync conflicts",
    );
    expect(await readFile(join(target, variant))).toBeDefined();
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
    await expect(sync.apply(plan.id, plan.confirmationToken)).rejects.toThrow(
      "source changed after preview",
    );
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
    expect(database.getLatestManifest(profileId, target)).toBeUndefined();
    database.close();
  });
});
