import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const ILLEGAL = /[<>:"/\\|?*]/u;

export class UnsafeDestinationError extends Error {}

export function validateDestinationSegment(value: string): string {
  const segment = value.normalize("NFC").trim();
  if (
    !segment ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\")
  )
    throw new UnsafeDestinationError(`Unsafe path segment: “${value}”.`);
  if (
    ILLEGAL.test(segment) ||
    Array.from(segment).some((character) => character.charCodeAt(0) < 32)
  )
    throw new UnsafeDestinationError(
      `Path segment contains a reserved character: “${value}”.`,
    );
  if (WINDOWS_RESERVED.test(segment) || /[. ]$/u.test(segment))
    throw new UnsafeDestinationError(`Reserved target name: “${value}”.`);
  if (segment.length > 120)
    throw new UnsafeDestinationError(
      `Path segment is longer than 120 characters: “${value}”.`,
    );
  return segment;
}

export function containedDestination(
  targetRoot: string,
  segments: readonly string[],
): { absolute: string; relative: string } {
  const safe = segments.map(validateDestinationSegment);
  const absolute = resolve(targetRoot, ...safe);
  const relativePath = relative(resolve(targetRoot), absolute);
  if (
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  )
    throw new UnsafeDestinationError(
      "Destination escapes the selected target root.",
    );
  if (absolute.length > 240)
    throw new UnsafeDestinationError(
      "Destination path is longer than 240 characters.",
    );
  return { absolute, relative: relativePath };
}

export function trackDestinationSegments(track: {
  path: string;
  tags: {
    albumArtist: string;
    artist: string;
    album: string;
    discNumber: number | null;
    trackNumber: number | null;
    title: string;
  };
}): string[] {
  const artist = track.tags.albumArtist || track.tags.artist;
  const disc = String(track.tags.discNumber ?? 1).padStart(2, "0");
  const number = String(track.tags.trackNumber ?? 0).padStart(2, "0");
  const extension = extname(track.path).toLocaleLowerCase("en-US");
  return [
    artist,
    track.tags.album,
    `${disc}-${number} ${track.tags.title}${extension}`,
  ];
}
