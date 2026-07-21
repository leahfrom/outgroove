import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { containedDestination, validateDestinationSegment } from "./sync-paths";

describe("target destination safety", () => {
  it("preserves safe Unicode and rejects traversal, separators, reserved names, and long segments", () => {
    expect(validateDestinationSegment("Björk 東京")).toBe("Björk 東京");
    for (const unsafe of [
      "..",
      ".",
      "../escape",
      "..\\escape",
      "CON",
      "lpt1.txt",
      "bad:name",
      "x".repeat(121),
    ]) {
      expect(() => validateDestinationSegment(unsafe)).toThrow();
    }
  });

  it("never produces a path outside the selected root for arbitrary accepted segments", () => {
    const root = join(process.cwd(), "target");
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 80 }), (value) => {
        try {
          const destination = containedDestination(root, [value]);
          expect(
            destination.absolute.startsWith(`${root}/`) ||
              destination.absolute.startsWith(`${root}\\`),
          ).toBe(true);
        } catch {
          expect(() => validateDestinationSegment(value)).toThrow();
        }
      }),
    );
  });
});
