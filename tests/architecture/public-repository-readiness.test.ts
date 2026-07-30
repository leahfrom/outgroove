import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const readRepositoryFile = (...parts: string[]): string =>
  readFileSync(join(process.cwd(), ...parts), "utf8");

describe("public repository readiness", () => {
  const packageJson = JSON.parse(readRepositoryFile("package.json")) as Record<
    string,
    unknown
  >;
  const packageLock = JSON.parse(readRepositoryFile("package-lock.json")) as {
    packages: Record<string, Record<string, unknown>>;
  };
  const license = readRepositoryFile("LICENSE");
  const readme = readRepositoryFile("README.md");
  const contributing = readRepositoryFile("CONTRIBUTING.md");
  const security = readRepositoryFile("SECURITY.md");
  const notices = readRepositoryFile("THIRD_PARTY_NOTICES.md");
  const ci = readRepositoryFile(".github", "workflows", "ci.yml");
  const release = readRepositoryFile(".github", "workflows", "release.yml");

  it("declares the canonical GPL-3.0-or-later project license", () => {
    expect(packageJson.license).toBe("GPL-3.0-or-later");
    expect(packageJson.private).toBe(true);
    expect(packageLock.packages[""]?.license).toBe("GPL-3.0-or-later");
    expect(createHash("sha256").update(license).digest("hex")).toBe(
      "e57f1c320b8cf8798a7d2ff83a6f9e06a33a03585f6e065fea97f1d86db84052",
    );
    expect(readme).toContain("[GNU General Public License version 3 or later]");
    expect(notices).toContain("GPL-3.0-or-later");
  });

  it("publishes contribution, security, and detailed capability guidance", () => {
    expect(readme).toContain("[Security policy](SECURITY.md)");
    expect(readme).toContain("docs/current-capabilities.md");
    expect(contributing).toContain("Contribution license and provenance");
    expect(contributing).toContain("distributed\nunder that license");
    expect(security).toContain("/security/advisories/new");
    expect(security).toContain("Do not open a public issue");
    expect(readme).not.toContain("private GitHub prerelease");
    expect(readme).not.toContain("private non-commercial");
  });

  it("keeps fork pull-request CI read-only and free of release secrets", () => {
    expect(ci).toContain("pull_request:");
    expect(ci).not.toContain("pull_request_target:");
    expect(ci).toContain("permissions:\n  contents: read");
    expect(ci).not.toContain("secrets.");
    expect(release).not.toContain("pull_request:");
    expect(release).not.toContain("pull_request_target:");
    expect(release).toContain('tags:\n      - "v[0-9]+.[0-9]+.[0-9]+"');
    expect(release).toContain("--prerelease");
  });

  it("uses compatible direct dependency licenses", () => {
    const expectedLicenses = new Map([
      ["@akabeko/music-metadata-editor", "MIT"],
      ["better-sqlite3", "MIT"],
      ["electron", "MIT"],
      ["electron-squirrel-startup", "Apache-2.0"],
      ["music-metadata", "MIT"],
      ["react", "MIT"],
      ["react-dom", "MIT"],
      ["taglib-wasm", "MIT"],
      ["zod", "MIT"],
    ]);

    for (const [dependency, expectedLicense] of expectedLicenses) {
      const dependencyPackage = JSON.parse(
        readRepositoryFile("node_modules", dependency, "package.json"),
      ) as { license?: string };
      expect(dependencyPackage.license, dependency).toBe(expectedLicense);
    }
  });
});
