import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("release workflow", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github", "workflows", "release.yml"),
    "utf8",
  );
  const prepareMacSigning = readFileSync(
    join(process.cwd(), "scripts", "prepare-macos-ci-signing.sh"),
    "utf8",
  );
  const cleanupMacSigning = readFileSync(
    join(process.cwd(), "scripts", "cleanup-macos-ci-signing.sh"),
    "utf8",
  );

  it("publishes only stable SemVer tags after all platform builds", () => {
    expect(workflow).toContain('"v[0-9]+.[0-9]+.[0-9]+"');
    expect(workflow).toContain("needs: build");
    expect(workflow).toContain("npm run flow:validate-release-tag");
    expect(workflow.match(/out\/make\/zip\//gu)).toHaveLength(3);
    expect(workflow).toContain("out/make/*.dmg");
    expect(workflow).toContain("out/make/squirrel.windows/x64/*Setup.exe");
    expect(workflow).toContain(
      "sha256sum release-assets/*.dmg release-assets/*.zip release-assets/*.exe",
    );
    expect(workflow).toContain("path: ${{ matrix.package-path }}");
    expect(workflow).not.toContain("pull_request:");
  });

  it("limits write permission to the publishing job", () => {
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow.match(/contents: write/gu)).toHaveLength(1);
    expect(workflow).toContain("--prerelease");
  });

  it("fails closed around temporary macOS credentials and verifies Gatekeeper", () => {
    expect(workflow).toContain("MACOS_CERTIFICATE_P12_BASE64");
    expect(workflow).toContain("APPLE_API_KEY_P8_BASE64");
    expect(workflow).toContain("./scripts/prepare-macos-ci-signing.sh");
    expect(workflow).toContain("./scripts/verify-macos-release.sh");
    expect(workflow).toContain("if: always() && runner.os == 'macOS'");
    expect(workflow).toContain("./scripts/cleanup-macos-ci-signing.sh");
    expect(
      prepareMacSigning.indexOf("OUTGROOVE_MAC_TEMP_CERTIFICATE="),
    ).toBeLessThan(prepareMacSigning.indexOf("base64 --decode"));
    expect(cleanupMacSigning).toContain('if [[ "$path" != "$RUNNER_TEMP/"* ]]');
  });
});
