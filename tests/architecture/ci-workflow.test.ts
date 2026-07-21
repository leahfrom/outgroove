import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("CI workflow triggers", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github", "workflows", "ci.yml"),
    "utf8",
  );

  it("avoids duplicate feature-branch push and pull-request matrices", () => {
    expect(workflow).toContain(`push:
    branches:
      - develop
      - main`);
    expect(workflow).toContain(`pull_request:
    branches:
      - develop
      - main`);
  });

  it("retains the three-platform package matrix", () => {
    expect(workflow).toContain("macos-latest");
    expect(workflow).toContain("windows-2022");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("npm run package");
    expect(workflow).toContain("npm run test:smoke");
  });
});
