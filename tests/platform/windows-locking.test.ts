import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { inspectTargetFilesystem } from "../../src/main/adapters/filesystem/target-volume";
import { MusicMetadataReader } from "../../src/main/adapters/metadata/metadata-reader";
import { SafeMetadataWriter } from "../../src/main/adapters/metadata/metadata-writer";
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

async function holdExclusiveLock(path: string): Promise<() => Promise<void>> {
  const script = join(
    process.cwd(),
    "tests",
    "platform",
    "hold-exclusive-lock.ps1",
  );
  const child = spawn(
    "powershell.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      path,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Timed out acquiring Windows file lock. ${output}`));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(`Windows lock holder exited early (${code}). ${output}`),
      );
    });
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("OUTGROOVE_LOCKED")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  return async () => {
    child.stdin.end("\n");
    const code = await new Promise<number | null>((resolve) =>
      child.once("exit", resolve),
    );
    if (code !== 0)
      throw new Error(`Windows lock holder failed (${code}). ${output}`);
  };
}

async function setupSync(): Promise<{
  database: CatalogDatabase;
  profileId: string;
  target: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-win-lock-sync-"));
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
  const profile = database.createSyncProfile(
    "Windows lock DAP",
    target,
    [album.id],
    (await inspectTargetFilesystem(target)).volumeIdentity,
  );
  return { database, profileId: profile.id, target };
}

describe.skipIf(process.platform !== "win32")(
  "Windows exclusive-lock behavior",
  () => {
    it("does not modify a source audio file locked by another process", async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "outgroove-win-lock-tag-"),
      );
      temporary.push(directory);
      const path = join(directory, "locked.mp3");
      await cp(
        join(
          process.cwd(),
          "fixtures",
          "audio",
          "preservation",
          "preservation.mp3",
        ),
        path,
      );
      const before = await readFile(path);
      const release = await holdExclusiveLock(path);
      try {
        await expect(
          new SafeMetadataWriter(new MusicMetadataReader()).writeAlbumTitle(
            path,
            "Must Not Apply",
          ),
        ).rejects.toThrow();
      } finally {
        await release();
      }
      expect(await readFile(path)).toEqual(before);
    });

    it("keeps a locked owned sync destination and prior manifest unchanged", async () => {
      const { database, profileId, target } = await setupSync();
      const sync = new DeviceSync(database);
      const initial = await sync.plan(profileId);
      expect(
        await sync.apply(
          initial.id,
          initial.confirmationToken,
          undefined,
          true,
        ),
      ).toMatchObject({ errors: [] });

      const source = initial.copies[0]?.sourcePath;
      const relativeDestination = initial.copies[0]?.relativeDestination;
      if (!source || !relativeDestination)
        throw new Error("Fixture copy missing");
      await writeFile(
        source,
        Buffer.concat([await readFile(source), Buffer.from("changed")]),
      );
      const replacement = await sync.plan(profileId);
      expect(replacement.copies).toHaveLength(0);
      expect(replacement.replacements).toHaveLength(1);
      const destination = join(target, relativeDestination);
      const manifestPath = join(target, ".outgroove", "manifest.json");
      const destinationBefore = await readFile(destination);
      const manifestBefore = await readFile(manifestPath);

      const release = await holdExclusiveLock(destination);
      try {
        await expect(
          sync.apply(
            replacement.id,
            replacement.confirmationToken,
            undefined,
            true,
          ),
        ).rejects.toMatchObject({ code: "EBUSY" });
      } finally {
        await release();
      }

      expect(await readFile(destination)).toEqual(destinationBefore);
      expect(await readFile(manifestPath)).toEqual(manifestBefore);
    });
  },
);
