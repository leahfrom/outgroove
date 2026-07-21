import type { ZodType } from "zod";

import type { Result } from "../../shared/domain/errors";

export function serializeError(error: unknown): Result<never> {
  return {
    ok: false,
    error: {
      code:
        error instanceof Error && error.name === "ZodError"
          ? "INVALID_REQUEST"
          : "OPERATION_FAILED",
      message:
        error instanceof Error ? error.message : "Unknown operation failure.",
      recoverable: true,
    },
  };
}

export function createValidatedHandler<Input, Output>(
  schema: ZodType<Input>,
  handler: (input: Input) => Promise<Output> | Output,
): (_event: unknown, input: unknown) => Promise<Result<Output>> {
  return async (_event, input) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        error: {
          code: "INVALID_REQUEST",
          message: "The request payload was rejected.",
          recoverable: true,
        },
      };
    try {
      return { ok: true, value: await handler(parsed.data) };
    } catch (error) {
      return serializeError(error);
    }
  };
}
