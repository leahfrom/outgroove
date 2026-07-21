import { describe, expect, it } from "vitest";

import {
  compareVersions,
  isStableSemver,
  validatePullRequest,
  validBranchSuffix,
} from "../../scripts/gitflow-policy";

describe("Gitflow policy", () => {
  it("allows only release and hotfix branches into main", () => {
    expect(
      validatePullRequest({ base: "main", head: "release/0.2.0" }).valid,
    ).toBe(true);
    expect(
      validatePullRequest({ base: "main", head: "hotfix/0.1.1" }).valid,
    ).toBe(true);
    expect(
      validatePullRequest({ base: "main", head: "feature/library-search" })
        .valid,
    ).toBe(false);
    expect(validatePullRequest({ base: "main", head: "develop" }).valid).toBe(
      false,
    );
  });

  it("routes feature work and release back-merges through develop", () => {
    expect(
      validatePullRequest({ base: "develop", head: "feature/library-search" })
        .valid,
    ).toBe(true);
    expect(
      validatePullRequest({ base: "develop", head: "release/0.2.0" }).valid,
    ).toBe(true);
    expect(validatePullRequest({ base: "develop", head: "main" }).valid).toBe(
      true,
    );
    expect(
      validatePullRequest({ base: "other", head: "feature/nope" }).valid,
    ).toBe(false);
  });

  it("validates stable versions and safe branch suffixes", () => {
    expect(isStableSemver("0.2.0")).toBe(true);
    expect(isStableSemver("01.2.0")).toBe(false);
    expect(isStableSemver("1.0.0-beta.1")).toBe(false);
    expect(compareVersions("1.0.0", "0.10.9")).toBe(1);
    expect(validBranchSuffix("scan-progress_2")).toBe(true);
    expect(validBranchSuffix("../main")).toBe(false);
    expect(validBranchSuffix("bad.lock")).toBe(false);
  });
});
