import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { MusicMetadataReader } from "../../src/main/adapters/metadata/metadata-reader";
import {
  CreateAlbumFolderArtwork,
  type FolderArtworkCreationHooks,
} from "../../src/main/application/create-album-folder-artwork";
import { pathComparisonKey } from "../../src/main/application/scan-library";

const temporary: string[] = [];

afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

async function createCreator(
  fixtures: readonly string[],
  hooks: FolderArtworkCreationHooks = {},
  folders?: readonly string[],
) {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-folder-artwork-"));
  temporary.push(directory);
  const reader = new MusicMetadataReader();
  const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
  const root = database.addLibraryRoot(directory, pathComparisonKey(directory));
  const files = await Promise.all(
    fixtures.map(async (fixture, index) => {
      const targetFolder = join(directory, folders?.[index] ?? "");
      await mkdir(targetFolder, { recursive: true });
      const path = join(targetFolder, basename(fixture));
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
    creator: new CreateAlbumFolderArtwork(
      database,
      { encode: () => "data:image/png;base64,preview" },
      hooks,
    ),
  };
}

it("previews and exclusively creates folder artwork without changing audio", async () => {
  const { albumId, creator, database, directory, files } = await createCreator([
    "preservation/preservation.mp3",
    "preservation/preservation.flac",
  ]);
  const audioBefore = await Promise.all(
    files.map(({ path }) => readFile(path)),
  );

  const preview = await creator.preview(albumId);
  expect(preview).toMatchObject({
    artworkDataUrl: "data:image/png;base64,preview",
    mimeType: "image/png",
    destinationPath: join(directory, "cover.png"),
  });
  expect(await readdir(directory)).not.toContain("cover.png");

  const result = await creator.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  const created = await readFile(join(directory, "cover.png"));
  expect(result).toEqual({
    albumId,
    destinationPath: join(directory, "cover.png"),
    byteLength: created.byteLength,
    sha256: createHash("sha256").update(created).digest("hex"),
  });
  for (const [index, file] of files.entries())
    expect(await readFile(file.path)).toEqual(audioBefore[index]);
  database.close();
});

it("refuses existing conventional artwork case-insensitively", async () => {
  const { albumId, creator, database, directory, files } = await createCreator([
    "preservation/preservation.mp3",
  ]);
  const existing = Buffer.from("user-owned folder artwork");
  const audioBefore = await readFile(files[0]?.path ?? "");
  await writeFile(join(directory, "Cover.PNG"), existing);

  await expect(creator.preview(albumId)).rejects.toThrow(
    "will not replace existing folder artwork",
  );
  expect(await readFile(join(directory, "Cover.PNG"))).toEqual(existing);
  expect(await readFile(files[0]?.path ?? "")).toEqual(audioBefore);
  database.close();
});

it("refuses albums whose tracks span multiple folders", async () => {
  const { albumId, creator, database, directory } = await createCreator(
    ["preservation/preservation.mp3", "preservation/preservation.flac"],
    {},
    ["disc-1", "disc-2"],
  );

  await expect(creator.preview(albumId)).rejects.toThrow(
    "every track is in one folder",
  );
  expect(await readdir(join(directory, "disc-1"))).not.toContain("cover.png");
  expect(await readdir(join(directory, "disc-2"))).not.toContain("cover.png");
  database.close();
});

it("rejects stale confirmations and an embedded cover changed after preview", async () => {
  const { albumId, creator, database, directory, files } = await createCreator([
    "preservation/preservation.mp3",
  ]);
  const preview = await creator.preview(albumId);
  await expect(
    creator.apply(preview.operationId, "different-confirmation-token"),
  ).rejects.toThrow("current preview");
  await writeFile(files[0]?.path ?? "", Buffer.from("externally changed"));
  await expect(
    creator.apply(preview.operationId, preview.confirmationToken),
  ).rejects.toThrow("embedded cover changed");
  expect(await readdir(directory)).not.toContain("cover.png");
  database.close();
});

it("preserves a destination changed externally during verification", async () => {
  const external = Buffer.from("external replacement");
  const { albumId, creator, database, directory, files } = await createCreator(
    ["preservation/preservation.flac"],
    {
      afterInstall: async (destinationPath) => {
        await writeFile(destinationPath, external);
      },
    },
  );
  const preview = await creator.preview(albumId);
  const audioBefore = await readFile(files[0]?.path ?? "");

  await expect(
    creator.apply(preview.operationId, preview.confirmationToken),
  ).rejects.toThrow("changed before verification");
  expect(await readFile(join(directory, "cover.png"))).toEqual(external);
  expect(await readFile(files[0]?.path ?? "")).toEqual(audioBefore);
  expect(
    (await readdir(directory)).filter((name) => name.includes(".outgroove-")),
  ).toEqual([]);
  database.close();
});
