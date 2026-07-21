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

describe.each(["01-first.mp3", "02-second.flac"])(
  "verified track metadata edit: %s",
  (fixture) => {
    it("previews changed fields, snapshots, safely writes, re-reads, and preserves audio", async () => {
      const { database, reader, editor, fileId, albumId, path } =
        await createTrackEditor(fixture);
      const payloadBefore = await audioPayloadHash(path);
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
      database.close();
    });
  },
);

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
