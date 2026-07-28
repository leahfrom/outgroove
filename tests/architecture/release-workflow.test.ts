import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("release workflow", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github", "workflows", "release.yml"),
    "utf8",
  );

  it("publishes only stable SemVer tags after all platform builds", () => {
    expect(workflow).toContain('"v[0-9]+.[0-9]+.[0-9]+"');
    expect(workflow).toContain("needs: build");
    expect(workflow).toContain("npm run flow:validate-release-tag");
    expect(workflow.match(/out\/make\/zip\//gu)).toHaveLength(3);
    expect(workflow).toContain("out/make/squirrel.windows/x64/*Setup.exe");
    expect(workflow).toContain(
      "sha256sum release-assets/*.zip release-assets/*.exe",
    );
    expect(workflow).toContain("path: ${{ matrix.package-path }}");
    expect(workflow).not.toContain("pull_request:");
  });

  it("limits write permission to the publishing job", () => {
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow.match(/contents: write/gu)).toHaveLength(1);
    expect(workflow).toContain("--prerelease");
  });
});
