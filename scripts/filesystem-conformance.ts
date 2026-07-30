import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access,
  cp,
  link,
  mkdir,
  realpath,
  readFile,
  rm,
  stat,
  statfs,
  unlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { CatalogDatabase } from "../src/main/adapters/database/catalog-database";
import { streamingFileHash } from "../src/main/adapters/filesystem/streaming-hash";
import { inspectTargetFilesystem } from "../src/main/adapters/filesystem/target-volume";
import { MusicMetadataReader } from "../src/main/adapters/metadata/metadata-reader";
import {
  audioPayloadHash,
  SafeMetadataWriter,
} from "../src/main/adapters/metadata/metadata-writer";
import { DeviceSync } from "../src/main/application/device-sync";
import {
  pathComparisonKey,
  ScanLibrary,
} from "../src/main/application/scan-library";
import { LocalMetadataJobRunner } from "../src/main/jobs/metadata-runner";

const execFileAsync = promisify(execFile);
const confirmation = "--confirm-disposable-exfat-probe";

export function parseProbeTarget(args: readonly string[]): string {
  const targetIndex = args.indexOf("--target");
  const target = targetIndex === -1 ? undefined : args[targetIndex + 1];
  if (!target || !isAbsolute(target))
    throw new Error("--target must be one explicit absolute path.");
  if (!args.includes(confirmation))
    throw new Error(
      `${confirmation} is required before writing the isolated probe directory.`,
    );
  if (
    args.length !== 3 ||
    args.filter((argument) => argument === "--target").length !== 1 ||
    args.filter((argument) => argument === confirmation).length !== 1
  )
    throw new Error(
      "Provide exactly --target <absolute-path> and --confirm-disposable-exfat-probe.",
    );
  if (resolve(target) === parse(resolve(target)).root)
    throw new Error(
      "A filesystem root cannot be used directly as the probe target.",
    );
  return resolve(target);
}

export function digestRemovalSet(
  relativeDestinations: readonly string[],
): string {
  return createHash("sha256")
    .update(JSON.stringify([...relativeDestinations].sort()))
    .digest("hex");
}

async function filesystemRoot(path: string): Promise<string> {
  let current = await realpath(path);
  const device = (await stat(current)).dev;
  for (;;) {
    const parent = dirname(current);
    if (parent === current || current === parse(current).root) return current;
    if ((await stat(parent)).dev !== device) return current;
    current = parent;
  }
}

async function detectedFilesystem(path: string): Promise<string> {
  if (process.platform === "darwin") {
    const volumeRoot = await filesystemRoot(path);
    const { stdout } = await execFileAsync(
      "/usr/sbin/diskutil",
      ["info", "-plist", volumeRoot],
      { encoding: "utf8", timeout: 10_000 },
    );
    const match =
      /<key>Filesystem(?:Name|Type|Personality)<\/key>\s*<string>([^<]+)<\/string>/iu.exec(
        stdout,
      );
    return match?.[1]?.trim() ?? "unknown";
  }
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-Volume -FilePath $env:OUTGROOVE_PROBE_PATH).FileSystem",
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, OUTGROOVE_PROBE_PATH: path },
      },
    );
    return stdout.trim() || "unknown";
  }
  const { stdout } = await execFileAsync(
    "findmnt",
    ["--noheadings", "--output", "FSTYPE", "--target", path],
    { encoding: "utf8", timeout: 10_000 },
  );
  return stdout.trim() || "unknown";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sourceHashes(
  paths: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  return new Map(
    await Promise.all(
      paths.map(async (path) => [path, await streamingFileHash(path)] as const),
    ),
  );
}

async function assertSourceHashesUnchanged(
  expected: ReadonlyMap<string, string>,
): Promise<void> {
  for (const [path, hash] of expected)
    assert.equal(
      await streamingFileHash(path),
      hash,
      "Sync must not modify a source fixture.",
    );
}

export async function runProbe(
  targetArgument: string,
  detectFilesystem: (path: string) => Promise<string> = detectedFilesystem,
) {
  const target = await realpath(targetArgument);
  if (target === parse(target).root)
    throw new Error("The resolved probe target cannot be a filesystem root.");
  const targetInfo = await stat(target);
  if (!targetInfo.isDirectory())
    throw new Error("Probe target is not a directory.");
  const filesystem = await detectFilesystem(target);
  if (filesystem.replaceAll(/[^a-z0-9]/giu, "").toLowerCase() !== "exfat")
    throw new Error(
      `Refusing to run: detected “${filesystem}”, but this probe requires exFAT.`,
    );

  const probe = join(target, `.outgroove-exfat-probe-${randomUUID()}`);
  if (
    !probe.startsWith(`${target}${process.platform === "win32" ? "\\" : "/"}`)
  )
    throw new Error("Probe directory escaped the selected target.");
  await mkdir(probe, { recursive: false });
  let database: CatalogDatabase | undefined;
  try {
    const writer = new SafeMetadataWriter(new MusicMetadataReader());
    const tagDirectory = join(probe, "tag-write");
    await mkdir(tagDirectory);
    const tagPath = join(tagDirectory, "preservation.mp3");
    await cp(
      join(
        process.cwd(),
        "fixtures",
        "audio",
        "preservation",
        "preservation.mp3",
      ),
      tagPath,
    );
    const payloadBefore = await audioPayloadHash(tagPath);
    const write = await writer.writeAlbumTitle(tagPath, "exFAT Verified Album");
    assert.equal(write.file.tags.album, "exFAT Verified Album");
    assert.equal(write.payloadHashBefore, payloadBefore);
    assert.equal(write.payloadHashAfter, payloadBefore);

    const library = join(probe, "library");
    const syncTarget = join(probe, "dap-target");
    const primaryLibrary = join(library, "primary");
    const secondaryLibrary = join(library, "secondary");
    await cp(
      join(process.cwd(), "fixtures", "audio", "album"),
      primaryLibrary,
      {
        recursive: true,
      },
    );
    await mkdir(secondaryLibrary, { recursive: true });
    const secondarySources = ["01-first.mp3", "02-second.flac"].map((name) =>
      join(secondaryLibrary, name),
    );
    await Promise.all(
      secondarySources.map((destination) =>
        cp(
          join(
            process.cwd(),
            "fixtures",
            "audio",
            "album",
            destination.endsWith(".mp3") ? "01-first.mp3" : "02-second.flac",
          ),
          destination,
        ),
      ),
    );
    for (const path of secondarySources)
      await writer.writeAlbumTitle(path, "Second exFAT Album");
    await mkdir(syncTarget);
    database = new CatalogDatabase(join(probe, "catalog.sqlite3"));
    const root = database.addLibraryRoot(library, pathComparisonKey(library));
    await new ScanLibrary(
      database,
      new LocalMetadataJobRunner(new MusicMetadataReader()),
    ).execute(root.id);
    const albums = database.listAlbums();
    assert.equal(albums.length, 2, "Exactly two fixture albums must scan.");
    const secondaryAlbum = albums.find(
      (album) => album.title === "Second exFAT Album",
    );
    const primaryAlbum = albums.find(
      (album) => album.id !== secondaryAlbum?.id,
    );
    assert.ok(primaryAlbum, "Primary fixture album must scan on the probe.");
    assert.ok(
      secondaryAlbum,
      "Secondary fixture album must scan on the probe.",
    );
    const allSources = [...primaryAlbum.tracks, ...secondaryAlbum.tracks].map(
      (track) => track.path,
    );
    const initialSourceHashes = await sourceHashes(allSources);
    const initialEvidence = await inspectTargetFilesystem(syncTarget);
    const profile = database.createSyncProfile(
      "Disposable exFAT probe",
      syncTarget,
      [primaryAlbum.id, secondaryAlbum.id],
      initialEvidence.volumeIdentity,
    );
    const unknown = join(syncTarget, "user-owned-probe.txt");
    await writeFile(unknown, "must remain untouched", { flag: "wx" });
    const sync = new DeviceSync(database);
    const plan = await sync.plan(profile.id);
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.conflicts, []);
    const applied = await sync.apply(
      plan.id,
      plan.confirmationToken,
      undefined,
      plan.targetVolume.confirmationRequired,
    );
    assert.deepEqual(applied.errors, []);
    assert.ok(applied.copied > 0);
    assert.equal(await readFile(unknown, "utf8"), "must remain untouched");
    await assertSourceHashesUnchanged(initialSourceHashes);
    const playlist = await readFile(join(syncTarget, "Outgroove.m3u8"), "utf8");
    assert.match(playlist, /Fixture Album/u);
    assert.match(playlist, /Second exFAT Album/u);
    const repeated = await sync.plan(profile.id);
    assert.equal(repeated.copies.length, 0);
    assert.equal(repeated.unchanged.length, plan.copies.length);
    assert.equal(
      await exists(join(syncTarget, ".outgroove", "manifest.json")),
      true,
    );

    const replacementSource = secondaryAlbum.tracks[0]?.path;
    assert.ok(replacementSource, "Replacement source fixture must exist.");
    await writeFile(
      replacementSource,
      Buffer.concat([
        await readFile(replacementSource),
        Buffer.from("outgroove-exfat-replacement"),
      ]),
    );
    const replacementSourceHashes = await sourceHashes(allSources);
    const replacementPlan = await sync.plan(profile.id);
    assert.equal(replacementPlan.copies.length, 0);
    assert.equal(replacementPlan.replacements.length, 1);
    const replacementResult = await sync.apply(
      replacementPlan.id,
      replacementPlan.confirmationToken,
      undefined,
      replacementPlan.targetVolume.confirmationRequired,
    );
    assert.equal(replacementResult.replaced, 1);
    assert.deepEqual(replacementResult.errors, []);
    await assertSourceHashesUnchanged(replacementSourceHashes);

    sync.updateProfileAlbums(profile.id, [secondaryAlbum.id]);
    const cleanupPlan = await sync.plan(profile.id, true);
    const primarySourceIds = new Set(
      primaryAlbum.tracks.map((track) => track.id),
    );
    const exactExpectedRemovals = plan.copies
      .filter((item) => primarySourceIds.has(item.sourceFileId))
      .map((item) => item.relativeDestination)
      .sort();
    assert.equal(exactExpectedRemovals.length, primaryAlbum.tracks.length);
    assert.equal(cleanupPlan.cleanupEnabled, true);
    assert.deepEqual(
      cleanupPlan.removals.map((item) => item.relativeDestination).sort(),
      exactExpectedRemovals,
    );
    assert.ok(cleanupPlan.removals.length > 0);
    const previousManifest = await readFile(
      join(syncTarget, ".outgroove", "manifest.json"),
    );
    const previousDatabaseManifest = database.getLatestManifest(
      profile.id,
      syncTarget,
    )?.manifest_json;
    assert.ok(
      previousDatabaseManifest,
      "The committed database manifest must exist before interruption.",
    );
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
    const interruptedPlan = await interruptedSync.plan(profile.id, true);
    void interruptedSync
      .apply(
        interruptedPlan.id,
        interruptedPlan.confirmationToken,
        undefined,
        interruptedPlan.targetVolume.confirmationRequired,
      )
      .catch(() => undefined);
    await quarantined;
    assert.deepEqual(
      await readFile(join(syncTarget, ".outgroove", "manifest.json")),
      previousManifest,
    );
    database.close();
    database = undefined;

    database = new CatalogDatabase(join(probe, "catalog.sqlite3"));
    const recoverySync = new DeviceSync(database);
    const recoverySummary = recoverySync.listRecoverySummaries()[0];
    assert.ok(recoverySummary, "Interrupted removal must require recovery.");
    assert.equal(recoverySummary.mode, "rollback");
    const recoveryPreview = await recoverySync.previewRecovery(
      recoverySummary.runId,
    );
    assert.equal(recoveryPreview.canRecover, true);
    assert.ok(
      recoveryPreview.actions.some((action) => action.action === "restore"),
    );
    const recovered = await recoverySync.recover(
      recoveryPreview.runId,
      recoveryPreview.confirmationToken,
      recoveryPreview.targetVolume.confirmationRequired,
    );
    assert.equal(recovered.complete, true);
    assert.ok(recovered.recovered > 0);
    assert.deepEqual(
      await readFile(join(syncTarget, ".outgroove", "manifest.json")),
      previousManifest,
    );
    assert.equal(
      database.getLatestManifest(profile.id, syncTarget)?.manifest_json,
      previousDatabaseManifest,
    );
    assert.equal(await readFile(unknown, "utf8"), "must remain untouched");

    const finalCleanupPlan = await recoverySync.plan(profile.id, true);
    assert.deepEqual(
      finalCleanupPlan.removals.map((item) => item.relativeDestination).sort(),
      exactExpectedRemovals,
    );
    const cleanupResult = await recoverySync.apply(
      finalCleanupPlan.id,
      finalCleanupPlan.confirmationToken,
      undefined,
      finalCleanupPlan.targetVolume.confirmationRequired,
    );
    assert.equal(cleanupResult.removed, exactExpectedRemovals.length);
    assert.deepEqual(cleanupResult.errors, []);
    for (const relativeDestination of exactExpectedRemovals)
      assert.equal(await exists(join(syncTarget, relativeDestination)), false);
    assert.equal(await readFile(unknown, "utf8"), "must remain untouched");
    await assertSourceHashesUnchanged(replacementSourceHashes);
    const finalManifest = JSON.parse(
      await readFile(join(syncTarget, ".outgroove", "manifest.json"), "utf8"),
    ) as { entries: { sourceFileId: string }[] };
    const finalDatabaseManifest = JSON.parse(
      database.getLatestManifest(profile.id, syncTarget)?.manifest_json ??
        "null",
    ) as { entries: { sourceFileId: string }[] } | null;
    assert.deepEqual(finalDatabaseManifest, finalManifest);
    assert.equal(finalManifest.entries.length, secondaryAlbum.tracks.length);
    assert.ok(
      finalManifest.entries.every((entry) =>
        secondaryAlbum.tracks.some((track) => track.id === entry.sourceFileId),
      ),
    );
    const finalPlaylist = await readFile(
      join(syncTarget, "Outgroove.m3u8"),
      "utf8",
    );
    assert.doesNotMatch(finalPlaylist, /Fixture Album/u);
    assert.match(finalPlaylist, /Second exFAT Album/u);
    const finalEvidence = await inspectTargetFilesystem(syncTarget);

    const timestampPath = join(probe, "timestamp-probe");
    await writeFile(timestampPath, "timestamp");
    const requestedTime = new Date("2030-01-02T03:04:05.123Z");
    await utimes(timestampPath, requestedTime, requestedTime);
    const observedTime = (await stat(timestampPath)).mtimeMs;

    const casePath = join(probe, "Case-Probe");
    await writeFile(casePath, "case", { flag: "wx" });
    const caseInsensitive = await exists(join(probe, "case-probe"));

    const composedPath = join(probe, "unicode-é");
    await writeFile(composedPath, "unicode", { flag: "wx" });
    const normalizationInsensitive = await exists(
      join(probe, "unicode-e\u0301"),
    );

    const hardLinkSource = join(probe, "hard-link-source");
    const hardLinkDestination = join(probe, "hard-link-destination");
    await writeFile(hardLinkSource, "hard-link");
    let hardLinksSupported = true;
    let hardLinkError: string | null = null;
    try {
      await link(hardLinkSource, hardLinkDestination);
      await unlink(hardLinkDestination);
    } catch (error) {
      hardLinksSupported = false;
      hardLinkError = (error as NodeJS.ErrnoException).code ?? "UNKNOWN";
    }
    const capacity = await statfs(target);

    return {
      schemaVersion: 1 as const,
      probe: "outgroove-exfat-conformance" as const,
      filesystem,
      platform: `${process.platform}-${process.arch}`,
      checks: {
        metadataSafeReplacement: "passed" as const,
        initialSync: {
          copied: applied.copied,
          repeatUnchanged: repeated.unchanged.length,
          playlistWritten: true,
          unknownFilePreserved: true,
          manifestCommittedAfterCopies: true,
        },
        ownedReplacement: {
          replaced: replacementResult.replaced,
          sourceHashesUnchanged: true,
        },
        optInCleanup: {
          removalCount: cleanupResult.removed,
          exactRemovalSetDigest: digestRemovalSet(exactExpectedRemovals),
          unknownFilePreserved: true,
          finalManifestVerified: true,
        },
        interruptedRemovalRecovery: {
          previousManifestRetained: true,
          recovered: recovered.recovered,
          recoveryComplete: recovered.complete,
        },
        targetIdentity: {
          persistentEvidenceAvailable: initialEvidence.volumeIdentity !== null,
          stableDuringRun:
            initialEvidence.volumeIdentity === finalEvidence.volumeIdentity,
        },
      },
      observedBehavior: {
        caseInsensitive,
        normalizationInsensitive,
        timestampDeltaMs: Math.abs(observedTime - requestedTime.getTime()),
        hardLinksSupported,
        hardLinkError,
        availableBytes: capacity.bavail * capacity.bsize,
      },
    };
  } finally {
    database?.close();
    await rm(probe, { recursive: true, force: true });
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void (async () => {
    const report = await runProbe(parseProbeTarget(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
  })().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
