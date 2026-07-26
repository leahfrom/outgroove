import { nativeImage } from "electron";

import { validatedArtworkSize } from "./artwork-image-shape";

const THUMBNAIL_EDGE = 384;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

export interface ArtworkThumbnailEncoder {
  encode(data: Uint8Array): string | undefined;
}

export class ElectronArtworkThumbnailEncoder implements ArtworkThumbnailEncoder {
  encode(data: Uint8Array): string | undefined {
    const size = validatedArtworkSize(data);
    if (!size) return undefined;
    const image = nativeImage.createFromBuffer(Buffer.from(data));
    if (image.isEmpty()) return undefined;
    const largestEdge = Math.max(size.width, size.height);
    const scale = Math.min(1, THUMBNAIL_EDGE / largestEdge);
    const thumbnail = image.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: "good",
    });
    const encoded = thumbnail.toPNG();
    if (encoded.byteLength > MAX_THUMBNAIL_BYTES) return undefined;
    return `data:image/png;base64,${encoded.toString("base64")}`;
  }
}
