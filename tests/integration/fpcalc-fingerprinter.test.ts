import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FpcalcFingerprinter } from "../../src/main/adapters/fingerprint/fpcalc-fingerprinter";

const executable = join(
  process.cwd(),
  "resources",
  "fpcalc",
  "darwin-arm64",
  "fpcalc",
);

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

describe.runIf(process.platform === "darwin" && process.arch === "arm64")(
  "bundled fpcalc integration",
  () => {
    it.each(["fingerprint.mp3", "fingerprint.flac"])(
      "fingerprints the checked-in synthetic %s without modifying audio",
      async (name) => {
        const path = join(
          process.cwd(),
          "fixtures",
          "audio",
          "fingerprint",
          name,
        );
        const before = await sha256(path);
        const fingerprint = await new FpcalcFingerprinter(
          executable,
        ).fingerprint(path, new AbortController().signal);
        expect(fingerprint).toMatchObject({
          durationSeconds: 12,
          value: "AQAAS8kSSUmiKBIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        });
        expect(await sha256(path)).toBe(before);
      },
    );

    it("fails locally for a corrupt file without changing it", async () => {
      const path = join(
        process.cwd(),
        "fixtures",
        "audio",
        "corrupt",
        "truncated-metadata.flac",
      );
      const before = await sha256(path);
      await expect(
        new FpcalcFingerprinter(executable).fingerprint(
          path,
          new AbortController().signal,
        ),
      ).rejects.toThrow("could not fingerprint");
      expect(await sha256(path)).toBe(before);
    });
  },
);
