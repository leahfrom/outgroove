import { describe, expect, it } from "vitest";

import { validatedArtworkSize } from "./artwork-image-shape";

function pngHeader(width: number, height: number): Uint8Array {
  const data = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(data);
  data.writeUInt32BE(width, 16);
  data.writeUInt32BE(height, 20);
  return data;
}

describe("artwork image bounds", () => {
  it("accepts a bounded PNG header before decode", () => {
    expect(validatedArtworkSize(pngHeader(1200, 1200))).toEqual({
      width: 1200,
      height: 1200,
    });
  });

  it("rejects malformed, over-dimensional, and decode-bomb-shaped input", () => {
    expect(validatedArtworkSize(Buffer.from("not an image"))).toBeUndefined();
    expect(validatedArtworkSize(pngHeader(9000, 10))).toBeUndefined();
    expect(validatedArtworkSize(pngHeader(6000, 6000))).toBeUndefined();
  });
});
