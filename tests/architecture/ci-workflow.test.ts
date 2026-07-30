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

  it("keeps the routine Linux verification, package, and smoke job", () => {
    expect(workflow).not.toContain("macos-latest");
    expect(workflow).toContain("ubuntu-latest");
    expect(workflow).toContain("Verify, package, and smoke (Linux)");
    expect(workflow).toContain("xvfb-run -a npm run test:smoke");
  });

  it("runs complete verification, packaging, and smoke on Windows", () => {
    expect(workflow).toContain("Verify, package, and smoke (Windows)");
    expect(workflow).toContain("runs-on: windows-2022");
    expect(workflow).toContain("timeout-minutes: 30");
    expect(workflow).toContain(
      "npm test -- --maxWorkers=2 --testTimeout=15000",
    );
    expect(workflow.match(/npm run format:check/gu)).toHaveLength(1);
    expect(workflow.match(/npm run lint/gu)).toHaveLength(1);
    expect(workflow.match(/npm run typecheck/gu)).toHaveLength(1);
    expect(workflow.match(/npm run version:check/gu)).toHaveLength(1);
    expect(workflow.match(/npm run package/gu)).toHaveLength(2);
    expect(workflow.match(/npm run test:smoke/gu)).toHaveLength(2);
    expect(workflow).not.toContain("continue-on-error");
  });

  it("keeps packaging and smoke required in both jobs", () => {
    expect(workflow).toContain("npm run package");
    expect(workflow).toContain("npm run test:smoke");
  });
});
