import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

describe("database migration and backup", () => {
  it("migrates an empty database and opens a verified backup", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-db-"));
    temporary.push(directory);
    const source = new CatalogDatabase(join(directory, "source.sqlite3"));
    expect(source.connection.pragma("user_version", { simple: true })).toBe(1);
    source.addLibraryRoot("/fixture/library", "/fixture/library");
    await source.backup(join(directory, "backup.sqlite3"));
    source.close();
    const backup = new CatalogDatabase(join(directory, "backup.sqlite3"));
    expect(
      backup.connection.prepare("PRAGMA integrity_check").pluck().get(),
    ).toBe("ok");
    expect(
      backup.connection
        .prepare("SELECT count(*) FROM library_roots")
        .pluck()
        .get(),
    ).toBe(1);
    backup.close();
  });
});
