import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) =>
      entry.isDirectory()
        ? sourceFiles(join(directory, entry.name))
        : [join(directory, entry.name)],
    ),
  );
  return nested.flat().filter((path) => /\.(?:ts|tsx)$/u.test(path));
}

describe("renderer privilege boundary", () => {
  it("contains no imports from Electron, Node, SQLite, main, or workers", async () => {
    const files = await sourceFiles(join(process.cwd(), "src", "renderer"));
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(
        /from\s+['"](?:electron|node:|better-sqlite3|.*\/(?:main|workers)\/)/u,
      );
    }
  });
});
