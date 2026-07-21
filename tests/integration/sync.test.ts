import {
  access,
  cp,
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
afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

async function setup(): Promise<{
  directory: string;
  database: CatalogDatabase;
  target: string;
  profileId: string;
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
  const root = database.addLibraryRoot(library, pathComparisonKey(library));
  await new ScanLibrary(
    database,
    new LocalMetadataJobRunner(new MusicMetadataReader()),
  ).execute(root.id);
  const album = database.listAlbums()[0];
  if (!album) throw new Error("Fixture album missing");
  const profile = database.createSyncProfile("Fixture DAP", target, album.id);
  return { directory, database, target, profileId: profile.id };
}

describe("deterministic manifest-based sync", () => {
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
