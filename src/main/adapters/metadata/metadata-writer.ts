import { randomUUID } from "node:crypto";
import { open, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { loadTrack, saveTrack } from "@akabeko/music-metadata-editor";

import type { ScannedAudioFile } from "../../../shared/domain/catalog";
import { streamingFileHash } from "../filesystem/streaming-hash";
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

async function mp3PayloadRange(
  path: string,
): Promise<{ start: number; endExclusive: number }> {
  const size = (await stat(path)).size;
  const handle = await open(path, "r");
  let start = 0;
  let endExclusive = size;
  try {
    const header = Buffer.alloc(10);
    const headerRead = await handle.read(header, 0, header.length, 0);
    if (
      headerRead.bytesRead === 10 &&
      header.subarray(0, 3).equals(Buffer.from("ID3"))
    )
      start =
        10 +
        ((header[6] ?? 0) << 21) +
        ((header[7] ?? 0) << 14) +
        ((header[8] ?? 0) << 7) +
        (header[9] ?? 0);
    if (size >= 128) {
      const trailer = Buffer.alloc(3);
      await handle.read(trailer, 0, trailer.length, size - 128);
      if (trailer.equals(Buffer.from("TAG"))) endExclusive -= 128;
    }
  } finally {
    await handle.close();
  }
  if (start > endExclusive) throw new Error("Invalid MP3 tag boundaries");
  return { start, endExclusive };
}

async function flacPayloadRange(
  path: string,
): Promise<{ start: number; endExclusive: number }> {
  const size = (await stat(path)).size;
  const handle = await open(path, "r");
  let offset = 4;
  try {
    const magic = Buffer.alloc(4);
    if (
      (await handle.read(magic, 0, 4, 0)).bytesRead !== 4 ||
      magic.toString() !== "fLaC"
    )
      throw new Error("Invalid FLAC header");
    let last = false;
    while (!last) {
      const header = Buffer.alloc(4);
      if ((await handle.read(header, 0, 4, offset)).bytesRead !== 4)
        throw new Error("Truncated FLAC metadata");
      last = ((header[0] ?? 0) & 0x80) !== 0;
      const length =
        ((header[1] ?? 0) << 16) | ((header[2] ?? 0) << 8) | (header[3] ?? 0);
      offset += 4 + length;
      if (offset > size) throw new Error("Truncated FLAC metadata");
    }
  } finally {
    await handle.close();
  }
  return { start: offset, endExclusive: size };
}

export async function audioPayloadHash(path: string): Promise<string> {
  const extension = extname(path).toLocaleLowerCase("en-US");
  const range =
    extension === ".mp3"
      ? await mp3PayloadRange(path)
      : extension === ".flac"
        ? await flacPayloadRange(path)
        : undefined;
  if (!range)
    throw new Error(
      `Audio-payload verification is not implemented for ${extension}`,
    );
  return streamingFileHash(path, range);
}

async function flushPath(path: string): Promise<void> {
  // Windows rejects FlushFileBuffers/fsync on a read-only handle.
  const handle = await open(path, "r+");
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
