import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectTargetFilesystem } from "./target-volume";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("target filesystem evidence", () => {
  it("returns deterministic root and available volume evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-volume-"));
    temporary.push(directory);
    const target = join(directory, "target");
    await mkdir(target);

    const first = await inspectTargetFilesystem(target);
    await expect(inspectTargetFilesystem(target)).resolves.toEqual(first);
    expect(first.rootIdentity).toMatch(/^\d+:\d+$/u);
    if (first.volumeIdentity !== null)
      expect(first.volumeIdentity).toMatch(/^filesystem-device:\d+$/u);
  });

  it("refuses files and symbolic-link roots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-volume-"));
    temporary.push(directory);
    const target = join(directory, "target");
    const file = join(directory, "file");
    const linked = join(directory, "linked");
    await mkdir(target);
    await writeFile(file, "fixture");
    await symlink(target, linked, "dir");

    await expect(inspectTargetFilesystem(file)).rejects.toThrow(
      "not a directory",
    );
    await expect(inspectTargetFilesystem(linked)).rejects.toThrow(
      "symbolic link",
    );
  });
});
