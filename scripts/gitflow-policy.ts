export interface PullRequestBranches {
  base: string;
  head: string;
}

export interface PolicyResult {
  valid: boolean;
  reason: string;
}

const stableSemverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const branchSuffixPattern = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u;
const dependabotNpmPrefix = "dependabot/npm_and_yarn/";

export function isStableSemver(value: string): boolean {
  return stableSemverPattern.test(value);
}

export function compareVersions(left: string, right: string): number {
  if (!isStableSemver(left) || !isStableSemver(right)) {
    throw new Error("Versions must use stable SemVer (for example, 1.2.3).");
  }

  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export function validBranchSuffix(value: string): boolean {
  return (
    branchSuffixPattern.test(value) &&
    !value.includes("..") &&
    !value.endsWith(".lock")
  );
}

function isDependabotNpmBranch(value: string): boolean {
  return (
    value.startsWith(dependabotNpmPrefix) &&
    validBranchSuffix(value.slice(dependabotNpmPrefix.length))
  );
}

export function validatePullRequest({
  base,
  head,
}: PullRequestBranches): PolicyResult {
  if (base === "main") {
    const valid = /^(?:release|hotfix)\//u.test(head);
    return {
      valid,
      reason: valid
        ? "Release and hotfix branches may merge into main."
        : "main only accepts pull requests from release/* or hotfix/*.",
    };
  }

  if (base === "develop") {
    const valid =
      head === "main" ||
      /^(?:feature|release|hotfix)\//u.test(head) ||
      isDependabotNpmBranch(head);
    return {
      valid,
      reason: valid
        ? "The branch follows the Gitflow integration path."
        : "develop accepts feature/*, release/*, hotfix/*, Dependabot npm updates, or main back-merges.",
    };
  }

  return {
    valid: false,
    reason: "Pull requests must target develop or main.",
  };
}
