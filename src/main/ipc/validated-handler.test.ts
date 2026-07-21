import { describe, expect, it, vi } from "vitest";

import {
  albumEditHistoryRequestSchema,
  albumEditUndoPreviewRequestSchema,
  databaseRestoreApplyRequestSchema,
  scanCancelRequestSchema,
  libraryQueryRequestSchema,
  scanRequestSchema,
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

  it("caps library query pages and rejects undeclared filters", async () => {
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
});
