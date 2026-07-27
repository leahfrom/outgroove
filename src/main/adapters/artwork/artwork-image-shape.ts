const MAX_DIMENSION = 8192;
const MAX_PIXELS = 25_000_000;

function pngSize(
  data: Uint8Array,
): { width: number; height: number } | undefined {
  if (
    data.length < 24 ||
    Buffer.from(data.subarray(0, 8)).toString("hex") !== "89504e470d0a1a0a"
  )
    return undefined;
  const width = Buffer.from(data).readUInt32BE(16);
  const height = Buffer.from(data).readUInt32BE(20);
  return { width, height };
}

function jpegSize(
  data: Uint8Array,
): { width: number; height: number } | undefined {
  if (data[0] !== 0xff || data[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return undefined;
    const marker = data[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    const length = ((data[offset] ?? 0) << 8) | (data[offset + 1] ?? 0);
    if (length < 2 || offset + length > data.length) return undefined;
    if (
      marker !== undefined &&
      ((marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf))
    ) {
      if (length < 7) return undefined;
      return {
        height: ((data[offset + 3] ?? 0) << 8) | (data[offset + 4] ?? 0),
        width: ((data[offset + 5] ?? 0) << 8) | (data[offset + 6] ?? 0),
      };
    }
    offset += length;
  }
  return undefined;
}

export function validatedArtworkSize(
  data: Uint8Array,
): { width: number; height: number } | undefined {
  const info = validatedArtworkInfo(data);
  return info ? { width: info.width, height: info.height } : undefined;
}

export function validatedArtworkInfo(data: Uint8Array):
  | {
      readonly width: number;
      readonly height: number;
      readonly mimeType: "image/jpeg" | "image/png";
    }
  | undefined {
  const png = pngSize(data);
  const jpeg = png ? undefined : jpegSize(data);
  const size = png ?? jpeg;
  if (
    !size ||
    size.width <= 0 ||
    size.height <= 0 ||
    size.width > MAX_DIMENSION ||
    size.height > MAX_DIMENSION ||
    size.width * size.height > MAX_PIXELS
  )
    return undefined;
  return {
    ...size,
    mimeType: png ? "image/png" : "image/jpeg",
  };
}
