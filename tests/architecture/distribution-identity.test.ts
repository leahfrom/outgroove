import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("packaged application identity", () => {
  const forge = readFileSync(join(process.cwd(), "forge.config.ts"), "utf8");
  const main = readFileSync(
    join(process.cwd(), "src", "main", "index.ts"),
    "utf8",
  );

  it("keeps stable platform identifiers and both Windows distribution choices", () => {
    expect(forge).toContain('appBundleId: "de.leahfrom.outgroove"');
    expect(forge).toContain("new MakerZIP");
    expect(forge).toContain("new MakerSquirrel");
    expect(main).toContain(
      'app.setAppUserModelId("com.squirrel.Outgroove.Outgroove")',
    );
  });

  it("keeps macOS signing explicit and credential-free", () => {
    expect(forge).toContain('process.env.OUTGROOVE_MAC_SIGNING === "1"');
    expect(forge).toContain(
      "process.env.OUTGROOVE_MAC_NOTARY_KEYCHAIN_PROFILE",
    );
    expect(forge).not.toMatch(
      /APPLE_ID|APPLE_PASSWORD|certificatePassword|apiKeyId|apiIssuer/iu,
    );
  });
});
