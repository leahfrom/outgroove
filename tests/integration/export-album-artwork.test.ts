import { createHash } from "node:crypto";
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { readLocalArtwork } from "../../src/main/adapters/artwork/local-artwork";
import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { MusicMetadataReader } from "../../src/main/adapters/metadata/metadata-reader";
import {
  type ArtworkExportHooks,
  ExportAlbumArtwork,
} from "../../src/main/application/export-album-artwork";
import { pathComparisonKey } from "../../src/main/application/scan-library";

const temporary: string[] = [];

afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

async function createExporter(
  fixtures: readonly string[],
  hooks: ArtworkExportHooks = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-artwork-export-"));
  temporary.push(directory);
  const reader = new MusicMetadataReader();
  const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
  const root = database.addLibraryRoot(directory, pathComparisonKey(directory));
  const files = await Promise.all(
    fixtures.map(async (fixture) => {
      const path = join(directory, basename(fixture));
      await copyFile(join(process.cwd(), "fixtures", "audio", fixture), path);
      const fileId = database.upsertScannedFile(
        root.id,
        pathComparisonKey(path),
        await reader.read(path),
      );
      return { fileId, path };
    }),
  );
  const albumId = database.getTrackAlbumId(files[0]?.fileId ?? "");
  if (!albumId) throw new Error("Fixture album missing");
  return {
    albumId,
    database,
    directory,
    files,
    exporter: new ExportAlbumArtwork(
      database,
      {
        encode: () => "data:image/png;base64,preview",
      },
      hooks,
    ),
  };
}

it("previews and exclusively exports the same embedded artwork used by Library", async () => {
  const { albumId, database, directory, exporter, files } =
    await createExporter([
      "preservation/preservation.mp3",
      "preservation/preservation.flac",
    ]);
  const album = database.getAlbum(albumId);
  const sourceTrack = album?.tracks[0];
  if (!sourceTrack) throw new Error("Fixture track missing");
  const candidate = await readLocalArtwork(sourceTrack.path);
  if (candidate.status !== "available")
    throw new Error("Fixture artwork missing");
  const sourceBefore = await Promise.all(
    files.map(({ path }) => readFile(path)),
  );

  const preview = await exporter.preview(albumId);
  expect(preview).toMatchObject({
    source: "embedded",
    mimeType: "image/png",
    suggestedFileName: "cover.png",
  });
  expect(preview.artworkDataUrl).toBe("data:image/png;base64,preview");
  const destination = join(directory, "exported-cover.png");
  const result = await exporter.exportTo(
    preview.operationId,
    preview.confirmationToken,
    destination,
  );

  expect(await readFile(destination)).toEqual(Buffer.from(candidate.data));
  expect(result).toEqual({
    destinationPath: destination,
    byteLength: candidate.data.byteLength,
    sha256: createHash("sha256").update(candidate.data).digest("hex"),
  });
  for (const [index, file] of files.entries())
    expect(await readFile(file.path)).toEqual(sourceBefore[index]);
  database.close();
});

it("exports folder artwork without modifying or exposing its source path", async () => {
  const { albumId, database, directory, exporter } = await createExporter([
    "album/01-first.mp3",
  ]);
  const embedded = await readLocalArtwork(
    join(
      process.cwd(),
      "fixtures",
      "audio",
      "preservation",
      "preservation.mp3",
    ),
  );
  if (embedded.status !== "available")
    throw new Error("Fixture artwork missing");
  await writeFile(join(directory, "cover.png"), embedded.data);

  const preview = await exporter.preview(albumId);

  expect(preview.source).toBe("folder");
  expect(preview).not.toHaveProperty("sourcePath");
  database.close();
});

it("refuses an existing destination and keeps both files unchanged", async () => {
  const { albumId, database, directory, exporter, files } =
    await createExporter(["preservation/preservation.flac"]);
  const preview = await exporter.preview(albumId);
  const destination = join(directory, "existing.png");
  const existing = Buffer.from("user-owned destination");
  const audioBefore = await readFile(files[0]?.path ?? "");
  await writeFile(destination, existing);

  await expect(
    exporter.exportTo(
      preview.operationId,
      preview.confirmationToken,
      destination,
    ),
  ).rejects.toThrow("already exists");
  expect(await readFile(destination)).toEqual(existing);
  expect(await readFile(files[0]?.path ?? "")).toEqual(audioBefore);
  expect(
    (await readdir(directory)).filter((name) => name.includes(".outgroove-")),
  ).toEqual([]);
  database.close();
});

it("rejects stale confirmation tokens and mismatched file extensions", async () => {
  const { albumId, database, directory, exporter } = await createExporter([
    "preservation/preservation.mp3",
  ]);
  const preview = await exporter.preview(albumId);
  await expect(
    exporter.exportTo(
      preview.operationId,
      "different-confirmation-token",
      join(directory, "cover.png"),
    ),
  ).rejects.toThrow("current preview");
  await expect(
    exporter.exportTo(
      preview.operationId,
      preview.confirmationToken,
      join(directory, "cover.jpg"),
    ),
  ).rejects.toThrow(".png destination");
  database.close();
});

it("preserves a destination changed externally before export verification", async () => {
  const external = Buffer.from("external replacement");
  const { albumId, database, directory, exporter, files } =
    await createExporter(["preservation/preservation.flac"], {
      afterInstall: async (destinationPath) => {
        await writeFile(destinationPath, external);
      },
    });
  const preview = await exporter.preview(albumId);
  const destination = join(directory, "changed-after-install.png");
  const audioBefore = await readFile(files[0]?.path ?? "");

  await expect(
    exporter.exportTo(
      preview.operationId,
      preview.confirmationToken,
      destination,
    ),
  ).rejects.toThrow("changed before verification");
  expect(await readFile(destination)).toEqual(external);
  expect(await readFile(files[0]?.path ?? "")).toEqual(audioBefore);
  expect(
    (await readdir(directory)).filter((name) => name.includes(".outgroove-")),
  ).toEqual([]);
  database.close();
});
