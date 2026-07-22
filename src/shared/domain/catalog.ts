export interface NativeTagValue {
  readonly id: string;
  readonly value: string;
}

export interface NormalizedTags {
  readonly title: string;
  readonly album: string;
  readonly artist: string;
  readonly albumArtist: string;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
  readonly year: string | null;
  readonly genres?: readonly string[];
}

export interface ScannedAudioFile {
  readonly path: string;
  readonly size: number;
  readonly modifiedMs: number;
  readonly format: string;
  readonly durationSeconds: number | null;
  readonly codec?: string | null;
  readonly bitrate?: number | null;
  readonly sampleRate?: number | null;
  readonly bitDepth?: number | null;
  readonly channels?: number | null;
  readonly tags: NormalizedTags;
  readonly nativeTags: readonly NativeTagValue[];
}

export interface CatalogTrack extends ScannedAudioFile {
  readonly id: string;
  readonly scanError: string | null;
}

export interface CatalogAlbum {
  readonly id: string;
  readonly title: string;
  readonly albumArtist: string;
  readonly tracks: readonly CatalogTrack[];
}

export function normalizeTagText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : fallback;
}

export function normalizeGenres(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];

  const genres = new Map<string, string>();
  for (const candidate of value) {
    const genre = normalizeTagText(candidate, "");
    if (!genre) continue;
    const key = genre.toLocaleLowerCase("en-US");
    if (!genres.has(key)) genres.set(key, genre);
  }

  return [...genres.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, genre]) => genre);
}

export function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0)
    return value;
  if (typeof value === "string") {
    const first = value.split("/")[0]?.trim();
    const parsed = Number(first);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export function albumGroupingKey(
  tags: NormalizedTags,
  parentFolder: string,
): string {
  const artist = tags.albumArtist || tags.artist;
  const textual = `${artist}\u0000${tags.album}`
    .normalize("NFC")
    .toLocaleLowerCase("en-US");
  return tags.album === "Unknown album"
    ? `${textual}\u0000${parentFolder}`
    : textual;
}

export function folderAlbumGroupingKey(
  albumTitle: string,
  parentFolderKey: string,
): string {
  return `${parentFolderKey}\u0000${albumTitle}`
    .normalize("NFC")
    .toLocaleLowerCase("en-US");
}

export function sortTracks<T extends { tags: NormalizedTags; path: string }>(
  tracks: readonly T[],
): T[] {
  return [...tracks].sort(
    (left, right) =>
      (left.tags.discNumber ?? 0) - (right.tags.discNumber ?? 0) ||
      (left.tags.trackNumber ?? 0) - (right.tags.trackNumber ?? 0) ||
      left.path.localeCompare(right.path),
  );
}
