import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { inspectTargetFilesystem } from "../../src/main/adapters/filesystem/target-volume";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe.skipIf(process.platform !== "win32")(
  "Windows persistent volume identity",
  () => {
    it("reads one stable hashed identity for two target folders on the native volume", async () => {
      const root = await mkdtemp(
        join(tmpdir(), "outgroove-win-volume-identity-"),
      );
      temporary.push(root);
      const firstTarget = join(root, "first target");
      const secondTarget = join(root, "second target");
      await mkdir(firstTarget);
      await mkdir(secondTarget);

      const first = await inspectTargetFilesystem(firstTarget);
      const repeated = await inspectTargetFilesystem(firstTarget);
      const sibling = await inspectTargetFilesystem(secondTarget);

      expect(first.volumeIdentity).toMatch(
        /^persistent-volume:win32:[0-9a-f]{64}$/u,
      );
      expect(repeated.volumeIdentity).toBe(first.volumeIdentity);
      expect(sibling.volumeIdentity).toBe(first.volumeIdentity);
      expect(first.rootIdentity).toBe(repeated.rootIdentity);
      expect(sibling.rootIdentity).not.toBe(first.rootIdentity);
      expect(first.volumeIdentity).not.toContain(firstTarget);
    });
  },
);
