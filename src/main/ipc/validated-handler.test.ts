import { describe, expect, it, vi } from "vitest";

import {
  albumEditHistoryRequestSchema,
  albumEditUndoPreviewRequestSchema,
  databaseRestoreApplyRequestSchema,
  createSavedLibraryFilterRequestSchema,
  deleteSavedLibraryFilterRequestSchema,
  scanCancelRequestSchema,
  libraryQueryRequestSchema,
  libraryRootRemovalApplyRequestSchema,
  libraryRootRemovalPreviewRequestSchema,
  scanRequestSchema,
  syncProfileRequestSchema,
  trackBatchEditPreviewRequestSchema,
  trackNumberSequencePreviewRequestSchema,
  trackTagEditPreviewRequestSchema,
  updateSavedLibraryFilterRequestSchema,
} from "../../shared/contracts/api";
import { createValidatedHandler } from "./validated-handler";

describe("validated IPC handlers", () => {
  it("rejects malformed and unknown request fields without calling the use case", async () => {
    const useCase = vi.fn(() => "ok");
    const handler = createValidatedHandler(scanRequestSchema, useCase);
    await expect(handler({}, { rootId: "not-a-uuid" })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    await expect(
      handler(
        {},
        {
          rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
          arbitraryPath: "/etc",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
  });

  it("accepts exactly the declared request", async () => {
    const handler = createValidatedHandler(
      scanRequestSchema,
      ({ rootId }) => rootId,
    );
    await expect(
      handler({}, { rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf" }),
    ).resolves.toEqual({
      ok: true,
      value: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
    });
  });

  it("validates bounded, distinct multi-album DAP selections without accepting target paths", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(syncProfileRequestSchema, useCase);
    const albumIds = [
      "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
      "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
    ];
    await expect(handler({}, { name: "Road DAP", albumIds })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(useCase).toHaveBeenCalledWith({ name: "Road DAP", albumIds });
    for (const request of [
      { name: "Empty", albumIds: [] },
      { name: "Duplicate", albumIds: [albumIds[0], albumIds[0]] },
      { name: "Path injection", albumIds, targetPath: "/Volumes/DAP" },
    ])
      await expect(handler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("validates both stages of watched-root removal without accepting paths", async () => {
    const preview = vi.fn();
    const previewHandler = createValidatedHandler(
      libraryRootRemovalPreviewRequestSchema,
      preview,
    );
    await expect(
      previewHandler(
        {},
        {
          rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
          path: "/fixture",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(preview).not.toHaveBeenCalled();

    const apply = vi.fn();
    const applyHandler = createValidatedHandler(
      libraryRootRemovalApplyRequestSchema,
      apply,
    );
    await expect(
      applyHandler(
        {},
        {
          operationId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
          confirmationToken: "too-short",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects unknown fields on cancellation requests", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(scanCancelRequestSchema, useCase);
    await expect(
      handler(
        {},
        {
          jobId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
          arbitraryChannel: "filesystem:delete",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
  });

  it("validates bounded Library views and rejects undeclared filters", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(libraryQueryRequestSchema, useCase);
    await expect(
      handler({}, { query: "", view: "albums", offset: 0, limit: 500 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "albums",
          offset: 0,
          limit: 20,
          arbitrarySql: "DROP TABLE albums",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "folders",
          offset: 0,
          limit: 20,
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "tracks",
          offset: 0,
          limit: 20,
          folderId: "/library/album",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenLastCalledWith({
      query: "",
      view: "tracks",
      offset: 0,
      limit: 20,
      folderId: "/library/album",
    });
    await expect(
      handler({}, { query: "", view: "genres", offset: 0, limit: 20 }),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "tracks",
          offset: 0,
          limit: 20,
          genre: "Ambient",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "genres",
          offset: 0,
          limit: 20,
          genre: "Ambient",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "tracks",
          offset: 0,
          limit: 20,
          genre: "Ambient",
          missingGenre: true,
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "folders",
          offset: 0,
          limit: 20,
          folderId: "/library/album",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "data-quality",
          offset: 20,
          limit: 20,
          qualityFilter: "consistency",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenCalledWith({
      query: "fixture",
      view: "data-quality",
      offset: 20,
      limit: 20,
      qualityFilter: "consistency",
    });
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "data-quality",
          offset: 0,
          limit: 20,
          qualityFilter: "guess-for-me",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "artists",
          offset: 0,
          limit: 20,
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenLastCalledWith({
      query: "fixture",
      view: "artists",
      offset: 0,
      limit: 20,
    });
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "albums",
          offset: 0,
          limit: 20,
          albumArtist: "Fixture Artist",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenLastCalledWith({
      query: "fixture",
      view: "albums",
      offset: 0,
      limit: 20,
      albumArtist: "Fixture Artist",
    });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "albums",
          offset: 0,
          limit: 20,
          albumArtist: " ",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "Needle",
          view: "tracks",
          offset: 0,
          limit: 20,
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenLastCalledWith({
      query: "Needle",
      view: "tracks",
      offset: 0,
      limit: 20,
    });
    await expect(
      handler(
        {},
        {
          query: "fl",
          view: "formats",
          offset: 0,
          limit: 20,
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "tracks",
          offset: 0,
          limit: 20,
          format: "FLAC",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenLastCalledWith({
      query: "",
      view: "tracks",
      offset: 0,
      limit: 20,
      format: "FLAC",
    });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "formats",
          offset: 0,
          limit: 20,
          format: "FLAC",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "albums",
          offset: 0,
          limit: 20,
          albumId: "8c196850-bca9-48b7-ae7f-dc760fbf8f2b",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "tracks",
          offset: 0,
          limit: 20,
          albumId: "8c196850-bca9-48b7-ae7f-dc760fbf8f2b",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });

  it("validates saved Library filter definitions and deletion identities", async () => {
    const create = vi.fn();
    const createHandler = createValidatedHandler(
      createSavedLibraryFilterRequestSchema,
      create,
    );
    const valid = {
      name: "Ambient without genre",
      definition: {
        query: "live",
        view: "tracks",
        genre: { name: "No genre tag", missing: true },
      },
    };
    await expect(createHandler({}, valid)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(create).toHaveBeenCalledWith(valid);
    for (const definition of [
      { query: "", view: "albums", format: "FLAC" },
      {
        query: "",
        view: "tracks",
        format: "FLAC",
        genre: { name: "Rock", missing: false },
      },
      { query: "", view: "albums", arbitrarySql: "DROP TABLE albums" },
    ])
      await expect(
        createHandler({}, { name: "Rejected", definition }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });

    const update = vi.fn();
    const updateHandler = createValidatedHandler(
      updateSavedLibraryFilterRequestSchema,
      update,
    );
    const updateRequest = {
      id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
      ...valid,
    };
    await expect(updateHandler({}, updateRequest)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(update).toHaveBeenCalledWith(updateRequest);
    await expect(
      updateHandler({}, { ...updateRequest, id: "not-a-uuid", path: "/tmp" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });

    const remove = vi.fn();
    const removeHandler = createValidatedHandler(
      deleteSavedLibraryFilterRequestSchema,
      remove,
    );
    await expect(
      removeHandler({}, { id: "not-a-uuid", path: "/fixture" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("rejects malformed database restore confirmations", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(
      databaseRestoreApplyRequestSchema,
      useCase,
    );
    await expect(
      handler(
        {},
        {
          operationId: "not-a-uuid",
          confirmationToken: "short",
          databasePath: "/arbitrary/path",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
  });

  it("rejects arbitrary fields and malformed ids on edit history and undo requests", async () => {
    const useCase = vi.fn();
    const history = createValidatedHandler(
      albumEditHistoryRequestSchema,
      useCase,
    );
    const undo = createValidatedHandler(
      albumEditUndoPreviewRequestSchema,
      useCase,
    );
    await expect(
      history(
        {},
        {
          albumId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
          filePath: "/arbitrary/file.mp3",
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    await expect(
      undo({}, { operationId: "not-a-uuid" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    expect(useCase).not.toHaveBeenCalled();
  });

  it("strictly validates track metadata patches", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(
      trackTagEditPreviewRequestSchema,
      useCase,
    );
    const fileId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    await expect(
      handler({}, { fileId, changes: { year: "2025-02-29" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        { fileId, changes: { artist: "Artist", arbitraryFrame: "TXXX" } },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileId, changes: {}, filePath: "/arbitrary/file.mp3" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
  });

  it("limits batch edits to unique track ids and shared safe fields", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(
      trackBatchEditPreviewRequestSchema,
      useCase,
    );
    const first = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const second = "e709f458-a288-4f90-a016-9c42347670bb";
    await expect(
      handler({}, { fileIds: [first, first], changes: { artist: "Artist" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        { fileIds: [first, second], changes: { title: "Mass title" } },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          changes: { artist: "Artist" },
          directory: "/arbitrary/path",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
  });

  it("requires an explicit bounded order for track-number sequencing", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(
      trackNumberSequencePreviewRequestSchema,
      useCase,
    );
    const first = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const second = "e709f458-a288-4f90-a016-9c42347670bb";
    await expect(
      handler({}, { fileIds: [first, first], startNumber: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileIds: [first, second], startNumber: 9999 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileIds: [first, second], startNumber: 1, discNumber: 0 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          startNumber: 1,
          inferredPathOrder: ["/arbitrary/file.mp3"],
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
  });
});
