import { stat } from "node:fs/promises";

import { parseFile } from "music-metadata";

import { normalizeTechnicalNumber } from "../../../shared/domain/audio-technical";
import type {
  NativeTagValue,
  NormalizedTags,
  ScannedAudioFile,
} from "../../../shared/domain/catalog";
import {
  normalizeGenres,
  normalizeComments,
  normalizeNumber,
  normalizeTagText,
  normalizeTagTextList,
} from "../../../shared/domain/catalog";

export interface MetadataReader {
  read(path: string): Promise<ScannedAudioFile>;
}

function nativeTextValues(
  native: Awaited<ReturnType<typeof parseFile>>["native"],
  ids: readonly string[],
): readonly string[] {
  const accepted = new Set(ids.map((id) => id.toLocaleUpperCase("en-US")));
  return Object.values(native)
    .flat()
    .filter(
      (tag) =>
        accepted.has(tag.id.toLocaleUpperCase("en-US")) &&
        typeof tag.value === "string",
    )
    .map((tag) => tag.value as string);
}

function serializableNativeValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
  if (value === null || value === undefined) return "";
  return Object.prototype.toString.call(value);
}

export class MusicMetadataReader implements MetadataReader {
  async read(path: string): Promise<ScannedAudioFile> {
    const [fileStat, metadata] = await Promise.all([
      stat(path),
      parseFile(path, { duration: true, skipCovers: true }),
    ]);
    if (
      !metadata.format.container &&
      !metadata.format.codec &&
      metadata.format.duration === undefined &&
      Object.keys(metadata.native).length === 0
    ) {
      throw new Error("Unsupported or malformed audio file.");
    }
    const common = metadata.common;
    const comments = normalizeComments(common.comment);
    const publishers = normalizeTagTextList([
      ...(common.label ?? []),
      ...(common.publisher ?? []),
      ...nativeTextValues(metadata.native, ["PUBLISHER", "TPUB"]),
    ]);
    const descriptions = normalizeTagTextList([
      ...(common.description ?? []),
      ...nativeTextValues(metadata.native, ["DESCRIPTION", "TDES"]),
    ]);
    const catalogNumbers = normalizeTagTextList([
      ...(common.catalognumber ?? []),
      ...nativeTextValues(metadata.native, [
        "CATALOGNUMBER",
        "PRODUCTNUMBER",
        "TXXX:CATALOGNUMBER",
      ]),
    ]);
    const artist = normalizeTagText(common.artist, "Unknown artist");
    const codec = normalizeTagText(metadata.format.codec, "");
    const tags: NormalizedTags = {
      title: normalizeTagText(common.title, "Unknown title"),
      album: normalizeTagText(common.album, "Unknown album"),
      artist,
      albumArtist: normalizeTagText(common.albumartist, artist),
      trackNumber: normalizeNumber(common.track.no),
      trackTotal: normalizeNumber(common.track.of),
      discNumber: normalizeNumber(common.disk.no),
      discTotal: normalizeNumber(common.disk.of),
      year: common.date?.trim()
        ? common.date.trim()
        : common.year
          ? String(common.year)
          : null,
      genres: normalizeGenres(common.genre),
      composers: normalizeTagTextList(common.composer),
      conductors: normalizeTagTextList(common.conductor),
      lyricists: normalizeTagTextList(common.lyricist),
      isrcs: normalizeTagTextList(common.isrc),
      copyright: normalizeTagText(common.copyright, "") || null,
      comment: comments.length === 1 ? (comments[0]?.text ?? null) : null,
      comments,
      originalReleaseDate: normalizeTagText(common.originaldate, "") || null,
      language: normalizeTagText(common.language, "") || null,
      publishers,
      descriptions,
      grouping: normalizeTagText(common.grouping, "") || null,
      catalogNumbers,
      publishingDate: normalizeTagText(common.releasedate, "") || null,
      bpm:
        typeof common.bpm === "number" &&
        Number.isFinite(common.bpm) &&
        common.bpm > 0
          ? common.bpm
          : null,
      compilation: common.compilation === true,
      musicBrainzRecordingId:
        normalizeTagText(common.musicbrainz_recordingid, "") || null,
      musicBrainzReleaseTrackId:
        normalizeTagText(common.musicbrainz_trackid, "") || null,
      musicBrainzReleaseId:
        normalizeTagText(common.musicbrainz_albumid, "") || null,
      musicBrainzArtistIds: normalizeTagTextList(common.musicbrainz_artistid),
      musicBrainzReleaseArtistIds: normalizeTagTextList(
        common.musicbrainz_albumartistid,
      ),
      musicBrainzReleaseGroupId:
        normalizeTagText(common.musicbrainz_releasegroupid, "") || null,
      musicBrainzWorkId:
        normalizeTagText(common.musicbrainz_workid, "") || null,
    };
    const nativeTags: NativeTagValue[] = Object.entries(
      metadata.native,
    ).flatMap(([group, entries]) =>
      entries.map((entry) => ({
        id: `${group}:${entry.id}`,
        value: serializableNativeValue(entry.value),
      })),
    );
    return {
      path,
      size: fileStat.size,
      modifiedMs: fileStat.mtimeMs,
      format: metadata.format.container ?? metadata.format.codec ?? "unknown",
      durationSeconds: metadata.format.duration ?? null,
      codec: codec.length > 0 ? codec : null,
      bitrate: normalizeTechnicalNumber(metadata.format.bitrate),
      sampleRate: normalizeTechnicalNumber(metadata.format.sampleRate),
      bitDepth: normalizeTechnicalNumber(metadata.format.bitsPerSample),
      channels: normalizeTechnicalNumber(metadata.format.numberOfChannels),
      tags,
      nativeTags,
    };
  }
}
