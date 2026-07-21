import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("CI workflow triggers", () => {
  const workflow = readFileSync(
    join(process.cwd(), ".github", "workflows", "ci.yml"),
    "utf8",
  );

  it("runs only for pull requests and cancels superseded work", () => {
    expect(workflow).not.toContain("  push:");
    expect(workflow).toContain(`pull_request:
    branches:
      - develop
      - main`);
    expect(workflow).toContain("cancel-in-progress: true");
  });

  it("uses one Linux package smoke job for routine pull requests", () => {
    expect(workflow).not.toContain("macos-latest");
    expect(workflow).not.toContain("windows-2022");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("npm run package");
    expect(workflow).toContain("npm run test:smoke");
  });
});
