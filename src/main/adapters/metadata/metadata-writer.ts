import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { loadTrack, saveTrack } from "@akabeko/music-metadata-editor";

import type { ScannedAudioFile } from "../../../shared/domain/catalog";
import type { MetadataReader } from "./metadata-reader";

export interface MetadataWriteResult {
  readonly file: ScannedAudioFile;
  readonly payloadHashBefore: string;
  readonly payloadHashAfter: string;
}

export interface MetadataWriter {
  readonly writableExtensions: ReadonlySet<string>;
  writeAlbumTitle(
    path: string,
    albumTitle: string,
  ): Promise<MetadataWriteResult>;
}

function mp3Payload(bytes: Uint8Array): Uint8Array {
  let start = 0;
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x49 &&
    bytes[1] === 0x44 &&
    bytes[2] === 0x33
  ) {
    start =
      10 +
      ((bytes[6] ?? 0) << 21) +
      ((bytes[7] ?? 0) << 14) +
      ((bytes[8] ?? 0) << 7) +
      (bytes[9] ?? 0);
  }
  let end = bytes.length;
  if (
    end >= 128 &&
    bytes[end - 128] === 0x54 &&
    bytes[end - 127] === 0x41 &&
    bytes[end - 126] === 0x47
  )
    end -= 128;
  return bytes.subarray(start, end);
}

function flacPayload(bytes: Uint8Array): Uint8Array {
  if (
    bytes.length < 8 ||
    String.fromCharCode(...bytes.subarray(0, 4)) !== "fLaC"
  )
    throw new Error("Invalid FLAC header");
  let offset = 4;
  let last = false;
  while (!last) {
    if (offset + 4 > bytes.length) throw new Error("Truncated FLAC metadata");
    last = ((bytes[offset] ?? 0) & 0x80) !== 0;
    const length =
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0);
    offset += 4 + length;
  }
  return bytes.subarray(offset);
}

export async function audioPayloadHash(path: string): Promise<string> {
  const bytes = await readFile(path);
  const extension = extname(path).toLocaleLowerCase("en-US");
  const payload =
    extension === ".mp3"
      ? mp3Payload(bytes)
      : extension === ".flac"
        ? flacPayload(bytes)
        : undefined;
  if (!payload)
    throw new Error(
      `Audio-payload verification is not implemented for ${extension}`,
    );
  return createHash("sha256").update(payload).digest("hex");
}

async function flushPath(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function bestEffortUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export class SafeMetadataWriter implements MetadataWriter {
  readonly writableExtensions = new Set([".mp3", ".flac"]);

  constructor(private readonly reader: MetadataReader) {}

  async writeAlbumTitle(
    path: string,
    albumTitle: string,
  ): Promise<MetadataWriteResult> {
    const extension = extname(path).toLocaleLowerCase("en-US");
    if (!this.writableExtensions.has(extension))
      throw new Error(
        `Writing ${extension || "this format"} is not supported in this slice.`,
      );
    const directory = dirname(path);
    const nonce = randomUUID();
    const temporary = join(
      directory,
      `.${basename(path, extension)}.outgroove-${nonce}.tmp${extension}`,
    );
    const rollback = join(
      directory,
      `.${basename(path)}.outgroove-${nonce}.rollback`,
    );
    const hashBefore = await audioPayloadHash(path);
    let originalMoved = false;
    try {
      const loaded = await loadTrack(path);
      await saveTrack(
        { ...loaded, tag: { ...loaded.tag, album: albumTitle } },
        { source: path, outputPath: temporary },
      );
      await flushPath(temporary);
      const temporaryRead = await this.reader.read(temporary);
      if (temporaryRead.tags.album !== albumTitle)
        throw new Error(
          `Temporary write verification failed: expected album “${albumTitle}”.`,
        );
      const temporaryHash = await audioPayloadHash(temporary);
      if (temporaryHash !== hashBefore)
        throw new Error(
          "Writer changed the audio payload; original was left untouched.",
        );

      await rename(path, rollback);
      originalMoved = true;
      await rename(temporary, path);
      await flushPath(path);
      const finalRead = await this.reader.read(path);
      const hashAfter = await audioPayloadHash(path);
      if (finalRead.tags.album !== albumTitle || hashAfter !== hashBefore)
        throw new Error("Post-replacement verification failed.");
      await bestEffortUnlink(rollback);
      return {
        file: finalRead,
        payloadHashBefore: hashBefore,
        payloadHashAfter: hashAfter,
      };
    } catch (error) {
      if (originalMoved) {
        await bestEffortUnlink(path);
        await rename(rollback, path);
      }
      await bestEffortUnlink(temporary);
      throw error;
    }
  }
}
