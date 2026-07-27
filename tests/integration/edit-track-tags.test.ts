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
        trackTotal: 12,
        discNumber: 3,
        discTotal: 3,
        year: "2032-02-29",
        genres: ["Post Rock"],
        composers: ["Fixture Composer"],
        conductors: ["Fixture Conductor"],
        lyricists: ["Fixture Lyricist"],
        isrcs: ["DEABC2600001"],
        copyright: "Copyright Fixture",
        comment: "First line\nSecond line",
        originalReleaseDate: "1998-04",
        language: "deu",
        publishers: ["Fixture Publisher"],
        descriptions: ["Fixture description"],
        grouping: "Suite I",
        catalogNumbers: ["OUT-42"],
        publishingDate: "2025-09",
        bpm: 127,
        compilation: true,
        musicBrainzRecordingId: "11111111-1111-4111-8111-111111111111",
        musicBrainzReleaseTrackId: "22222222-2222-4222-8222-222222222222",
        musicBrainzReleaseId: "33333333-3333-4333-8333-333333333333",
        musicBrainzArtistIds: ["44444444-4444-4444-8444-444444444444"],
        musicBrainzReleaseArtistIds: ["55555555-5555-4555-8555-555555555555"],
        musicBrainzReleaseGroupId: "66666666-6666-4666-8666-666666666666",
        musicBrainzWorkId: "77777777-7777-4777-8777-777777777777",
      });
      expect(preview.warnings).toEqual([]);
      expect(preview.changes.map((change) => change.field)).toEqual([
        "title",
        "artist",
        "albumArtist",
        "trackNumber",
        "trackTotal",
        "discNumber",
        "discTotal",
        "year",
        "genres",
        "composers",
        "conductors",
        "lyricists",
        "isrcs",
        "copyright",
        "comment",
        "originalReleaseDate",
        "language",
        "publishers",
        "descriptions",
        "grouping",
        "catalogNumbers",
        "publishingDate",
        "bpm",
        "compilation",
        "musicBrainzRecordingId",
        "musicBrainzReleaseTrackId",
        "musicBrainzReleaseId",
        "musicBrainzArtistIds",
        "musicBrainzReleaseArtistIds",
        "musicBrainzReleaseGroupId",
        "musicBrainzWorkId",
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
        trackTotal: 12,
        discNumber: 3,
        discTotal: 3,
        year: "2032-02-29",
        genres: ["Post Rock"],
        composers: ["Fixture Composer"],
        conductors: ["Fixture Conductor"],
        lyricists: ["Fixture Lyricist"],
        isrcs: ["DEABC2600001"],
        copyright: "Copyright Fixture",
        comment: "First line\nSecond line",
        originalReleaseDate: "1998-04",
        language: "deu",
        publishers: ["Fixture Publisher"],
        descriptions: ["Fixture description"],
        grouping: "Suite I",
        catalogNumbers: ["OUT-42"],
        publishingDate: "2025-09",
        bpm: 127,
        compilation: true,
        musicBrainzRecordingId: "11111111-1111-4111-8111-111111111111",
        musicBrainzReleaseTrackId: "22222222-2222-4222-8222-222222222222",
        musicBrainzReleaseId: "33333333-3333-4333-8333-333333333333",
        musicBrainzArtistIds: ["44444444-4444-4444-8444-444444444444"],
        musicBrainzReleaseArtistIds: ["55555555-5555-4555-8555-555555555555"],
        musicBrainzReleaseGroupId: "66666666-6666-4666-8666-666666666666",
        musicBrainzWorkId: "77777777-7777-4777-8777-777777777777",
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

it("blocks replacing multiple genre values when exact undo is unavailable", async () => {
  const { database, reader, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const scanned = await reader.read(path);
  const bytesBefore = await audioPayloadHash(path);
  database.updateFileAfterEdit(fileId, {
    ...scanned,
    tags: { ...scanned.tags, genres: ["Rock", "Metal"] },
  });

  const preview = editor.preview(fileId, { genres: ["Post Rock"] });
  expect(preview.changes).toEqual([
    {
      field: "genres",
      before: ["Rock", "Metal"],
      after: ["Post Rock"],
    },
  ]);
  expect(preview.warnings).toContain(
    "Genre editing is unavailable for tracks with multiple genre values because this writer cannot restore them safely.",
  );

  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(result.results).toMatchObject([
    {
      verified: false,
      error:
        "Genre editing is unavailable for tracks with multiple genre values because this writer cannot restore them safely.",
    },
  ]);
  expect((await reader.read(path)).tags).toEqual(scanned.tags);
  expect(await audioPayloadHash(path)).toBe(bytesBefore);
  database.close();
});

it("blocks replacing multiple composer values when exact undo is unavailable", async () => {
  const { database, reader, editor, fileId, path } =
    await createTrackEditor("02-second.flac");
  const scanned = await reader.read(path);
  const bytesBefore = await audioPayloadHash(path);
  database.updateFileAfterEdit(fileId, {
    ...scanned,
    tags: {
      ...scanned.tags,
      composers: ["First Composer", "Second Composer"],
    },
  });

  const preview = editor.preview(fileId, {
    composers: ["Replacement Composer"],
  });
  expect(preview.changes).toEqual([
    {
      field: "composers",
      before: ["First Composer", "Second Composer"],
      after: ["Replacement Composer"],
    },
  ]);
  expect(preview.warnings).toContain(
    "Composer editing is unavailable for tracks with multiple composer values because this writer cannot restore them safely.",
  );

  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(result.results).toMatchObject([
    {
      verified: false,
      error:
        "Composer editing is unavailable for tracks with multiple composer values because this writer cannot restore them safely.",
    },
  ]);
  expect((await reader.read(path)).tags).toEqual(scanned.tags);
  expect(await audioPayloadHash(path)).toBe(bytesBefore);
  database.close();
});

it("undoes a composer edit from a legacy catalog row without the rebuildable field", async () => {
  const { database, reader, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const scanned = await reader.read(path);
  const legacyTags = { ...scanned.tags };
  delete legacyTags.composers;
  database.updateFileAfterEdit(fileId, {
    ...scanned,
    tags: legacyTags,
  });

  const preview = editor.preview(fileId, {
    composers: ["Fixture Composer"],
  });
  const applied = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(applied.results).toMatchObject([{ verified: true, error: null }]);

  const undoPreview = editor.previewUndo(preview.operationId);
  expect(undoPreview.changes).toEqual([
    {
      field: "composers",
      before: ["Fixture Composer"],
      after: [],
    },
  ]);
  const undone = await editor.applyUndo(
    undoPreview.operationId,
    undoPreview.confirmationToken,
  );
  expect(undone.results).toMatchObject([{ verified: true, error: null }]);
  expect((await reader.read(path)).tags.composers).toEqual([]);
  database.close();
});

it("blocks replacing multiple conductor values when exact undo is unavailable", async () => {
  const { database, reader, editor, fileId, path } =
    await createTrackEditor("02-second.flac");
  const scanned = await reader.read(path);
  const payloadBefore = await audioPayloadHash(path);
  database.updateFileAfterEdit(fileId, {
    ...scanned,
    tags: {
      ...scanned.tags,
      conductors: ["First Conductor", "Second Conductor"],
    },
  });

  const preview = editor.preview(fileId, {
    conductors: ["Replacement Conductor"],
  });
  expect(preview.warnings).toContain(
    "Conductor editing is unavailable for tracks with multiple conductor values because this writer cannot restore them safely.",
  );
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );

  expect(result.results).toMatchObject([
    {
      verified: false,
      error:
        "Conductor editing is unavailable for tracks with multiple conductor values because this writer cannot restore them safely.",
    },
  ]);
  expect((await reader.read(path)).tags).toEqual(scanned.tags);
  expect(await audioPayloadHash(path)).toBe(payloadBefore);
  database.close();
});

it("undoes a conductor edit from a legacy catalog row without the rebuildable field", async () => {
  const { database, reader, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const scanned = await reader.read(path);
  const legacyTags = { ...scanned.tags };
  delete legacyTags.conductors;
  database.updateFileAfterEdit(fileId, {
    ...scanned,
    tags: legacyTags,
  });

  const preview = editor.preview(fileId, {
    conductors: ["Fixture Conductor"],
  });
  const applied = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(applied.results).toMatchObject([{ verified: true, error: null }]);

  const undoPreview = editor.previewUndo(preview.operationId);
  expect(undoPreview.changes).toEqual([
    {
      field: "conductors",
      before: ["Fixture Conductor"],
      after: [],
    },
  ]);
  const undone = await editor.applyUndo(
    undoPreview.operationId,
    undoPreview.confirmationToken,
  );
  expect(undone.results).toMatchObject([{ verified: true, error: null }]);
  expect((await reader.read(path)).tags.conductors).toEqual([]);
  database.close();
});

it("rejects a no-op conductor proposal and refuses a stale targeted conductor", async () => {
  const { database, reader, writer, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const payloadBefore = await audioPayloadHash(path);
  expect(() => editor.preview(fileId, { conductors: [] })).toThrow(
    "already matches this track",
  );

  const preview = editor.preview(fileId, {
    conductors: ["Fixture Conductor"],
  });
  const external = await writer.writeTags(path, {
    conductors: ["External Conductor"],
  });
  database.updateFileAfterEdit(fileId, external.file);
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );

  expect(result.results).toMatchObject([
    {
      fileId,
      verified: false,
      error:
        "A field in this preview changed after it was created; the edit did not overwrite it.",
    },
  ]);
  expect((await reader.read(path)).tags.conductors).toEqual([
    "External Conductor",
  ]);
  expect(await audioPayloadHash(path)).toBe(payloadBefore);
  database.close();
});

it("blocks replacing multiple lyricist and ISRC values when exact undo is unavailable", async () => {
  const { database, reader, editor, fileId, path } =
    await createTrackEditor("02-second.flac");
  const scanned = await reader.read(path);
  const payloadBefore = await audioPayloadHash(path);
  database.updateFileAfterEdit(fileId, {
    ...scanned,
    tags: {
      ...scanned.tags,
      lyricists: ["First Lyricist", "Second Lyricist"],
      isrcs: ["DEABC2600001", "DEABC2600002"],
    },
  });

  const preview = editor.preview(fileId, {
    lyricists: ["Replacement Lyricist"],
    isrcs: ["DEABC2600003"],
  });
  expect(preview.warnings).toEqual([
    "Lyricist editing is unavailable for tracks with multiple lyricist values because this writer cannot restore them safely.",
    "ISRC editing is unavailable for tracks with multiple ISRC values because this writer cannot restore them safely.",
  ]);
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(result.results[0]).toMatchObject({ verified: false });
  expect(result.results[0]?.error).toContain("Lyricist editing is unavailable");
  expect((await reader.read(path)).tags).toEqual(scanned.tags);
  expect(await audioPayloadHash(path)).toBe(payloadBefore);
  database.close();
});

it("shows structured comment evidence and blocks a lossy comment replacement", async () => {
  const { database, reader, editor, fileId, path } =
    await createTrackEditor("02-second.flac");
  const scanned = await reader.read(path);
  const payloadBefore = await audioPayloadHash(path);
  database.updateFileAfterEdit(fileId, {
    ...scanned,
    tags: {
      ...scanned.tags,
      comment: null,
      comments: [
        { text: "Editorial note", language: "deu", descriptor: "Review" },
        { text: "Second note", language: null, descriptor: null },
      ],
    },
  });

  const preview = editor.preview(fileId, { comment: "Replacement note" });
  expect(preview.changes).toEqual([
    {
      field: "comment",
      before: [
        "Editorial note (language deu, descriptor Review)",
        "Second note",
      ],
      after: "Replacement note",
    },
  ]);
  expect(preview.warnings).toEqual([
    "Comment editing is unavailable when the current file has multiple comments or comment language/descriptor data that this writer cannot restore exactly.",
  ]);
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(result.results[0]).toMatchObject({ verified: false });
  expect(result.results[0]?.error).toContain("Comment editing is unavailable");
  expect((await reader.read(path)).tags).toEqual(scanned.tags);
  expect(await audioPayloadHash(path)).toBe(payloadBefore);
  database.close();
});

it("undoes completed-tag edits from a legacy catalog row with explicit empty values", async () => {
  const { database, reader, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const scanned = await reader.read(path);
  const legacyTags = { ...scanned.tags };
  delete legacyTags.lyricists;
  delete legacyTags.isrcs;
  delete legacyTags.copyright;
  delete legacyTags.comment;
  delete legacyTags.comments;
  delete legacyTags.originalReleaseDate;
  delete legacyTags.language;
  delete legacyTags.publishers;
  delete legacyTags.descriptions;
  delete legacyTags.grouping;
  delete legacyTags.catalogNumbers;
  delete legacyTags.publishingDate;
  delete legacyTags.bpm;
  delete legacyTags.compilation;
  delete legacyTags.musicBrainzRecordingId;
  delete legacyTags.musicBrainzReleaseTrackId;
  delete legacyTags.musicBrainzReleaseId;
  delete legacyTags.musicBrainzArtistIds;
  delete legacyTags.musicBrainzReleaseArtistIds;
  delete legacyTags.musicBrainzReleaseGroupId;
  delete legacyTags.musicBrainzWorkId;
  database.updateFileAfterEdit(fileId, { ...scanned, tags: legacyTags });

  const preview = editor.preview(fileId, {
    lyricists: ["Fixture Lyricist"],
    isrcs: ["DEABC2600001"],
    copyright: "Copyright Fixture",
    comment: "Fixture comment",
    originalReleaseDate: "1998-04",
    language: "deu",
    publishers: ["Fixture Publisher"],
    descriptions: ["Fixture description"],
    grouping: "Suite I",
    catalogNumbers: ["OUT-42"],
    publishingDate: "2025-09",
    bpm: 127,
    compilation: true,
    musicBrainzRecordingId: "11111111-1111-4111-8111-111111111111",
    musicBrainzReleaseTrackId: "22222222-2222-4222-8222-222222222222",
    musicBrainzReleaseId: "33333333-3333-4333-8333-333333333333",
    musicBrainzArtistIds: ["44444444-4444-4444-8444-444444444444"],
    musicBrainzReleaseArtistIds: ["55555555-5555-4555-8555-555555555555"],
    musicBrainzReleaseGroupId: "66666666-6666-4666-8666-666666666666",
    musicBrainzWorkId: "77777777-7777-4777-8777-777777777777",
  });
  const applied = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(applied.results).toMatchObject([{ verified: true, error: null }]);

  const undoPreview = editor.previewUndo(preview.operationId);
  expect(undoPreview.changes).toEqual([
    {
      field: "lyricists",
      before: ["Fixture Lyricist"],
      after: [],
    },
    { field: "isrcs", before: ["DEABC2600001"], after: [] },
    {
      field: "copyright",
      before: "Copyright Fixture",
      after: null,
    },
    {
      field: "comment",
      before: ["Fixture comment (language eng)"],
      after: null,
    },
    {
      field: "originalReleaseDate",
      before: "1998-04",
      after: null,
    },
    { field: "language", before: "deu", after: null },
    {
      field: "publishers",
      before: ["Fixture Publisher"],
      after: [],
    },
    {
      field: "descriptions",
      before: ["Fixture description"],
      after: [],
    },
    { field: "grouping", before: "Suite I", after: null },
    { field: "catalogNumbers", before: ["OUT-42"], after: [] },
    { field: "publishingDate", before: "2025-09", after: null },
    { field: "bpm", before: 127, after: null },
    { field: "compilation", before: true, after: false },
    {
      field: "musicBrainzRecordingId",
      before: "11111111-1111-4111-8111-111111111111",
      after: null,
    },
    {
      field: "musicBrainzReleaseTrackId",
      before: "22222222-2222-4222-8222-222222222222",
      after: null,
    },
    {
      field: "musicBrainzReleaseId",
      before: "33333333-3333-4333-8333-333333333333",
      after: null,
    },
    {
      field: "musicBrainzArtistIds",
      before: ["44444444-4444-4444-8444-444444444444"],
      after: [],
    },
    {
      field: "musicBrainzReleaseArtistIds",
      before: ["55555555-5555-4555-8555-555555555555"],
      after: [],
    },
    {
      field: "musicBrainzReleaseGroupId",
      before: "66666666-6666-4666-8666-666666666666",
      after: null,
    },
    {
      field: "musicBrainzWorkId",
      before: "77777777-7777-4777-8777-777777777777",
      after: null,
    },
  ]);
  const undone = await editor.applyUndo(
    undoPreview.operationId,
    undoPreview.confirmationToken,
  );
  expect(undone.results).toMatchObject([{ verified: true, error: null }]);
  expect((await reader.read(path)).tags).toMatchObject({
    lyricists: [],
    isrcs: [],
    copyright: null,
    comment: null,
    comments: [],
    originalReleaseDate: null,
    language: null,
    publishers: [],
    descriptions: [],
    grouping: null,
    catalogNumbers: [],
    publishingDate: null,
    bpm: null,
    compilation: false,
    musicBrainzRecordingId: null,
    musicBrainzReleaseTrackId: null,
    musicBrainzReleaseId: null,
    musicBrainzArtistIds: [],
    musicBrainzReleaseArtistIds: [],
    musicBrainzReleaseGroupId: null,
    musicBrainzWorkId: null,
  });
  database.close();
});

it("rejects new-field no-ops and refuses a stale targeted comment", async () => {
  const { database, reader, writer, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const payloadBefore = await audioPayloadHash(path);
  expect(() =>
    editor.preview(fileId, {
      comment: null,
      originalReleaseDate: null,
      language: null,
    }),
  ).toThrow("already matches this track");

  const preview = editor.preview(fileId, { comment: "Draft comment" });
  const external = await writer.writeTags(path, {
    comment: "External comment",
  });
  database.updateFileAfterEdit(fileId, external.file);
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(result.results).toMatchObject([
    {
      fileId,
      verified: false,
      error:
        "A field in this preview changed after it was created; the edit did not overwrite it.",
    },
  ]);
  expect((await reader.read(path)).tags.comment).toBe("External comment");
  expect(await audioPayloadHash(path)).toBe(payloadBefore);
  database.close();
});

it("keeps completed fields no-op safe, blocks multi-value replacement, and refuses a stale identifier", async () => {
  const { database, reader, writer, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const scanned = await reader.read(path);
  const payloadBefore = await audioPayloadHash(path);
  expect(() =>
    editor.preview(fileId, {
      publishers: [],
      descriptions: [],
      grouping: null,
      catalogNumbers: [],
      publishingDate: null,
      bpm: null,
      compilation: false,
      musicBrainzReleaseId: null,
      musicBrainzArtistIds: [],
      musicBrainzReleaseArtistIds: [],
      musicBrainzReleaseGroupId: null,
      musicBrainzWorkId: null,
    }),
  ).toThrow("already matches this track");

  database.updateFileAfterEdit(fileId, {
    ...scanned,
    tags: { ...scanned.tags, publishers: ["First Label", "Second Label"] },
  });
  const blocked = editor.preview(fileId, {
    publishers: ["Replacement Label"],
  });
  expect(blocked.warnings).toEqual([
    "Publisher editing is unavailable for tracks with multiple current values because this writer cannot restore them safely.",
  ]);
  expect(
    await editor.apply(blocked.operationId, blocked.confirmationToken),
  ).toMatchObject({
    results: [{ verified: false }],
  });

  database.updateFileAfterEdit(fileId, scanned);
  const preview = editor.preview(fileId, {
    musicBrainzReleaseId: "33333333-3333-4333-8333-333333333333",
  });
  const external = await writer.writeTags(path, {
    musicBrainzReleaseId: "99999999-9999-4999-8999-999999999999",
  });
  database.updateFileAfterEdit(fileId, external.file);
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(result.results[0]).toMatchObject({
    verified: false,
    error:
      "A field in this preview changed after it was created; the edit did not overwrite it.",
  });
  expect((await reader.read(path)).tags.musicBrainzReleaseId).toBe(
    "99999999-9999-4999-8999-999999999999",
  );
  expect(await audioPayloadHash(path)).toBe(payloadBefore);
  database.close();
});

it("keeps non-restorable BPM and MusicBrainz values readable but blocks replacing them", async () => {
  const { database, reader, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const scanned = await reader.read(path);
  database.updateFileAfterEdit(fileId, {
    ...scanned,
    tags: {
      ...scanned.tags,
      bpm: 127.5,
      musicBrainzReleaseId: "legacy-not-a-uuid",
    },
  });

  const preview = editor.preview(fileId, {
    bpm: 128,
    musicBrainzReleaseId: "33333333-3333-4333-8333-333333333333",
  });
  expect(preview.changes).toEqual([
    { field: "bpm", before: 127.5, after: 128 },
    {
      field: "musicBrainzReleaseId",
      before: "legacy-not-a-uuid",
      after: "33333333-3333-4333-8333-333333333333",
    },
  ]);
  expect(preview.warnings).toEqual([
    "BPM editing is unavailable because the current value is not a restorable integer from 1 to 999.",
    "MusicBrainz release ID editing is unavailable because the current value is not a restorable MusicBrainz UUID.",
  ]);
  expect(
    await editor.apply(preview.operationId, preview.confirmationToken),
  ).toMatchObject({ results: [{ verified: false }] });
  expect((await reader.read(path)).tags).toEqual(scanned.tags);
  database.close();
});

it("rejects an advanced-field no-op and refuses a stale targeted ISRC", async () => {
  const { database, reader, writer, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const payloadBefore = await audioPayloadHash(path);
  expect(() =>
    editor.preview(fileId, {
      lyricists: [],
      isrcs: [],
      copyright: null,
    }),
  ).toThrow("already matches this track");

  const preview = editor.preview(fileId, { isrcs: ["DEABC2600001"] });
  const external = await writer.writeTags(path, {
    isrcs: ["DEABC2600002"],
  });
  database.updateFileAfterEdit(fileId, external.file);
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );
  expect(result.results).toMatchObject([
    {
      fileId,
      verified: false,
      error:
        "A field in this preview changed after it was created; the edit did not overwrite it.",
    },
  ]);
  expect((await reader.read(path)).tags.isrcs).toEqual(["DEABC2600002"]);
  expect(await audioPayloadHash(path)).toBe(payloadBefore);
  database.close();
});

it("rejects invalid totals and refuses a stale targeted total without changing audio", async () => {
  const { database, reader, writer, editor, fileId, path } =
    await createTrackEditor("01-first.mp3");
  const payloadBefore = await audioPayloadHash(path);
  expect(() => editor.preview(fileId, { trackTotal: 0 })).toThrow(
    "trackTotal must be between",
  );
  expect(() => editor.preview(fileId, { trackNumber: null })).toThrow(
    "Track total requires a track number",
  );

  const preview = editor.preview(fileId, { trackTotal: 12 });
  const external = await writer.writeTags(path, { trackTotal: 10 });
  database.updateFileAfterEdit(fileId, external.file);
  const result = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );

  expect(result.results).toMatchObject([
    {
      fileId,
      verified: false,
      error:
        "A field in this preview changed after it was created; the edit did not overwrite it.",
    },
  ]);
  expect((await reader.read(path)).tags.trackTotal).toBe(10);
  expect(await audioPayloadHash(path)).toBe(payloadBefore);
  database.close();
});

it("does not propose or clear legacy-missing totals while editing another field", async () => {
  const { database, reader, editor, fileId, path } =
    await createTrackEditor("02-second.flac");
  database.connection
    .prepare(
      `UPDATE audio_files
       SET normalized_tags_json=json_remove(
         normalized_tags_json, '$.trackTotal', '$.discTotal'
       )
       WHERE id=?`,
    )
    .run(fileId);

  const preview = editor.preview(fileId, { title: "Title only" });
  expect(preview.changes).toEqual([
    { field: "title", before: "Second Track", after: "Title only" },
  ]);
  const applied = await editor.apply(
    preview.operationId,
    preview.confirmationToken,
  );

  expect(applied.results).toMatchObject([{ verified: true, error: null }]);
  expect((await reader.read(path)).tags).toMatchObject({
    title: "Title only",
    trackNumber: 2,
    trackTotal: 2,
    discNumber: 1,
    discTotal: 1,
  });
  database.close();
});

it("applies and undoes track numbers in the exact confirmed order", async () => {
  const { database, reader, writer, editor, files } =
    await createBatchTrackEditor();
  const first = files[0];
  const second = files[1];
  if (!first || !second) throw new Error("Sequence fixtures missing.");
  const payloads = await Promise.all(
    files.map(({ path }) => audioPayloadHash(path)),
  );
  for (const file of files) {
    const updated = await writer.writeTags(file.path, {
      trackTotal: 8,
      discTotal: 3,
    });
    database.updateFileAfterEdit(file.fileId, updated.file);
  }
  const original = await Promise.all(
    files.map(({ path }) => reader.read(path).then((file) => file.tags)),
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
    preview.files
      .flatMap((file) => file.changes)
      .some(
        (change) =>
          change.field === "trackTotal" || change.field === "discTotal",
      ),
  ).toBe(false);
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
    trackTotal: 8,
    discNumber: 3,
    discTotal: 3,
  });
  expect((await reader.read(first.path)).tags).toMatchObject({
    title: original[0]?.title,
    trackNumber: 8,
    trackTotal: 8,
    discNumber: 3,
    discTotal: 3,
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
  for (const file of files) {
    const updated = await writer.writeTags(file.path, { trackTotal: 10 });
    database.updateFileAfterEdit(file.fileId, updated.file);
  }
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
    {
      artist: "Batch Artist",
      trackTotal: 3,
      discNumber: 2,
      discTotal: 2,
      year: "2031-07",
      genres: ["Post Rock"],
      composers: ["Fixture Composer"],
      conductors: ["Fixture Conductor"],
      lyricists: ["Fixture Lyricist"],
      isrcs: ["DEABC2600001"],
      copyright: "Copyright Fixture",
      originalReleaseDate: "1998-04",
      language: "deu",
      publishers: ["Fixture Publisher"],
      grouping: "Suite I",
      catalogNumbers: ["OUT-42"],
      publishingDate: "2025-09",
      compilation: true,
      musicBrainzReleaseId: "33333333-3333-4333-8333-333333333333",
      musicBrainzReleaseArtistIds: ["55555555-5555-4555-8555-555555555555"],
      musicBrainzReleaseGroupId: "66666666-6666-4666-8666-666666666666",
    },
  );
  expect(preview.files).toHaveLength(2);
  expect(preview.files.every((file) => file.willWrite)).toBe(true);
  expect(
    preview.files.map((file) => file.changes.map((item) => item.field)),
  ).toEqual([
    [
      "artist",
      "trackTotal",
      "discNumber",
      "discTotal",
      "year",
      "genres",
      "composers",
      "conductors",
      "lyricists",
      "isrcs",
      "copyright",
      "originalReleaseDate",
      "language",
      "publishers",
      "grouping",
      "catalogNumbers",
      "publishingDate",
      "compilation",
      "musicBrainzReleaseId",
      "musicBrainzReleaseArtistIds",
      "musicBrainzReleaseGroupId",
    ],
    [
      "artist",
      "trackTotal",
      "discNumber",
      "discTotal",
      "year",
      "genres",
      "composers",
      "conductors",
      "lyricists",
      "isrcs",
      "copyright",
      "originalReleaseDate",
      "language",
      "publishers",
      "grouping",
      "catalogNumbers",
      "publishingDate",
      "compilation",
      "musicBrainzReleaseId",
      "musicBrainzReleaseArtistIds",
      "musicBrainzReleaseGroupId",
    ],
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
      trackTotal: 3,
      discNumber: 2,
      discTotal: 2,
      year: "2031-07",
      genres: ["Post Rock"],
      composers: ["Fixture Composer"],
      conductors: ["Fixture Conductor"],
      lyricists: ["Fixture Lyricist"],
      isrcs: ["DEABC2600001"],
      copyright: "Copyright Fixture",
      originalReleaseDate: "1998-04",
      language: "deu",
      publishers: ["Fixture Publisher"],
      grouping: "Suite I",
      catalogNumbers: ["OUT-42"],
      publishingDate: "2025-09",
      compilation: true,
      musicBrainzReleaseId: "33333333-3333-4333-8333-333333333333",
      musicBrainzReleaseArtistIds: ["55555555-5555-4555-8555-555555555555"],
      musicBrainzReleaseGroupId: "66666666-6666-4666-8666-666666666666",
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
