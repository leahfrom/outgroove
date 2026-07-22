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
import { EditTrackTags } from "../../src/main/application/edit-track-tags";
import { pathComparisonKey } from "../../src/main/application/scan-library";

const temporary: string[] = [];

afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

async function createTrackEditor(fixture: string) {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-track-edit-"));
  temporary.push(directory);
  const path = join(directory, basename(fixture));
  await copyFile(
    join(process.cwd(), "fixtures", "audio", "album", fixture),
    path,
  );
  const reader = new MusicMetadataReader();
  const writer = new SafeMetadataWriter(reader);
  const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
  const root = database.addLibraryRoot(directory, pathComparisonKey(directory));
  const fileId = database.upsertScannedFile(
    root.id,
    pathComparisonKey(path),
    await reader.read(path),
  );
  const albumId = database.getTrackAlbumId(fileId);
  if (!albumId) throw new Error("Fixture track missing.");
  return {
    database,
    reader,
    writer,
    editor: new EditTrackTags(database, writer),
    fileId,
    albumId,
    path,
  };
}

async function createBatchTrackEditor() {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-batch-edit-"));
  temporary.push(directory);
  const reader = new MusicMetadataReader();
  const writer = new SafeMetadataWriter(reader);
  const database = new CatalogDatabase(join(directory, "catalog.sqlite3"));
  const root = database.addLibraryRoot(directory, pathComparisonKey(directory));
  const files = await Promise.all(
    ["01-first.mp3", "02-second.flac"].map(async (fixture) => {
      const path = join(directory, fixture);
      await copyFile(
        join(process.cwd(), "fixtures", "audio", "album", fixture),
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
  return {
    database,
    reader,
    writer,
    editor: new EditTrackTags(database, writer),
    files,
  };
}

describe.each(["01-first.mp3", "02-second.flac"])(
  "verified track metadata edit: %s",
  (fixture) => {
    it("previews changed fields, snapshots, safely writes, re-reads, and preserves audio", async () => {
      const { database, reader, editor, fileId, albumId, path } =
        await createTrackEditor(fixture);
      const payloadBefore = await audioPayloadHash(path);
      const tagsBefore = (await reader.read(path)).tags;
      const preview = editor.preview(fileId, {
        title: "Edited track",
        artist: "Edited artist",
        albumArtist: "Edited album artist",
        trackNumber: 12,
        discNumber: 3,
        year: "2032-02-29",
      });
      expect(preview.warnings).toEqual([]);
      expect(preview.changes.map((change) => change.field)).toEqual([
        "title",
        "artist",
        "albumArtist",
        "trackNumber",
        "discNumber",
        "year",
      ]);

      const result = await editor.apply(
        preview.operationId,
        preview.confirmationToken,
      );
      expect(result.results).toMatchObject([{ verified: true, error: null }]);
      expect((await reader.read(path)).tags).toMatchObject({
        title: "Edited track",
        artist: "Edited artist",
        albumArtist: "Edited album artist",
        trackNumber: 12,
        discNumber: 3,
        year: "2032-02-29",
      });
      expect(await audioPayloadHash(path)).toBe(payloadBefore);
      expect(database.listSnapshots(preview.operationId)).toMatchObject([
        { fileId, verified: true, error: null },
      ]);
      const currentAlbumId = database.getTrackAlbumId(fileId) ?? albumId;
      expect(database.listEditHistory(currentAlbumId)[0]).toMatchObject({
        operationId: preview.operationId,
        kind: "track-tags-edit",
        state: "completed",
        verifiedFiles: 1,
      });

      const undoPreview = editor.previewUndo(preview.operationId);
      expect(undoPreview.warnings).toEqual([]);
      expect(undoPreview.changes.map((change) => change.field)).toEqual(
        preview.changes.map((change) => change.field),
      );
      const undoResult = await editor.applyUndo(
        undoPreview.operationId,
        undoPreview.confirmationToken,
      );
      expect(undoResult.results).toMatchObject([
        { verified: true, error: null },
      ]);
      expect((await reader.read(path)).tags).toEqual(tagsBefore);
      expect(await audioPayloadHash(path)).toBe(payloadBefore);
      const restoredAlbumId = database.getTrackAlbumId(fileId) ?? albumId;
      expect(
        database
          .listEditHistory(restoredAlbumId)
          .slice(0, 2)
          .map((item) => item.kind),
      ).toEqual(["track-tags-undo", "track-tags-edit"]);
      database.close();
    });
  },
);

it("applies and undoes track numbers in the exact confirmed order", async () => {
  const { database, reader, editor, files } = await createBatchTrackEditor();
  const first = files[0];
  const second = files[1];
  if (!first || !second) throw new Error("Sequence fixtures missing.");
  const original = await Promise.all(
    files.map(({ path }) => reader.read(path).then((file) => file.tags)),
  );
  const payloads = await Promise.all(
    files.map(({ path }) => audioPayloadHash(path)),
  );
  const preview = editor.previewTrackNumberSequence(
    [second.fileId, first.fileId],
    7,
    3,
  );
  expect(preview.files.map((file) => file.fileId)).toEqual([
    second.fileId,
    first.fileId,
  ]);
  expect(preview.files.map((file) => file.changes[0]?.after)).toEqual([7, 8]);
  expect(
    preview.files.map(
      (file) =>
        file.changes.find((change) => change.field === "discNumber")?.after,
    ),
  ).toEqual([3, 3]);

  const applied = await editor.applyTrackNumberSequence(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(applied.results.every((result) => result.verified)).toBe(true);
  expect((await reader.read(second.path)).tags).toMatchObject({
    title: original[1]?.title,
    trackNumber: 7,
    discNumber: 3,
  });
  expect((await reader.read(first.path)).tags).toMatchObject({
    title: original[0]?.title,
    trackNumber: 8,
    discNumber: 3,
  });
  expect(database.getEditOperation(preview.operationId)).toMatchObject({
    kind: "track-number-sequence-edit",
    state: "completed",
  });

  const undoPreview = editor.previewBatchUndo(preview.operationId);
  expect(undoPreview.files.map((file) => file.changes[0]?.after)).toEqual([
    original[1]?.trackNumber,
    original[0]?.trackNumber,
  ]);
  const undone = await editor.applyBatchUndo(
    undoPreview.operationId,
    undoPreview.confirmationToken,
  );
  expect(undone.results.every((result) => result.verified)).toBe(true);
  expect((await reader.read(second.path)).tags).toEqual(original[1]);
  expect((await reader.read(first.path)).tags).toEqual(original[0]);
  for (const [index, file] of files.entries())
    expect(await audioPayloadHash(file.path)).toBe(payloads[index]);
  database.close();
});

it("refuses a stale track number without aborting the remaining sequence", async () => {
  const { database, writer, editor, files } = await createBatchTrackEditor();
  const first = files[0];
  const second = files[1];
  if (!first || !second) throw new Error("Sequence fixtures missing.");
  const preview = editor.previewTrackNumberSequence(
    [first.fileId, second.fileId],
    9,
  );
  const external = await writer.writeTags(first.path, { trackNumber: 55 });
  database.updateFileAfterEdit(first.fileId, external.file);

  const applied = await editor.applyTrackNumberSequence(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(applied.results).toMatchObject([
    {
      fileId: first.fileId,
      verified: false,
      error:
        "A track or disc number changed after this preview; sequencing did not overwrite it.",
    },
    { fileId: second.fileId, verified: true, error: null },
  ]);
  expect(database.getEditOperation(preview.operationId)?.state).toBe("failed");
  database.close();
});

it("shows but does not rewrite a track number already matching the sequence", async () => {
  const { database, writer, editor, files } = await createBatchTrackEditor();
  const first = files[0];
  const second = files[1];
  if (!first || !second) throw new Error("Sequence fixtures missing.");
  const changed = await writer.writeTags(second.path, { trackNumber: 5 });
  database.updateFileAfterEdit(second.fileId, changed.file);
  const preview = editor.previewTrackNumberSequence(
    [first.fileId, second.fileId],
    1,
  );
  expect(preview.files.map((file) => file.willWrite)).toEqual([false, true]);
  const applied = await editor.applyTrackNumberSequence(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(applied.results).toMatchObject([
    { fileId: second.fileId, verified: true, error: null },
  ]);
  expect(database.listSnapshots(preview.operationId)).toHaveLength(1);
  database.close();
});

it("previews and independently verifies a persisted multi-track batch edit", async () => {
  const { database, reader, writer, editor, files } =
    await createBatchTrackEditor();
  const payloads = await Promise.all(
    files.map(({ path }) => audioPayloadHash(path)),
  );
  const originalTags = await Promise.all(
    files.map(({ path }) => reader.read(path).then((file) => file.tags)),
  );
  const preview = editor.previewBatch(
    files.map(({ fileId }) => fileId),
    { artist: "Batch Artist", discNumber: 2, year: "2031-07" },
  );
  expect(preview.files).toHaveLength(2);
  expect(preview.files.every((file) => file.willWrite)).toBe(true);
  expect(
    preview.files.map((file) => file.changes.map((item) => item.field)),
  ).toEqual([
    ["artist", "discNumber", "year"],
    ["artist", "discNumber", "year"],
  ]);

  const result = await editor.applyBatch(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(result.results).toMatchObject([
    { fileId: files[0]?.fileId, verified: true, error: null },
    { fileId: files[1]?.fileId, verified: true, error: null },
  ]);
  for (const [index, file] of files.entries()) {
    expect((await reader.read(file.path)).tags).toMatchObject({
      artist: "Batch Artist",
      discNumber: 2,
      year: "2031-07",
    });
    expect(await audioPayloadHash(file.path)).toBe(payloads[index]);
  }
  expect(database.listSnapshots(preview.operationId)).toHaveLength(2);
  expect(database.getEditOperation(preview.operationId)).toMatchObject({
    kind: "track-tags-batch-edit",
    state: "completed",
  });

  const first = files[0];
  const second = files[1];
  if (!first || !second) throw new Error("Batch fixture missing.");
  const unrelated = await writer.writeTags(first.path, {
    title: "Externally Retitled",
  });
  database.updateFileAfterEdit(first.fileId, unrelated.file);
  const undoPreview = editor.previewBatchUndo(preview.operationId);
  expect(undoPreview.files).toHaveLength(2);
  expect(undoPreview.files.every((file) => file.warnings.length === 0)).toBe(
    true,
  );
  expect(
    undoPreview.files.flatMap((file) =>
      file.changes.map((change) => change.field),
    ),
  ).not.toContain("title");
  const undo = await editor.applyBatchUndo(
    undoPreview.operationId,
    undoPreview.confirmationToken,
  );
  expect(undo.results).toMatchObject([
    { fileId: files[0]?.fileId, verified: true, error: null },
    { fileId: files[1]?.fileId, verified: true, error: null },
  ]);
  expect((await reader.read(first.path)).tags).toEqual({
    ...originalTags[0],
    title: "Externally Retitled",
  });
  expect((await reader.read(second.path)).tags).toEqual(originalTags[1]);
  for (const [index, file] of files.entries())
    expect(await audioPayloadHash(file.path)).toBe(payloads[index]);
  expect(database.getEditOperation(undoPreview.operationId)).toMatchObject({
    kind: "track-tags-batch-undo",
    source_operation_id: preview.operationId,
    state: "completed",
  });
  database.close();
});

it("skips matching tracks and keeps applying after another track becomes stale", async () => {
  const { database, writer, editor, files } = await createBatchTrackEditor();
  const first = files[0];
  const second = files[1];
  if (!first || !second) throw new Error("Batch fixtures missing.");
  const firstWrite = await writer.writeTags(first.path, {
    artist: "Already Matching",
  });
  database.updateFileAfterEdit(first.fileId, firstWrite.file);
  const skipPreview = editor.previewBatch(
    files.map(({ fileId }) => fileId),
    { artist: "Already Matching" },
  );
  expect(skipPreview.files.map((file) => file.willWrite)).toEqual([
    false,
    true,
  ]);
  const skipResult = await editor.applyBatch(
    skipPreview.operationId,
    skipPreview.confirmationToken,
  );
  expect(skipResult.results).toHaveLength(1);
  expect(skipResult.results[0]).toMatchObject({
    fileId: second.fileId,
    verified: true,
  });

  const stalePreview = editor.previewBatch(
    files.map(({ fileId }) => fileId),
    { artist: "Final Batch Artist" },
  );
  const external = await writer.writeTags(first.path, {
    artist: "External Artist",
  });
  database.updateFileAfterEdit(first.fileId, external.file);
  const staleResult = await editor.applyBatch(
    stalePreview.operationId,
    stalePreview.confirmationToken,
  );
  expect(staleResult.results).toMatchObject([
    { fileId: first.fileId, verified: false },
    { fileId: second.fileId, verified: true, error: null },
  ]);
  expect(staleResult.results[0]?.error).toContain(
    "changed after it was created",
  );
  expect(database.getEditOperation(stalePreview.operationId)?.state).toBe(
    "failed",
  );
  const partialUndo = editor.previewBatchUndo(stalePreview.operationId);
  expect(partialUndo.files.map((file) => file.fileId)).toEqual([second.fileId]);
  database.close();
});

it("refuses one stale batch undo target and restores the remaining file", async () => {
  const { database, writer, editor, files } = await createBatchTrackEditor();
  const first = files[0];
  const second = files[1];
  if (!first || !second) throw new Error("Batch fixtures missing.");
  const editPreview = editor.previewBatch(
    files.map(({ fileId }) => fileId),
    { artist: "Undo Target", year: "2034" },
  );
  const edit = await editor.applyBatch(
    editPreview.operationId,
    editPreview.confirmationToken,
  );
  expect(edit.results.every((result) => result.verified)).toBe(true);
  const undoPreview = editor.previewBatchUndo(editPreview.operationId);
  const external = await writer.writeTags(first.path, {
    artist: "Changed After Undo Preview",
  });
  database.updateFileAfterEdit(first.fileId, external.file);

  const undo = await editor.applyBatchUndo(
    undoPreview.operationId,
    undoPreview.confirmationToken,
  );
  expect(undo.results).toMatchObject([
    {
      fileId: first.fileId,
      verified: false,
      error:
        "A field changed after the original batch edit; undo did not overwrite it.",
    },
    { fileId: second.fileId, verified: true, error: null },
  ]);
  expect(database.getEditOperation(undoPreview.operationId)?.state).toBe(
    "failed",
  );
  database.close();
});

it("refuses a confirmed preview when a targeted field changed externally", async () => {
  const { database, reader, writer, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const preview = editor.preview(fileId, { artist: "Outgroove Artist" });
  const manual = await writer.writeTags(path, { artist: "External Artist" });
  database.updateFileAfterEdit(fileId, manual.file);

  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(result.results).toMatchObject([
    {
      verified: false,
      error:
        "A field in this preview changed after it was created; the edit did not overwrite it.",
    },
  ]);
  expect((await reader.read(path)).tags.artist).toBe("External Artist");
  expect(database.getEditOperation(preview.operationId)?.state).toBe("failed");
  database.close();
});

it("refuses track undo when a targeted field changed after the edit", async () => {
  const { database, reader, writer, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const preview = editor.preview(fileId, { artist: "Outgroove Artist" });
  const edit = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(edit.results[0]?.verified).toBe(true);
  const manual = await writer.writeTags(path, { artist: "External Artist" });
  database.updateFileAfterEdit(fileId, manual.file);

  const undoPreview = editor.previewUndo(preview.operationId);
  expect(undoPreview.warnings.join(" ")).toContain("changed after this edit");
  const result = await editor.applyUndo(
    undoPreview.operationId,
    undoPreview.confirmationToken,
  );
  expect(result.results).toMatchObject([
    {
      verified: false,
      error:
        "A field changed after the original edit; undo did not overwrite it.",
    },
  ]);
  expect((await reader.read(path)).tags.artist).toBe("External Artist");
  expect(database.getEditOperation(undoPreview.operationId)?.state).toBe(
    "failed",
  );
  database.close();
});
