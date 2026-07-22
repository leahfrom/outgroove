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

describe("saved Library filters", () => {
  it("persists validated definitions in deterministic order and includes them in backups", async () => {
    const directory = await mkdtemp(join(tmpdir(), "outgroove-filters-"));
    temporary.push(directory);
    const databasePath = join(directory, "catalog.sqlite3");
    const backupPath = join(directory, "backup.sqlite3");
    const database = new CatalogDatabase(databasePath);
    const format = database.createSavedLibraryFilter("Zeta FLAC", {
      query: "live",
      view: "tracks",
      format: "FLAC",
    });
    database.createSavedLibraryFilter("ambient without genre", {
      query: "",
      view: "tracks",
      genre: { name: "No genre tag", missing: true },
    });
    expect(
      database.listSavedLibraryFilters().map((saved) => saved.name),
    ).toEqual(["ambient without genre", "Zeta FLAC"]);
    await database.backup(backupPath);
    database.close();

    const reopened = new CatalogDatabase(databasePath);
    expect(reopened.listSavedLibraryFilters()[1]).toMatchObject({
      id: format.id,
      name: "Zeta FLAC",
      definition: { query: "live", view: "tracks", format: "FLAC" },
    });
    expect(() =>
      reopened.createSavedLibraryFilter("zeta flac", {
        query: "",
        view: "albums",
      }),
    ).toThrow("already exists");
    const ambient = reopened.listSavedLibraryFilters()[0];
    if (!ambient) throw new Error("Saved filter fixture missing.");
    const updated = reopened.updateSavedLibraryFilter(
      ambient.id,
      "Ambient albums",
      { query: "ambient", view: "albums" },
    );
    expect(updated).toEqual({
      ...ambient,
      name: "Ambient albums",
      definition: { query: "ambient", view: "albums" },
    });
    expect(
      reopened
        .listSavedLibraryFilters()
        .find((saved) => saved.id === ambient.id),
    ).toEqual(updated);
    expect(() =>
      reopened.updateSavedLibraryFilter(ambient.id, "zeta flac", {
        query: "",
        view: "albums",
      }),
    ).toThrow("already exists");
    expect(() =>
      reopened.updateSavedLibraryFilter(
        "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
        "Missing",
        { query: "", view: "albums" },
      ),
    ).toThrow("no longer exists");
    expect(reopened.deleteSavedLibraryFilter(format.id)).toEqual({
      id: format.id,
    });
    expect(() => reopened.deleteSavedLibraryFilter(format.id)).toThrow(
      "no longer exists",
    );
    reopened.close();

    const backup = new CatalogDatabase(backupPath);
    expect(backup.listSavedLibraryFilters()).toHaveLength(2);
    backup.close();
  });

  it("caps saved filters to a bounded local collection", () => {
    const database = new CatalogDatabase(":memory:");
    for (let index = 0; index < 100; index++)
      database.createSavedLibraryFilter(`Filter ${index}`, {
        query: String(index),
        view: "albums",
      });
    expect(() =>
      database.createSavedLibraryFilter("One too many", {
        query: "",
        view: "albums",
      }),
    ).toThrow("up to 100");
    database.close();
  });
});
