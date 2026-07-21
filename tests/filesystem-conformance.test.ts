import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseProbeTarget } from "../scripts/filesystem-conformance";

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
  });
});
