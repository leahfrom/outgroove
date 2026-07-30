import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { isAbsolute, join, parse, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { CatalogDatabase } from "../src/main/adapters/database/catalog-database";
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
  if (resolve(target) === parse(resolve(target)).root)
    throw new Error(
      "A filesystem root cannot be used directly as the probe target.",
    );
  return resolve(target);
}

async function detectedFilesystem(path: string): Promise<string> {
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync(
      "/usr/sbin/diskutil",
      ["info", "-plist", path],
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

async function run(targetArgument: string): Promise<void> {
  const target = await realpath(targetArgument);
  if (target === parse(target).root)
    throw new Error("The resolved probe target cannot be a filesystem root.");
  const targetInfo = await stat(target);
  if (!targetInfo.isDirectory())
    throw new Error("Probe target is not a directory.");
  const filesystem = await detectedFilesystem(target);
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
    const write = await new SafeMetadataWriter(
      new MusicMetadataReader(),
    ).writeAlbumTitle(tagPath, "exFAT Verified Album");
    assert.equal(write.file.tags.album, "exFAT Verified Album");
    assert.equal(write.payloadHashBefore, payloadBefore);
    assert.equal(write.payloadHashAfter, payloadBefore);

    const library = join(probe, "library");
    const syncTarget = join(probe, "dap-target");
    await cp(join(process.cwd(), "fixtures", "audio", "album"), library, {
      recursive: true,
    });
    await mkdir(syncTarget);
    database = new CatalogDatabase(join(probe, "catalog.sqlite3"));
    const root = database.addLibraryRoot(library, pathComparisonKey(library));
    await new ScanLibrary(
      database,
      new LocalMetadataJobRunner(new MusicMetadataReader()),
    ).execute(root.id);
    const album = database.listAlbums()[0];
    assert.ok(album, "Fixture album must scan on the probe volume.");
    const profile = database.createSyncProfile(
      "Disposable exFAT probe",
      syncTarget,
      [album.id],
      (await inspectTargetFilesystem(syncTarget)).volumeIdentity,
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
    assert.equal(await readFile(unknown, "utf8"), "must remain untouched");
    const repeated = await sync.plan(profile.id);
    assert.equal(repeated.copies.length, 0);
    assert.equal(repeated.unchanged.length, plan.copies.length);
    assert.equal(
      await exists(join(syncTarget, ".outgroove", "manifest.json")),
      true,
    );

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
      hardLinkError = (error as NodeJS.ErrnoException).code ?? String(error);
    }
    const capacity = await statfs(target);

    console.log(
      JSON.stringify(
        {
          filesystem,
          platform: `${process.platform}-${process.arch}`,
          metadataWrite: "passed",
          sync: {
            copied: applied.copied,
            repeatUnchanged: repeated.unchanged.length,
            unknownFilePreserved: true,
            manifestCommittedAfterCopies: true,
          },
          observedBehavior: {
            caseInsensitive,
            normalizationInsensitive,
            timestampDeltaMs: Math.abs(observedTime - requestedTime.getTime()),
            hardLinksSupported,
            hardLinkError,
            availableBytes: capacity.bavail * capacity.bsize,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    database?.close();
    await rm(probe, { recursive: true, force: true });
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  void (async () => run(parseProbeTarget(process.argv.slice(2))))().catch(
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
