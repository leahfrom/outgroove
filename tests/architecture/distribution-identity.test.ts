import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("packaged application identity", () => {
  const forge = readFileSync(join(process.cwd(), "forge.config.ts"), "utf8");
  const macRelease = readFileSync(
    join(process.cwd(), "scripts", "macos-release.ts"),
    "utf8",
  );
  const main = readFileSync(
    join(process.cwd(), "src", "main", "index.ts"),
    "utf8",
  );
  const mainVite = readFileSync(
    join(process.cwd(), "vite.main.config.ts"),
    "utf8",
  );

  it("keeps stable platform identifiers and both Windows distribution choices", () => {
    expect(forge).toContain('"de.leahfrom.outgroove.inspection"');
    expect(forge).toContain(': "de.leahfrom.outgroove"');
    expect(forge).toContain('new MakerZIP({}, ["win32", "linux"])');
    expect(forge).toContain("new MakerDMG");
    expect(forge).toContain("new MakerSquirrel");
    expect(forge).not.toContain('"darwin", "win32", "linux"');
    expect(main).toContain('"com.squirrel.Outgroove.Inspection"');
    expect(main).toContain('"com.squirrel.Outgroove.Outgroove"');
  });

  it("compiles inspection isolation out of ordinary packages", () => {
    expect(forge).toContain('process.env.OUTGROOVE_INSPECTION_BUILD === "1"');
    expect(forge).toContain(
      'inspectionBuild ? "Outgroove Inspection" : "outgroove"',
    );
    expect(forge).toContain(
      'inspectionBuild ? "Outgroove Inspection" : "Outgroove"',
    );
    expect(mainVite).toContain(
      'process.env.OUTGROOVE_INSPECTION_BUILD === "1"',
    );
    expect(main).toContain(
      "loadPackagedInspectionSession(\n  OUTGROOVE_INSPECTION_BUILD,",
    );
    expect(main).toContain('app.setName("Outgroove Inspection")');
  });

  it("keeps macOS signing explicit and credential-free", () => {
    expect(forge).toContain(
      "resolveMacReleaseConfig(inspectionBuild ? {} : process.env)",
    );
    expect(macRelease).toContain('environment.OUTGROOVE_MAC_SIGNING === "1"');
    expect(macRelease).toContain(
      "environment.OUTGROOVE_MAC_NOTARY_KEYCHAIN_PROFILE",
    );
    expect(`${forge}\n${macRelease}`).not.toMatch(
      /APPLE_PASSWORD|certificatePassword|BEGIN PRIVATE KEY|@icloud\.com/iu,
    );
  });
});
