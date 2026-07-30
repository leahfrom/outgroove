import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadPackagedInspectionSession,
  packagedInspectionReadySchema,
  writePackagedInspectionReadyMarker,
} from "./packaged-inspection";

const temporaryRoots: string[] = [];

async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "outgroove-inspection-")),
  );
  temporaryRoots.push(root);
  const userData = join(root, "profile");
  const targetRoot = join(root, "target");
  const fixtureLibraryRoot = join(root, "fixture-library");
  const readyMarker = join(root, "ready.json");
  const configPath = join(root, "inspection.json");
  await mkdir(userData);
  await mkdir(targetRoot);
  await mkdir(fixtureLibraryRoot);
  const config = {
    protocolVersion: 1,
    sessionId: randomUUID(),
    root,
    userData,
    targetRoot,
    fixtureLibraryRoot,
    readyMarker,
  } as const;
  await writeFile(configPath, JSON.stringify(config));
  return { ...config, configPath };
}

function storedConfig(config: Awaited<ReturnType<typeof fixture>>) {
  return {
    protocolVersion: config.protocolVersion,
    sessionId: config.sessionId,
    root: config.root,
    userData: config.userData,
    targetRoot: config.targetRoot,
    fixtureLibraryRoot: config.fixtureLibraryRoot,
    readyMarker: config.readyMarker,
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("packaged inspection configuration", () => {
  it("is inert when the build-time gate is disabled", () => {
    expect(
      loadPackagedInspectionSession(false, [
        "--outgroove-inspection-config=/arbitrary/path",
      ]),
    ).toBeUndefined();
  });

  it("accepts one generated, fully contained temporary session", async () => {
    const config = await fixture();
    expect(
      loadPackagedInspectionSession(true, [
        `--outgroove-inspection-config=${config.configPath}`,
      ]),
    ).toMatchObject({
      sessionId: config.sessionId,
      root: config.root,
      userData: config.userData,
      targetRoot: config.targetRoot,
      fixtureLibraryRoot: config.fixtureLibraryRoot,
      readyMarker: config.readyMarker,
    });
  });

  it("rejects missing configuration, traversal, and pre-existing markers", async () => {
    expect(() => loadPackagedInspectionSession(true, [])).toThrow(
      /exactly one/iu,
    );

    const config = await fixture();
    const arbitraryRoot = await mkdtemp(join(tmpdir(), "outgroove-arbitrary-"));
    temporaryRoots.push(arbitraryRoot);
    const arbitraryConfig = join(arbitraryRoot, "inspection.json");
    await writeFile(arbitraryConfig, JSON.stringify(storedConfig(config)));
    expect(() =>
      loadPackagedInspectionSession(true, [
        `--outgroove-inspection-config=${arbitraryConfig}`,
      ]),
    ).toThrow(/configuration.*generated/iu);

    await writeFile(
      config.configPath,
      JSON.stringify({
        ...storedConfig(config),
        readyMarker: join(config.root, "..", "x"),
      }),
    );
    expect(() =>
      loadPackagedInspectionSession(true, [
        `--outgroove-inspection-config=${config.configPath}`,
      ]),
    ).toThrow(/ready marker.*inside/iu);

    await writeFile(config.configPath, JSON.stringify(storedConfig(config)));
    await writeFile(config.readyMarker, "occupied");
    expect(() =>
      loadPackagedInspectionSession(true, [
        `--outgroove-inspection-config=${config.configPath}`,
      ]),
    ).toThrow(/already exists/iu);
  });

  it("rejects a symlinked target that resolves outside the session", async () => {
    const config = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "outgroove-outside-"));
    temporaryRoots.push(outside);
    const linkedTarget = join(config.root, "linked-target");
    await symlink(outside, linkedTarget, "dir");
    await writeFile(
      config.configPath,
      JSON.stringify({
        ...storedConfig(config),
        targetRoot: linkedTarget,
      }),
    );
    expect(() =>
      loadPackagedInspectionSession(true, [
        `--outgroove-inspection-config=${config.configPath}`,
      ]),
    ).toThrow(/target directory.*inside/iu);
  });

  it("writes one machine-readable marker without overwriting it", async () => {
    const config = await fixture();
    const session = loadPackagedInspectionSession(true, [
      `--outgroove-inspection-config=${config.configPath}`,
    ]);
    expect(session).toBeDefined();
    if (!session) throw new Error("Expected a packaged inspection session.");
    const databasePath = join(config.userData, "outgroove.sqlite3");
    const marker = await writePackagedInspectionReadyMarker(session, {
      pid: 1234,
      appPath: "/fixture/app.asar",
      executablePath: "/fixture/Outgroove",
      databasePath,
    });
    expect(
      packagedInspectionReadySchema.parse(
        JSON.parse(await readFile(config.readyMarker, "utf8")) as unknown,
      ),
    ).toEqual(marker);
    await expect(
      writePackagedInspectionReadyMarker(session, {
        pid: 1234,
        appPath: "/fixture/app.asar",
        executablePath: "/fixture/Outgroove",
        databasePath,
      }),
    ).rejects.toMatchObject({ code: "EEXIST" });
  });
});
