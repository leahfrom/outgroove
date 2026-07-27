import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import {
  loadTrack,
  saveTrack,
  writeMetadata,
} from "@akabeko/music-metadata-editor";
import type { PictureInfo, TagData } from "@akabeko/music-metadata-editor";
import { TagLib } from "taglib-wasm";

import type { ScannedAudioFile } from "../../../shared/domain/catalog";
import { streamingFileHash } from "../filesystem/streaming-hash";
import type { MetadataReader } from "./metadata-reader";

export interface MetadataWriteResult {
  readonly file: ScannedAudioFile;
  readonly payloadHashBefore: string;
  readonly payloadHashAfter: string;
}

export interface MetadataTagChanges {
  readonly title?: string;
  readonly album?: string;
  readonly artist?: string;
  readonly albumArtist?: string;
  readonly trackNumber?: number | null;
  readonly trackTotal?: number | null;
  readonly discNumber?: number | null;
  readonly discTotal?: number | null;
  readonly year?: string | null;
  readonly genres?: readonly string[];
  readonly composers?: readonly string[];
  readonly conductors?: readonly string[];
  readonly lyricists?: readonly string[];
  readonly isrcs?: readonly string[];
  readonly copyright?: string | null;
  readonly comment?: string | null;
  readonly originalReleaseDate?: string | null;
  readonly language?: string | null;
  readonly publishers?: readonly string[];
  readonly descriptions?: readonly string[];
  readonly grouping?: string | null;
  readonly catalogNumbers?: readonly string[];
  readonly publishingDate?: string | null;
  readonly bpm?: number | null;
  readonly compilation?: boolean;
  readonly musicBrainzRecordingId?: string | null;
  readonly musicBrainzReleaseTrackId?: string | null;
  readonly musicBrainzReleaseId?: string | null;
  readonly musicBrainzArtistIds?: readonly string[];
  readonly musicBrainzReleaseArtistIds?: readonly string[];
  readonly musicBrainzReleaseGroupId?: string | null;
  readonly musicBrainzWorkId?: string | null;
}

export interface MetadataWriter {
  readonly writableExtensions: ReadonlySet<string>;
  readPictures(path: string): Promise<readonly PictureInfo[]>;
  writePictures(
    path: string,
    pictures: readonly PictureInfo[],
  ): Promise<MetadataWriteResult>;
  writeTags(
    path: string,
    changes: MetadataTagChanges,
  ): Promise<MetadataWriteResult>;
  writeAlbumTitle(
    path: string,
    albumTitle: string,
  ): Promise<MetadataWriteResult>;
}

function pictureFingerprint(pictures: readonly PictureInfo[]): string {
  const hash = createHash("sha256");
  for (const picture of pictures) {
    hash.update(picture.mimeType);
    hash.update("\0");
    hash.update(String(picture.kind));
    hash.update("\0");
    hash.update(picture.description ?? "");
    hash.update("\0");
    hash.update(picture.data);
  }
  return hash.digest("hex");
}

function applyChanges(tag: TagData, changes: MetadataTagChanges): TagData {
  const updated = { ...tag };
  for (const field of ["title", "album", "artist", "albumArtist"] as const) {
    if (!(field in changes)) continue;
    const value = changes[field];
    if (value === undefined) throw new Error(`${field} is invalid.`);
    Object.assign(updated, { [field]: value });
  }
  if ("trackNumber" in changes) {
    if (changes.trackNumber === null) delete updated.trackNumber;
    else updated.trackNumber = changes.trackNumber;
  }
  if ("trackTotal" in changes) {
    if (changes.trackTotal === null) delete updated.trackTotal;
    else updated.trackTotal = changes.trackTotal;
  }
  if ("discNumber" in changes) {
    if (changes.discNumber === null) delete updated.discNumber;
    else updated.discNumber = changes.discNumber;
  }
  if ("discTotal" in changes) {
    if (changes.discTotal === null) delete updated.discTotal;
    else updated.discTotal = changes.discTotal;
  }
  if ("year" in changes) {
    const year = changes.year;
    delete updated.year;
    delete updated.recordingDate;
    if (year && /^\d{4}$/u.test(year)) updated.year = Number(year);
    else if (year) updated.recordingDate = year;
  }
  if (changes.genres !== undefined) {
    const genres = changes.genres;
    if (genres.length > 1)
      throw new Error("This writer supports one proposed genre value.");
    updated.genre = genres[0] ?? "";
  }
  if (changes.composers !== undefined) {
    const composers = changes.composers;
    if (composers.length > 1)
      throw new Error("This writer supports one proposed composer value.");
    updated.composer = composers[0] ?? "";
  }
  if (changes.conductors !== undefined) {
    const conductors = changes.conductors;
    if (conductors.length > 1)
      throw new Error("This writer supports one proposed conductor value.");
    updated.conductor = conductors[0] ?? "";
  }
  if (changes.lyricists !== undefined) {
    const lyricists = changes.lyricists;
    if (lyricists.length > 1)
      throw new Error("This writer supports one proposed lyricist value.");
    updated.lyricist = lyricists[0] ?? "";
  }
  if (changes.isrcs !== undefined) {
    const isrcs = changes.isrcs;
    if (isrcs.length > 1)
      throw new Error("This writer supports one proposed ISRC.");
    updated.isrc = isrcs[0] ?? "";
  }
  if ("copyright" in changes) updated.copyright = changes.copyright ?? "";
  if ("comment" in changes) updated.comment = changes.comment ?? "";
  if ("originalReleaseDate" in changes)
    updated.originalReleaseDate = changes.originalReleaseDate ?? "";
  if ("language" in changes) updated.language = changes.language ?? "";
  if ("publishers" in changes) {
    const publishers = changes.publishers;
    if (publishers.length > 1)
      throw new Error("This writer supports one proposed publisher.");
    updated.publisher = publishers[0] ?? "";
  }
  if ("descriptions" in changes) {
    const descriptions = changes.descriptions;
    if (descriptions.length > 1)
      throw new Error("This writer supports one proposed description.");
    updated.description = descriptions[0] ?? "";
  }
  if ("publishingDate" in changes)
    updated.publishingDate = changes.publishingDate ?? "";
  if ("bpm" in changes) {
    // Akabeko treats an explicit empty runtime value as "manage and remove"
    // for both ID3 TBPM and Vorbis BPM. Its public numeric type omits that
    // clearing sentinel, so the regression fixtures guard this narrow cast.
    updated.bpm = (changes.bpm ?? "") as number;
  }
  return updated;
}

const extendedPropertyFields = [
  "grouping",
  "catalogNumbers",
  "compilation",
  "musicBrainzRecordingId",
  "musicBrainzReleaseTrackId",
  "musicBrainzReleaseId",
  "musicBrainzArtistIds",
  "musicBrainzReleaseArtistIds",
  "musicBrainzReleaseGroupId",
  "musicBrainzWorkId",
] as const;

type ExtendedPropertyField = (typeof extendedPropertyFields)[number];

const extendedPropertyKeys: Readonly<Record<ExtendedPropertyField, string>> = {
  grouping: "GROUPING",
  catalogNumbers: "CATALOGNUMBER",
  compilation: "COMPILATION",
  musicBrainzRecordingId: "MUSICBRAINZ_TRACKID",
  musicBrainzReleaseTrackId: "MUSICBRAINZ_RELEASETRACKID",
  musicBrainzReleaseId: "MUSICBRAINZ_ALBUMID",
  musicBrainzArtistIds: "MUSICBRAINZ_ARTISTID",
  musicBrainzReleaseArtistIds: "MUSICBRAINZ_ALBUMARTISTID",
  musicBrainzReleaseGroupId: "MUSICBRAINZ_RELEASEGROUPID",
  musicBrainzWorkId: "MUSICBRAINZ_WORKID",
};

let tagLibPromise: Promise<TagLib> | undefined;

function tagLib(): Promise<TagLib> {
  // Keep one deterministic in-memory backend across Node platforms. The WASI
  // property-map saver currently normalizes unrelated MP3 totals and FLAC
  // descriptions differently from the Emscripten backend.
  tagLibPromise ??= TagLib.initialize({ forceWasmType: "emscripten" });
  return tagLibPromise;
}

function extendedPropertyValue(
  field: ExtendedPropertyField,
  changes: MetadataTagChanges,
): string {
  const value = changes[field];
  if (value !== null && typeof value === "object") {
    const [first] = value;
    return first ?? "";
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return value ?? "";
}

async function applyExtendedProperties(
  path: string,
  changes: MetadataTagChanges,
): Promise<void> {
  const fields = extendedPropertyFields.filter((field) => field in changes);
  if (fields.length === 0) return;
  const writer = await tagLib();
  const input = await readFile(path);
  const output = await writer.edit(input, (file) => {
    for (const field of fields)
      file.setProperty(
        extendedPropertyKeys[field],
        extendedPropertyValue(field, changes),
      );
    if (file.getFormat() === "MP3" && changes.comment === null)
      file.tag().setComment("");
    if (file.getFormat() === "FLAC" && changes.trackTotal === null)
      file.setProperty("totalTracks", "");
    if (file.getFormat() === "FLAC" && changes.discTotal === null)
      file.setProperty("totalDiscs", "");
  });
  await writeFile(path, output);
}

function akabekoChanges(changes: MetadataTagChanges): MetadataTagChanges {
  const result: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(changes))
    if (!(extendedPropertyFields as readonly string[]).includes(field))
      result[field] = value;
  return result;
}

function mismatchedFields(
  file: ScannedAudioFile,
  changes: MetadataTagChanges,
): readonly (keyof MetadataTagChanges)[] {
  const listFields = [
    "genres",
    "composers",
    "conductors",
    "lyricists",
    "isrcs",
    "publishers",
    "descriptions",
    "catalogNumbers",
    "musicBrainzArtistIds",
    "musicBrainzReleaseArtistIds",
  ] as const;
  const mismatches: (keyof MetadataTagChanges)[] = [];
  for (const field of listFields) {
    const proposed = changes[field];
    if (proposed === undefined) continue;
    const actual = file.tags[field] ?? [];
    if (
      actual.length !== proposed.length ||
      !actual.every((value, index) => value === proposed[index])
    )
      mismatches.push(field);
  }
  for (const field of Object.keys(changes) as (keyof MetadataTagChanges)[]) {
    if (
      !(listFields as readonly string[]).includes(field) &&
      file.tags[field] !== changes[field]
    )
      mismatches.push(field);
  }
  return mismatches;
}

function changesMatch(
  file: ScannedAudioFile,
  changes: MetadataTagChanges,
): boolean {
  return mismatchedFields(file, changes).length === 0;
}

function expectedDescription(changes: MetadataTagChanges): string {
  return (Object.entries(changes) as [string, unknown][])
    .map(([field, value]) => `${field}=${JSON.stringify(value)}`)
    .join(", ");
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

  async readPictures(path: string): Promise<readonly PictureInfo[]> {
    const extension = extname(path).toLocaleLowerCase("en-US");
    if (!this.writableExtensions.has(extension))
      throw new Error(
        `Reading embedded artwork from ${extension || "this format"} is not supported in this slice.`,
      );
    return (await loadTrack(path)).pictures;
  }

  async writeAlbumTitle(
    path: string,
    albumTitle: string,
  ): Promise<MetadataWriteResult> {
    return this.writeTags(path, { album: albumTitle });
  }

  async writeTags(
    path: string,
    changes: MetadataTagChanges,
  ): Promise<MetadataWriteResult> {
    if (Object.keys(changes).length === 0)
      throw new Error("At least one metadata field must change.");
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
      const highLevelChanges = akabekoChanges(changes);
      if (Object.keys(highLevelChanges).length === 0) {
        await copyFile(path, temporary);
      } else {
        const loaded = await loadTrack(path);
        const updatedTag = applyChanges(loaded.tag, highLevelChanges);
        if (extension === ".mp3") {
          // ID3v2.3 uses Latin-1 in this adapter and corrupts existing Unicode
          // fields during an otherwise unrelated edit. ID3v2.4 writes UTF-8.
          const bytes = await writeMetadata(path, {
            tag: updatedTag,
            id3v2MajorVersion: 4,
          } as Parameters<typeof writeMetadata>[1] & {
            id3v2MajorVersion: 4;
          });
          await writeFile(temporary, bytes, { flag: "wx" });
        } else {
          await saveTrack(
            { ...loaded, tag: updatedTag },
            { source: path, outputPath: temporary },
          );
        }
      }
      await applyExtendedProperties(temporary, changes);
      await flushPath(temporary);
      const temporaryRead = await this.reader.read(temporary);
      const temporaryMismatches = mismatchedFields(temporaryRead, changes);
      if (temporaryMismatches.length > 0)
        throw new Error(
          `Temporary write verification failed for ${temporaryMismatches.join(", ")}: expected ${expectedDescription(changes)}.`,
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
      if (!changesMatch(finalRead, changes) || hashAfter !== hashBefore)
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

  async writePictures(
    path: string,
    pictures: readonly PictureInfo[],
  ): Promise<MetadataWriteResult> {
    const extension = extname(path).toLocaleLowerCase("en-US");
    if (!this.writableExtensions.has(extension))
      throw new Error(
        `Writing embedded artwork to ${extension || "this format"} is not supported in this slice.`,
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
    // The format adapter receives owned byte arrays so it cannot mutate the
    // previewed proposal that the application layer later verifies.
    const ownedPictures = pictures.map((picture) => ({
      ...picture,
      data: picture.data.slice(),
    }));
    const expectedPictures = pictureFingerprint(ownedPictures);
    const hashBefore = await audioPayloadHash(path);
    let originalMoved = false;
    try {
      const loaded = await loadTrack(path);
      if (extension === ".mp3") {
        const bytes = await writeMetadata(path, {
          tag: loaded.tag,
          pictures: ownedPictures,
          id3v2MajorVersion: 4,
        } as Parameters<typeof writeMetadata>[1] & {
          id3v2MajorVersion: 4;
        });
        await writeFile(temporary, bytes, { flag: "wx" });
      } else {
        await saveTrack(
          { ...loaded, pictures: ownedPictures },
          { source: path, outputPath: temporary },
        );
      }
      await flushPath(temporary);
      const temporaryTrack = await loadTrack(temporary);
      if (pictureFingerprint(temporaryTrack.pictures) !== expectedPictures)
        throw new Error(
          "Temporary artwork verification failed; original was left untouched.",
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
      const finalTrack = await loadTrack(path);
      const finalRead = await this.reader.read(path);
      const hashAfter = await audioPayloadHash(path);
      if (
        pictureFingerprint(finalTrack.pictures) !== expectedPictures ||
        hashAfter !== hashBefore
      )
        throw new Error("Post-replacement artwork verification failed.");
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
