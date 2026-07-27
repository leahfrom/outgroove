import { open, lstat, realpath } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const MAX_METADATA_BLOCK_BYTES = MAX_ARTWORK_BYTES + 64 * 1024;
const MAX_ID3_SCAN_BYTES = 16 * 1024 * 1024;
const FOLDER_ARTWORK_NAMES = [
  "cover.jpg",
  "cover.jpeg",
  "cover.png",
  "folder.jpg",
  "folder.jpeg",
  "folder.png",
  "front.jpg",
  "front.jpeg",
  "front.png",
] as const;

export type LocalArtworkCandidate =
  | {
      readonly status: "available";
      readonly data: Uint8Array;
      readonly source: "embedded" | "folder";
    }
  | { readonly status: "missing" | "unsupported" | "invalid" };

function synchsafeInteger(bytes: Uint8Array): number {
  if (bytes.length !== 4 || bytes.some((byte) => byte > 0x7f)) return -1;
  return (
    ((bytes[0] ?? 0) << 21) |
    ((bytes[1] ?? 0) << 14) |
    ((bytes[2] ?? 0) << 7) |
    (bytes[3] ?? 0)
  );
}

function uint32(bytes: Uint8Array): number {
  if (bytes.length !== 4) return -1;
  return (
    (bytes[0] ?? 0) * 0x1000000 +
    ((bytes[1] ?? 0) << 16) +
    ((bytes[2] ?? 0) << 8) +
    (bytes[3] ?? 0)
  );
}

async function readExactly(
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number,
): Promise<Uint8Array | undefined> {
  const data = Buffer.alloc(length);
  let completed = 0;
  while (completed < length) {
    const { bytesRead } = await handle.read(
      data,
      completed,
      length - completed,
      position + completed,
    );
    if (bytesRead === 0) return undefined;
    completed += bytesRead;
  }
  return data;
}

function id3PictureData(frame: Uint8Array): Uint8Array | undefined {
  const encoding = frame[0];
  if (encoding === undefined || encoding > 3) return undefined;
  let offset = 1;
  const mimeEnd = frame.indexOf(0, offset);
  if (mimeEnd < 0 || mimeEnd + 1 >= frame.length) return undefined;
  offset = mimeEnd + 2;
  const terminatorLength = encoding === 1 || encoding === 2 ? 2 : 1;
  let descriptionEnd = -1;
  for (let index = offset; index <= frame.length - terminatorLength; index++) {
    if (
      frame[index] === 0 &&
      (terminatorLength === 1 || frame[index + 1] === 0)
    ) {
      descriptionEnd = index;
      break;
    }
  }
  if (descriptionEnd < 0) return undefined;
  const data = frame.subarray(descriptionEnd + terminatorLength);
  return data.length > 0 ? data : undefined;
}

async function embeddedMp3Artwork(
  path: string,
): Promise<LocalArtworkCandidate> {
  const handle = await open(path, "r");
  try {
    const header = await readExactly(handle, 10, 0);
    if (
      !header ||
      Buffer.from(header.subarray(0, 3)).toString("ascii") !== "ID3"
    )
      return { status: "missing" };
    const version = header[3];
    if ((version !== 3 && version !== 4) || ((header[5] ?? 0) & 0x80) !== 0)
      return { status: "unsupported" };
    const tagSize = synchsafeInteger(header.subarray(6, 10));
    if (tagSize < 0 || tagSize > MAX_ID3_SCAN_BYTES)
      return { status: "invalid" };
    let offset = 10;
    const end = 10 + tagSize;
    while (offset + 10 <= end) {
      const frameHeader = await readExactly(handle, 10, offset);
      if (!frameHeader) return { status: "invalid" };
      const id = Buffer.from(frameHeader.subarray(0, 4)).toString("ascii");
      if (/^\0{4}$/u.test(id)) return { status: "missing" };
      const frameSize =
        version === 4
          ? synchsafeInteger(frameHeader.subarray(4, 8))
          : uint32(frameHeader.subarray(4, 8));
      if (frameSize <= 0 || offset + 10 + frameSize > end)
        return { status: "invalid" };
      if (id === "APIC") {
        if (frameSize > MAX_METADATA_BLOCK_BYTES) return { status: "invalid" };
        const frame = await readExactly(handle, frameSize, offset + 10);
        if (!frame) return { status: "invalid" };
        const data = id3PictureData(frame);
        if (!data || data.byteLength > MAX_ARTWORK_BYTES)
          return { status: "invalid" };
        return { status: "available", data, source: "embedded" };
      }
      offset += 10 + frameSize;
    }
    return { status: "missing" };
  } finally {
    await handle.close();
  }
}

function flacPictureData(block: Uint8Array): Uint8Array | undefined {
  let offset = 4;
  const mimeLength = uint32(block.subarray(offset, offset + 4));
  offset += 4 + mimeLength;
  if (mimeLength < 0 || offset + 4 > block.length) return undefined;
  const descriptionLength = uint32(block.subarray(offset, offset + 4));
  offset += 4 + descriptionLength;
  if (descriptionLength < 0 || offset + 20 > block.length) return undefined;
  offset += 16;
  const dataLength = uint32(block.subarray(offset, offset + 4));
  offset += 4;
  if (
    dataLength <= 0 ||
    dataLength > MAX_ARTWORK_BYTES ||
    offset + dataLength !== block.length
  )
    return undefined;
  return block.subarray(offset);
}

async function embeddedFlacArtwork(
  path: string,
): Promise<LocalArtworkCandidate> {
  const handle = await open(path, "r");
  try {
    const signature = await readExactly(handle, 4, 0);
    if (!signature || Buffer.from(signature).toString("ascii") !== "fLaC")
      return { status: "invalid" };
    let offset = 4;
    for (let blocks = 0; blocks < 256; blocks++) {
      const header = await readExactly(handle, 4, offset);
      if (!header) return { status: "invalid" };
      const last = ((header[0] ?? 0) & 0x80) !== 0;
      const type = (header[0] ?? 0) & 0x7f;
      const length =
        ((header[1] ?? 0) << 16) | ((header[2] ?? 0) << 8) | (header[3] ?? 0);
      if (type === 6) {
        if (length > MAX_METADATA_BLOCK_BYTES) return { status: "invalid" };
        const block = await readExactly(handle, length, offset + 4);
        if (!block) return { status: "invalid" };
        const data = flacPictureData(block);
        return data
          ? { status: "available", data, source: "embedded" }
          : { status: "invalid" };
      }
      offset += 4 + length;
      if (last) return { status: "missing" };
    }
    return { status: "invalid" };
  } finally {
    await handle.close();
  }
}

async function folderArtwork(path: string): Promise<LocalArtworkCandidate> {
  const folder = dirname(path);
  const canonicalFolder = await realpath(folder);
  for (const name of FOLDER_ARTWORK_NAMES) {
    const candidate = join(folder, name);
    try {
      const entry = await lstat(candidate);
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const canonicalCandidate = await realpath(candidate);
      if (dirname(canonicalCandidate) !== canonicalFolder) continue;
      const handle = await open(canonicalCandidate, "r");
      try {
        const candidateStat = await handle.stat();
        if (
          !candidateStat.isFile() ||
          candidateStat.size <= 0 ||
          candidateStat.size > MAX_ARTWORK_BYTES
        )
          return { status: "invalid" };
        const data = await readExactly(handle, candidateStat.size, 0);
        return data
          ? { status: "available", data, source: "folder" }
          : { status: "invalid" };
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      )
        continue;
      return { status: "invalid" };
    }
  }
  return { status: "missing" };
}

export async function readLocalArtwork(
  audioPath: string,
): Promise<LocalArtworkCandidate> {
  let embedded: LocalArtworkCandidate;
  try {
    const extension = extname(audioPath).toLocaleLowerCase();
    embedded =
      extension === ".mp3"
        ? await embeddedMp3Artwork(audioPath)
        : extension === ".flac"
          ? await embeddedFlacArtwork(audioPath)
          : { status: "unsupported" };
  } catch {
    embedded = { status: "invalid" };
  }
  if (embedded.status === "available") return embedded;
  try {
    const folder = await folderArtwork(audioPath);
    if (folder.status === "available") return folder;
    return embedded.status === "missing" ? folder : embedded;
  } catch {
    return { status: "invalid" };
  }
}
