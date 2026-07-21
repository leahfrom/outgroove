import { describe, expect, it, vi } from "vitest";

import {
  scanCancelRequestSchema,
  scanRequestSchema,
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
});
