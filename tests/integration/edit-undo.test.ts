import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CatalogDatabase } from "../../src/main/adapters/database/catalog-database";
import { MusicMetadataReader } from "../../src/main/adapters/metadata/metadata-reader";
import {
  audioPayloadHash,
  SafeMetadataWriter,
} from "../../src/main/adapters/metadata/metadata-writer";
import { EditAlbumTitle } from "../../src/main/application/edit-album-title";
import { pathComparisonKey } from "../../src/main/application/scan-library";

const temporary: string[] = [];

afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

async function createWorkbench(fixtures: readonly string[]) {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-edit-undo-"));
  temporary.push(directory);
  const reader = new MusicMetadataReader();
  const writer = new SafeMetadataWriter(reader);
  const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
  const root = database.addLibraryRoot(directory, pathComparisonKey(directory));
  for (const fixture of fixtures) {
    const path = join(directory, basename(fixture));
    await copyFile(
      join(process.cwd(), "fixtures", "audio", "album", fixture),
      path,
    );
    database.upsertScannedFile(
      root.id,
      pathComparisonKey(path),
      await reader.read(path),
    );
  }
  const album = database.listAlbums()[0];
  if (!album) throw new Error("Fixture album missing.");
  return {
    database,
    reader,
    writer,
    editor: new EditAlbumTitle(database, writer),
    album,
  };
}

describe("album-title edit history and honest undo", () => {
  it("previews, confirms, safely restores, re-reads, and records MP3/FLAC undo", async () => {
    const { database, reader, editor, album } = await createWorkbench([
      "01-first.mp3",
      "02-second.flac",
    ]);
    const originalTitles = new Map(
      album.tracks.map((track) => [track.id, track.tags.album]),
    );
    const originalPayloads = new Map(
      await Promise.all(
        album.tracks.map(
          async (track) =>
            [track.path, await audioPayloadHash(track.path)] as const,
        ),
      ),
    );
    const editPreview = editor.preview(album.id, "Temporary Album Title");
    const editResult = await editor.apply(
      editPreview.operationId,
      editPreview.confirmationToken,
    );
    expect(editResult.results.every((result) => result.verified)).toBe(true);

    const renamedAlbum = database.listAlbums()[0];
    if (!renamedAlbum) throw new Error("Renamed album missing.");
    expect(editor.history(renamedAlbum.id)).toMatchObject([
      {
        operationId: editPreview.operationId,
        kind: "album-title-edit",
        state: "completed",
        verifiedFiles: 2,
        failedFiles: 0,
      },
    ]);

    const undoPreview = editor.previewUndo(editPreview.operationId);
    expect(undoPreview.files).toHaveLength(2);
    expect(undoPreview.files.every((file) => file.warnings.length === 0)).toBe(
      true,
    );
    const undoResult = await editor.applyUndo(
      undoPreview.operationId,
      undoPreview.confirmationToken,
    );
    expect(undoResult.results.every((result) => result.verified)).toBe(true);
    for (const result of undoResult.results) {
      const reread = await reader.read(result.path);
      expect(reread.tags.album).toBe(originalTitles.get(result.fileId));
      expect(await audioPayloadHash(result.path)).toBe(
        originalPayloads.get(result.path),
      );
    }

    const restoredAlbum = database.listAlbums()[0];
    if (!restoredAlbum) throw new Error("Restored album missing.");
    expect(editor.history(restoredAlbum.id).map((item) => item.kind)).toEqual([
      "album-title-undo",
      "album-title-edit",
    ]);
    database.close();
  });

  it("revalidates after preview and never overwrites an intervening title", async () => {
    const { database, reader, writer, editor, album } = await createWorkbench([
      "01-first.mp3",
    ]);
    const editPreview = editor.preview(album.id, "Outgroove Edit");
    await editor.apply(editPreview.operationId, editPreview.confirmationToken);
    const editedTrack = database.listAlbums()[0]?.tracks[0];
    if (!editedTrack) throw new Error("Edited track missing.");
    const manual = await writer.writeAlbumTitle(
      editedTrack.path,
      "Intervening Manual Title",
    );
    database.updateFileAfterEdit(editedTrack.id, manual.file);

    const undoPreview = editor.previewUndo(editPreview.operationId);
    expect(undoPreview.files[0]?.warnings.join(" ")).toContain(
      "changed after this edit",
    );
    const result = await editor.applyUndo(
      undoPreview.operationId,
      undoPreview.confirmationToken,
    );
    expect(result.results).toMatchObject([
      {
        verified: false,
        error:
          "The album title changed after the original edit; undo did not overwrite it.",
      },
    ]);
    expect((await reader.read(editedTrack.path)).tags.album).toBe(
      "Intervening Manual Title",
    );
    expect(editor.history(database.listAlbums()[0]?.id ?? "")[0]).toMatchObject(
      { kind: "album-title-undo", state: "failed" },
    );
    database.close();
  });
});
