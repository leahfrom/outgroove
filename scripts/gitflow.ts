import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  compareVersions,
  isStableSemver,
  validatePullRequest,
  validBranchSuffix,
} from "./gitflow-policy";

interface PackageManifest {
  name?: unknown;
  version?: unknown;
  packages?: Record<string, { version?: unknown }>;
}

function fail(message: string): never {
  throw new Error(message);
}

function execute(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(result.stderr.trim() || `${command} ${args.join(" ")} failed.`);
  }
  return result.stdout.trim();
}

function git(...args: string[]): string {
  return execute("git", args);
}

function currentBranch(): string {
  return git("branch", "--show-current");
}

function requireBranch(expected: string): void {
  const actual = currentBranch();
  if (actual !== expected) {
    fail(
      `Expected branch ${expected}, but currently on ${actual || "detached HEAD"}.`,
    );
  }
}

function requireCleanWorktree(): void {
  if (git("status", "--porcelain") !== "") {
    fail("The worktree must be clean before changing Gitflow branches.");
  }
}

function readJson(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest;
}

function packageVersion(): string {
  const version = readJson("package.json").version;
  if (typeof version !== "string" || !isStableSemver(version)) {
    fail("package.json must contain a stable SemVer version.");
  }
  return version;
}

function checkVersion(): void {
  const manifest = readJson("package.json");
  const lockfile = readJson("package-lock.json");
  const version = packageVersion();
  if (
    lockfile.version !== version ||
    lockfile.packages?.[""]?.version !== version
  ) {
    fail("package.json and package-lock.json versions do not match.");
  }
  if (manifest.name !== "outgroove" || lockfile.name !== "outgroove") {
    fail("The package manifests must identify Outgroove consistently.");
  }
  console.log(`Version ${version} is synchronized.`);
}

function requireNewVersion(version: string): void {
  if (!isStableSemver(version)) {
    fail("Use a stable SemVer version such as 0.2.0.");
  }
  if (compareVersions(version, packageVersion()) <= 0) {
    fail(`${version} must be greater than the current package version.`);
  }
}

function setVersion(version: string): void {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  execute(npmCommand, ["version", version, "--no-git-tag-version"]);
  checkVersion();
}

function startFeature(name: string | undefined): void {
  if (name === undefined || !validBranchSuffix(name)) {
    fail(
      "Provide a lowercase feature name using letters, numbers, dots, dashes, or underscores.",
    );
  }
  requireBranch("develop");
  requireCleanWorktree();
  git("switch", "-c", `feature/${name}`);
  console.log(
    `Started feature/${name}. Open its pull request against develop.`,
  );
}

function startVersionBranch(
  kind: "release" | "hotfix",
  version: string | undefined,
): void {
  if (version === undefined) fail(`Provide the ${kind} version.`);
  requireBranch(kind === "release" ? "develop" : "main");
  requireCleanWorktree();
  requireNewVersion(version);
  git("switch", "-c", `${kind}/${version}`);
  setVersion(version);
  console.log(
    `Started ${kind}/${version}. Commit the version files after completing release changes.`,
  );
}

function validatePr(): void {
  const base = process.env.BASE_BRANCH;
  const head = process.env.HEAD_BRANCH;
  if (base === undefined || head === undefined) {
    fail("BASE_BRANCH and HEAD_BRANCH are required.");
  }
  const result = validatePullRequest({ base, head });
  if (!result.valid) fail(result.reason);
  console.log(result.reason);
}

function validateReleaseTag(): void {
  const tag = process.env.RELEASE_TAG;
  const expected = `v${packageVersion()}`;
  if (tag !== expected) {
    fail(
      `Release tag ${tag ?? "<missing>"} does not match package version ${expected}.`,
    );
  }
  checkVersion();
  console.log(`Release tag ${tag} matches the package version.`);
}

function tagRelease(): void {
  requireBranch("main");
  requireCleanWorktree();
  checkVersion();
  const version = packageVersion();
  const tag = `v${version}`;
  if (git("tag", "--list", tag) !== "") fail(`${tag} already exists.`);
  git("tag", "-a", tag, "-m", `Outgroove ${version}`);
  console.log(
    `Created ${tag}. Review it, then push it explicitly with: git push origin ${tag}`,
  );
}

const [command, argument] = process.argv.slice(2);

try {
  switch (command) {
    case "check-version":
      checkVersion();
      break;
    case "start-feature":
      startFeature(argument);
      break;
    case "start-release":
      startVersionBranch("release", argument);
      break;
    case "start-hotfix":
      startVersionBranch("hotfix", argument);
      break;
    case "validate-pr":
      validatePr();
      break;
    case "validate-release-tag":
      validateReleaseTag();
      break;
    case "tag-release":
      tagRelease();
      break;
    default:
      fail("Unknown Gitflow command.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
