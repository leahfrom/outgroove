import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  digestRemovalSet,
  parseProbeTarget,
  runProbe,
} from "../scripts/filesystem-conformance";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("manual exFAT probe guardrails", () => {
  it("requires an absolute target and explicit destructive-test confirmation", () => {
    expect(() => parseProbeTarget(["--target", "relative"])).toThrow(
      "explicit absolute path",
    );
    expect(() => parseProbeTarget(["--target", resolve("target")])).toThrow(
      "--confirm-disposable-exfat-probe",
    );
  });

  it("rejects a filesystem root", () => {
    expect(() =>
      parseProbeTarget([
        "--target",
        resolve("/"),
        "--confirm-disposable-exfat-probe",
      ]),
    ).toThrow("root cannot be used");
  });

  it("accepts only the explicit confirmed absolute target", () => {
    const target = resolve("disposable-exfat-target");
    expect(
      parseProbeTarget([
        "--target",
        target,
        "--confirm-disposable-exfat-probe",
      ]),
    ).toBe(target);
    expect(() =>
      parseProbeTarget([
        "--target",
        target,
        "--confirm-disposable-exfat-probe",
        "--unexpected",
      ]),
    ).toThrow("exactly");
  });

  it("creates a deterministic path-redacted digest for the exact removal set", () => {
    const paths = ["Artist/Album/02.flac", "Artist/Album/01.mp3"];
    const digest = digestRemovalSet(paths);

    expect(digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(digestRemovalSet([...paths].reverse())).toBe(digest);
    expect(digestRemovalSet([...paths, "Artist/Album/03.opus"])).not.toBe(
      digest,
    );
    expect(digest).not.toContain("Artist");
  });

  it("orchestrates the complete isolated workflow without leaking paths", async () => {
    const target = await mkdtemp(join(tmpdir(), "outgroove-probe-test-"));
    temporary.push(target);

    const report = await runProbe(target, () => Promise.resolve("exFAT"));
    const serialized = JSON.stringify(report);

    expect(report).toMatchObject({
      schemaVersion: 1,
      probe: "outgroove-exfat-conformance",
      filesystem: "exFAT",
      checks: {
        metadataSafeReplacement: "passed",
        ownedReplacement: {
          replaced: 1,
          sourceHashesUnchanged: true,
        },
        optInCleanup: {
          unknownFilePreserved: true,
          finalManifestVerified: true,
        },
        interruptedRemovalRecovery: {
          previousManifestRetained: true,
          recoveryComplete: true,
        },
      },
    });
    expect(report.checks.optInCleanup.removalCount).toBeGreaterThan(0);
    expect(report.checks.optInCleanup.exactRemovalSetDigest).toMatch(
      /^[0-9a-f]{64}$/u,
    );
    expect(serialized).not.toContain(target);
    expect(serialized).not.toContain("Fixture Album");
    expect(await readdir(target)).toEqual([]);
  }, 30_000);
});
