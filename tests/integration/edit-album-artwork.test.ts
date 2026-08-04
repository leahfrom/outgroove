import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadTrack, PictureKind } from "@akabeko/music-metadata-editor";
import { afterEach, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { MusicMetadataReader } from "../../src/main/adapters/metadata/metadata-reader";
import {
  audioPayloadHash,
  SafeMetadataWriter,
} from "../../src/main/adapters/metadata/metadata-writer";
import { EditAlbumArtwork } from "../../src/main/application/edit-album-artwork";
import { pathComparisonKey } from "../../src/main/application/scan-library";

const temporary: string[] = [];
const selectedPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8r1AAAAAElFTkSuQmCC",
  "base64",
);

afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

function picturesFingerprint(
  pictures: Awaited<ReturnType<typeof loadTrack>>["pictures"],
): string {
  const hash = createHash("sha256");
  for (const picture of pictures) {
    hash.update(
      JSON.stringify([
        picture.mimeType,
        picture.kind,
        picture.description ?? null,
      ]),
    );
    hash.update(picture.data);
  }
  return hash.digest("hex");
}

async function createArtworkEditor() {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-artwork-edit-"));
  temporary.push(directory);
  const reader = new MusicMetadataReader();
  const writer = new SafeMetadataWriter(reader);
  const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
  const root = database.addLibraryRoot(directory, pathComparisonKey(directory));
  const files = await Promise.all(
    ["preservation.mp3", "preservation.flac"].map(async (fixture) => {
      const path = join(directory, fixture);
      await copyFile(
        join(process.cwd(), "fixtures", "audio", "preservation", fixture),
        path,
      );
      const fileId = database.upsertScannedFile(
        root.id,
        pathComparisonKey(path),
        await reader.read(path),
      );
      return { fileId, path };
    }),
  );
  const albumId = database.getTrackAlbumId(files[0]?.fileId ?? "");
  if (!albumId) throw new Error("Preservation album missing");
  const selectedPath = join(directory, "selected.png");
  await writeFile(selectedPath, selectedPng);
  return {
    albumId,
    database,
    files,
    selectedPath,
    reader,
    writer,
    editor: new EditAlbumArtwork(database, writer, {
      encode: () => "data:image/png;base64,preview",
    }),
  };
}

it("previews, confirms, verifies, deduplicates snapshots, and restores album artwork", async () => {
  const { albumId, database, editor, files, selectedPath } =
    await createArtworkEditor();
  const beforePictures = await Promise.all(
    files.map(({ path }) =>
      loadTrack(path).then((track) => picturesFingerprint(track.pictures)),
    ),
  );
  const payloads = await Promise.all(
    files.map(({ path }) => audioPayloadHash(path)),
  );

  const preview = await editor.preview(
    albumId,
    selectedPath,
    files.map((file) => file.fileId),
  );
  expect(preview).toMatchObject({
    action: "replace",
    mimeType: "image/png",
    width: 1,
    height: 1,
  });
  expect(preview.files.every((file) => file.willWrite)).toBe(true);
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
    "album-artwork-edit",
  );
  expect(result.results.every((item) => item.verified)).toBe(true);
  for (const [index, file] of files.entries()) {
    const pictures = (await loadTrack(file.path)).pictures;
    expect(
      pictures.find((picture) => picture.kind === PictureKind.CoverFront)?.data,
    ).toEqual(new Uint8Array(selectedPng));
    expect(await audioPayloadHash(file.path)).toBe(payloads[index]);
  }
  expect(
    database.connection
      .prepare("SELECT count(*) FROM artwork_assets")
      .pluck()
      .get(),
  ).toBe(2);
  expect(database.listArtworkSnapshots(preview.operationId)).toHaveLength(2);
  expect(database.listEditHistory(albumId)[0]).toMatchObject({
    kind: "album-artwork-edit",
    verifiedFiles: 2,
  });

  const undoPreview = await editor.previewUndo(preview.operationId);
  expect(undoPreview.action).toBe("restore");
  const undo = await editor.apply(
    undoPreview.operationId,
    undoPreview.confirmationToken,
    "album-artwork-undo",
  );
  expect(undo.results.every((item) => item.verified)).toBe(true);
  for (const [index, file] of files.entries())
    expect(picturesFingerprint((await loadTrack(file.path)).pictures)).toBe(
      beforePictures[index],
    );
  database.close();
});

it("changes only explicitly selected album tracks and rejects foreign selection", async () => {
  const { albumId, database, editor, files, selectedPath, writer } =
    await createArtworkEditor();
  const selected = files[0];
  const unselected = files[1];
  if (!selected || !unselected) throw new Error("Fixture files missing");
  const selectedBefore = picturesFingerprint(
    await writer.readPictures(selected.path),
  );
  const unselectedBefore = picturesFingerprint(
    await writer.readPictures(unselected.path),
  );
  const payloads = await Promise.all(
    files.map(({ path }) => audioPayloadHash(path)),
  );

  await expect(
    editor.preview(albumId, selectedPath, [selected.fileId, randomUUID()]),
  ).rejects.toThrow("Every selected track must belong to this album.");
  await expect(
    editor.preview(albumId, selectedPath, [selected.fileId, selected.fileId]),
  ).rejects.toThrow("Choose each track only once.");

  const preview = await editor.preview(albumId, selectedPath, [
    selected.fileId,
  ]);
  expect(preview.files).toHaveLength(1);
  expect(preview.files[0]).toMatchObject({
    fileId: selected.fileId,
    willWrite: true,
  });
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
    "album-artwork-edit",
  );
  expect(result.results).toMatchObject([
    { fileId: selected.fileId, verified: true, error: null },
  ]);
  expect(
    picturesFingerprint(await writer.readPictures(selected.path)),
  ).not.toBe(selectedBefore);
  expect(picturesFingerprint(await writer.readPictures(unselected.path))).toBe(
    unselectedBefore,
  );
  for (const [index, file] of files.entries())
    expect(await audioPayloadHash(file.path)).toBe(payloads[index]);

  const undoPreview = await editor.previewUndo(preview.operationId);
  expect(undoPreview.files).toHaveLength(1);
  const undo = await editor.apply(
    undoPreview.operationId,
    undoPreview.confirmationToken,
    "album-artwork-undo",
  );
  expect(undo.results).toMatchObject([
    { fileId: selected.fileId, verified: true, error: null },
  ]);
  expect(picturesFingerprint(await writer.readPictures(selected.path))).toBe(
    selectedBefore,
  );
  expect(picturesFingerprint(await writer.readPictures(unselected.path))).toBe(
    unselectedBefore,
  );
  database.close();
});

it("previews a provider image through the same verified MP3/FLAC write and undo path", async () => {
  const { albumId, database, editor, files, reader } =
    await createArtworkEditor();
  const beforePictures = await Promise.all(
    files.map(({ path }) =>
      loadTrack(path).then((track) => picturesFingerprint(track.pictures)),
    ),
  );
  const payloads = await Promise.all(
    files.map(({ path }) => audioPayloadHash(path)),
  );
  const privateTags = await Promise.all(
    files.map(({ path }) =>
      reader
        .read(path)
        .then((metadata) =>
          metadata.nativeTags.filter((tag) =>
            tag.id.includes("OUTGROOVE_PRIVATE"),
          ),
        ),
    ),
  );
  expect(privateTags.every((tags) => tags.length > 0)).toBe(true);

  const preview = await editor.previewData(albumId, selectedPng, {
    kind: "cover-art-archive",
    releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
    artworkId: "829521842",
  });
  expect(preview).toMatchObject({
    action: "replace",
    proposedArtworkSource: {
      kind: "cover-art-archive",
      releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
      artworkId: "829521842",
    },
    mimeType: "image/png",
    width: 1,
    height: 1,
  });
  expect(preview.files.every((file) => file.willWrite)).toBe(true);
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
    "album-artwork-edit",
  );
  expect(result.results.every((item) => item.verified)).toBe(true);
  for (const [index, file] of files.entries()) {
    expect(await audioPayloadHash(file.path)).toBe(payloads[index]);
    const after = await reader.read(file.path);
    for (const privateTag of privateTags[index] ?? []) {
      const nativeId = privateTag.id.replace(/^ID3v2\.\d:/u, "");
      expect(
        after.nativeTags.some(
          (tag) => tag.id.endsWith(nativeId) && tag.value === privateTag.value,
        ),
      ).toBe(true);
    }
  }

  const noOpPreview = await editor.previewData(albumId, selectedPng, {
    kind: "cover-art-archive",
    releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
    artworkId: "829521842",
  });
  expect(noOpPreview.files.every((item) => !item.willWrite)).toBe(true);
  const noOpResult = await editor.apply(
    noOpPreview.operationId,
    noOpPreview.confirmationToken,
    "album-artwork-edit",
  );
  expect(noOpResult.results.every((item) => item.verified)).toBe(true);
  for (const [index, file] of files.entries())
    expect(await audioPayloadHash(file.path)).toBe(payloads[index]);

  const undoPreview = await editor.previewUndo(preview.operationId);
  const undo = await editor.apply(
    undoPreview.operationId,
    undoPreview.confirmationToken,
    "album-artwork-undo",
  );
  expect(undo.results.every((item) => item.verified)).toBe(true);
  for (const [index, file] of files.entries())
    expect(picturesFingerprint((await loadTrack(file.path)).pictures)).toBe(
      beforePictures[index],
    );
  database.close();
});

it("removes only embedded front covers, preserves audio and other pictures, and supports undo", async () => {
  const { albumId, database, editor, files, writer } =
    await createArtworkEditor();
  for (const file of files) {
    const current = await writer.readPictures(file.path);
    await writer.writePictures(file.path, [
      ...current,
      {
        mimeType: "image/png",
        kind: PictureKind.CoverFront,
        description: "Remove this front cover",
        data: selectedPng,
      },
      {
        mimeType: "image/png",
        kind: PictureKind.CoverBack,
        description: "Preserve this back cover",
        data: selectedPng,
      },
    ]);
  }
  const beforePictures = await Promise.all(
    files.map(({ path }) => writer.readPictures(path)),
  );
  const payloads = await Promise.all(
    files.map(({ path }) => audioPayloadHash(path)),
  );

  const preview = await editor.previewRemoval(
    albumId,
    files.map((file) => file.fileId),
  );
  expect(preview).toMatchObject({ action: "remove" });
  expect(preview).not.toHaveProperty("proposedArtworkDataUrl");
  expect(
    preview.files.every(
      (file) =>
        file.currentFrontCovers > 0 &&
        file.preservedPictures > 0 &&
        file.willWrite,
    ),
  ).toBe(true);
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
    "album-artwork-edit",
  );
  expect(result.results.every((item) => item.verified)).toBe(true);
  for (const [index, file] of files.entries()) {
    const pictures = await writer.readPictures(file.path);
    expect(
      pictures.some((picture) => picture.kind === PictureKind.CoverFront),
    ).toBe(false);
    expect(picturesFingerprint(pictures)).toBe(
      picturesFingerprint(
        (beforePictures[index] ?? []).filter(
          (picture) => picture.kind !== PictureKind.CoverFront,
        ),
      ),
    );
    expect(await audioPayloadHash(file.path)).toBe(payloads[index]);
  }
  expect(database.listEditHistory(albumId)[0]).toMatchObject({
    kind: "album-artwork-edit",
    proposedTitle: "Remove embedded front cover",
    verifiedFiles: 2,
  });

  const undoPreview = await editor.previewUndo(preview.operationId);
  expect(undoPreview.action).toBe("restore");
  const undo = await editor.apply(
    undoPreview.operationId,
    undoPreview.confirmationToken,
    "album-artwork-undo",
  );
  expect(undo.results.every((item) => item.verified)).toBe(true);
  for (const [index, file] of files.entries())
    expect(picturesFingerprint(await writer.readPictures(file.path))).toBe(
      picturesFingerprint(beforePictures[index] ?? []),
    );
  database.close();
});

it("refuses one stale file without aborting the other confirmed artwork removal", async () => {
  const { albumId, database, editor, files, writer } =
    await createArtworkEditor();
  for (const file of files) {
    const current = await writer.readPictures(file.path);
    await writer.writePictures(file.path, [
      ...current,
      {
        mimeType: "image/png",
        kind: PictureKind.CoverFront,
        description: "Front cover",
        data: selectedPng,
      },
    ]);
  }
  const preview = await editor.previewRemoval(
    albumId,
    files.map((file) => file.fileId),
  );
  const first = files[0];
  if (!first) throw new Error("Fixture file missing");
  const current = await writer.readPictures(first.path);
  await writer.writePictures(first.path, [
    ...current,
    {
      mimeType: "image/png",
      kind: PictureKind.CoverBack,
      description: "External change",
      data: selectedPng,
    },
  ]);

  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
    "album-artwork-edit",
  );
  expect(
    result.results.find((item) => item.fileId === first.fileId),
  ).toMatchObject({
    verified: false,
    error:
      "Embedded artwork changed after the preview; this file was not overwritten.",
  });
  expect(
    result.results.filter((item) => item.fileId !== first.fileId),
  ).toMatchObject([{ verified: true, error: null }]);
  expect(database.listEditHistory(albumId)[0]).toMatchObject({
    state: "failed",
    verifiedFiles: 1,
    failedFiles: 1,
  });
  database.close();
});
