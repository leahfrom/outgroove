import { describe, expect, it, vi } from "vitest";

import {
  albumEditHistoryRequestSchema,
  albumEditUndoPreviewRequestSchema,
  databaseRestoreApplyRequestSchema,
  scanCancelRequestSchema,
  libraryQueryRequestSchema,
  scanRequestSchema,
  trackBatchEditPreviewRequestSchema,
  trackNumberSequencePreviewRequestSchema,
  trackTagEditPreviewRequestSchema,
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
