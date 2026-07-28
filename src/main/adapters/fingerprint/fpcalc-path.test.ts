import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { bundledFpcalcTarget, resolveBundledFpcalcPath } from "./fpcalc-path";

describe("bundled fpcalc path", () => {
  it.each([
    ["darwin", "arm64", "darwin-arm64", "fpcalc"],
    ["linux", "x64", "linux-x64", "fpcalc"],
    ["win32", "x64", "win32-x64", "fpcalc.exe"],
  ] as const)(
    "maps %s %s to one fixed packaged helper",
    (platform, architecture, directory, executable) => {
      expect(bundledFpcalcTarget(platform, architecture)).toEqual({
        directory,
        executable,
      });
      expect(
        resolveBundledFpcalcPath({
          platform,
          architecture,
          packaged: true,
          appPath: "/application",
          resourcesPath: "/application/resources",
        }),
      ).toBe(join("/application/resources", executable));
      expect(
        resolveBundledFpcalcPath({
          platform,
          architecture,
          packaged: false,
          appPath: "/source",
          resourcesPath: "/unused",
        }),
      ).toBe(join("/source/resources/fpcalc", directory, executable));
    },
  );

  it("does not fall back to PATH on unsupported targets", () => {
    expect(bundledFpcalcTarget("darwin", "x64")).toBeUndefined();
    expect(
      resolveBundledFpcalcPath({
        platform: "linux",
        architecture: "arm64",
        packaged: false,
        appPath: "/source",
        resourcesPath: "/resources",
      }),
    ).toBeUndefined();
  });
});
