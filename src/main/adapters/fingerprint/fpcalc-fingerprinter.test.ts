import { describe, expect, it, vi } from "vitest";

import { FpcalcFingerprinter } from "./fpcalc-fingerprinter";

describe("FpcalcFingerprinter", () => {
  it("normalizes bounded JSON output from a fixed executable runner", async () => {
    const runner = {
      run: vi.fn(() =>
        Promise.resolve(
          JSON.stringify({
            duration: 12.4,
            fingerprint: "AQAAS8kSSUmiKBIA",
          }),
        ),
      ),
    };
    const signal = new AbortController().signal;
    await expect(
      new FpcalcFingerprinter(process.execPath, runner).fingerprint(
        process.execPath,
        signal,
      ),
    ).resolves.toMatchObject({
      durationSeconds: 12,
      value: "AQAAS8kSSUmiKBIA",
    });
    expect(runner.run).toHaveBeenCalledWith(
      process.execPath,
      process.execPath,
      signal,
    );
  });

  it("rejects missing helpers and malformed or unbounded output", async () => {
    await expect(
      new FpcalcFingerprinter(undefined).fingerprint(
        "/catalog/fixture.flac",
        new AbortController().signal,
      ),
    ).rejects.toThrow("unavailable");
    for (const output of [
      "not-json",
      JSON.stringify({ duration: 0, fingerprint: "abc" }),
      JSON.stringify({ duration: 12, fingerprint: "contains spaces" }),
    ])
      await expect(
        new FpcalcFingerprinter(process.execPath, {
          run: vi.fn(() => Promise.resolve(output)),
        }).fingerprint(process.execPath, new AbortController().signal),
      ).rejects.toThrow(/Chromaprint returned/u);
  });
});
