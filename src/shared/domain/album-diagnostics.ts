import type { CatalogAlbum, CatalogTrack } from "./catalog";

export const albumDiagnosticKinds = [
  "missing-title",
  "placeholder-tags",
  "missing-track-number",
  "duplicate-track-number",
  "track-number-gap",
  "inconsistent-album-artist",
  "missing-release-date",
  "inconsistent-release-date",
] as const;

export type AlbumDiagnosticKind = (typeof albumDiagnosticKinds)[number];
export type AlbumDiagnosticSeverity = "needs-attention" | "review";
export type AlbumDiagnosticWorkflow =
  | "track-editor"
  | "sequence"
  | "batch-track-artist"
  | "batch-album-artist"
  | "batch-release-date"
  | "album-title";

export interface AlbumDiagnostic {
  readonly id: string;
  readonly kind: AlbumDiagnosticKind;
  readonly severity: AlbumDiagnosticSeverity;
  readonly title: string;
  readonly explanation: string;
  readonly affectedTrackIds: readonly string[];
  readonly workflow: AlbumDiagnosticWorkflow;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function discNumber(track: CatalogTrack): number {
  return track.tags.discNumber ?? 1;
}

function sortDiagnosticTracks(tracks: readonly CatalogTrack[]): CatalogTrack[] {
  return [...tracks].sort(
    (left, right) =>
      discNumber(left) - discNumber(right) ||
      (left.tags.trackNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.tags.trackNumber ?? Number.MAX_SAFE_INTEGER) ||
      compareText(left.path, right.path) ||
      compareText(left.id, right.id),
  );
}

function ids(tracks: readonly CatalogTrack[]): readonly string[] {
  return sortDiagnosticTracks(tracks).map((track) => track.id);
}

function displayList(values: readonly string[]): string {
  return values.map((value) => `“${value}”`).join(", ");
}

export function diagnoseAlbum(album: CatalogAlbum): readonly AlbumDiagnostic[] {
  const tracks = sortDiagnosticTracks(album.tracks);
  const findings: AlbumDiagnostic[] = [];

  const missingTitles = tracks.filter(
    (track) =>
      track.tags.title.trim() === "" || track.tags.title === "Unknown title",
  );
  if (missingTitles.length > 0)
    findings.push({
      id: "missing-title",
      kind: "missing-title",
      severity: "needs-attention",
      title: "Missing track titles",
      explanation:
        "These files use Outgroove’s exact “Unknown title” scan fallback or contain an empty normalized title. Outgroove cannot infer the real titles.",
      affectedTrackIds: ids(missingTitles),
      workflow: "track-editor",
    });

  const unknownArtists = tracks.filter(
    (track) => track.tags.artist === "Unknown artist",
  );
  const unknownAlbums = tracks.filter(
    (track) => track.tags.album === "Unknown album",
  );
  if (unknownAlbums.length > 0)
    findings.push({
      id: "placeholder-tags:album-title",
      kind: "placeholder-tags",
      severity: "review",
      title: "Unknown album title",
      explanation:
        "The scanner substituted its exact “Unknown album” fallback. This identifies a missing source tag, but not the correct album title.",
      affectedTrackIds: ids(unknownAlbums),
      workflow: "album-title",
    });
  if (unknownArtists.length > 0)
    findings.push({
      id: "placeholder-tags:track-artist",
      kind: "placeholder-tags",
      severity: "review",
      title: "Unknown track artists",
      explanation:
        "The scanner substituted its exact “Unknown artist” fallback. This identifies missing source tags, but not the correct artist.",
      affectedTrackIds: ids(unknownArtists),
      workflow:
        unknownArtists.length > 1 ? "batch-track-artist" : "track-editor",
    });

  const missingNumbers = tracks.filter(
    (track) => track.tags.trackNumber === null,
  );
  if (missingNumbers.length > 0)
    findings.push({
      id: "missing-track-number",
      kind: "missing-track-number",
      severity: "needs-attention",
      title: "Missing track numbers",
      explanation:
        "These tracks have no normalized track number. Review their intended order before proposing numbers.",
      affectedTrackIds: ids(missingNumbers),
      workflow: missingNumbers.length > 1 ? "sequence" : "track-editor",
    });

  const numberedByDisc = new Map<number, CatalogTrack[]>();
  for (const track of tracks) {
    if (track.tags.trackNumber === null) continue;
    const discTracks = numberedByDisc.get(discNumber(track)) ?? [];
    discTracks.push(track);
    numberedByDisc.set(discNumber(track), discTracks);
  }
  for (const [disc, discTracks] of [...numberedByDisc].sort(
    ([left], [right]) => left - right,
  )) {
    const byNumber = new Map<number, CatalogTrack[]>();
    for (const track of discTracks) {
      const number = track.tags.trackNumber;
      if (number === null) continue;
      const numberedTracks = byNumber.get(number) ?? [];
      numberedTracks.push(track);
      byNumber.set(number, numberedTracks);
    }
    for (const [number, duplicateTracks] of [...byNumber].sort(
      ([left], [right]) => left - right,
    ))
      if (duplicateTracks.length > 1)
        findings.push({
          id: `duplicate-track-number:${disc}:${number}`,
          kind: "duplicate-track-number",
          severity: "needs-attention",
          title: `Duplicate number on disc ${disc}`,
          explanation: `${duplicateTracks.length} tracks use disc ${disc}, track ${number}. Outgroove cannot decide which order is correct.`,
          affectedTrackIds: ids(duplicateTracks),
          workflow: "sequence",
        });

    const uniqueNumbers = [...byNumber.keys()].sort(
      (left, right) => left - right,
    );
    const first = uniqueNumbers[0];
    const last = uniqueNumbers.at(-1);
    if (first === undefined || last === undefined) continue;
    const numberSet = new Set(uniqueNumbers);
    const gaps: number[] = [];
    for (let number = first + 1; number < last; number += 1)
      if (!numberSet.has(number)) gaps.push(number);
    if (gaps.length > 0)
      findings.push({
        id: `track-number-gap:${disc}`,
        kind: "track-number-gap",
        severity: "review",
        title: `Track-number gap on disc ${disc}`,
        explanation: `The numbered tracks skip ${displayList(gaps.map(String))} between ${first} and ${last}. Review the complete disc order before proposing a sequence.`,
        affectedTrackIds: ids(discTracks),
        workflow: "sequence",
      });
  }

  const albumArtists = [
    ...new Set(tracks.map((track) => track.tags.albumArtist)),
  ].sort(compareText);
  if (albumArtists.length > 1)
    findings.push({
      id: "inconsistent-album-artist",
      kind: "inconsistent-album-artist",
      severity: "review",
      title: "Inconsistent album artists",
      explanation: `Tracks use different album artist values: ${displayList(albumArtists)}. Choose a shared value only if that matches the release.`,
      affectedTrackIds: ids(tracks),
      workflow: "batch-album-artist",
    });

  const missingDates = tracks.filter(
    (track) => track.tags.year === null || track.tags.year.trim() === "",
  );
  if (missingDates.length > 0)
    findings.push({
      id: "missing-release-date",
      kind: "missing-release-date",
      severity: "review",
      title: "Missing release dates",
      explanation:
        "These tracks have no release date. Outgroove preserves partial dates and will not invent a month or day.",
      affectedTrackIds: ids(missingDates),
      workflow: missingDates.length > 1 ? "batch-release-date" : "track-editor",
    });

  const dates = [
    ...new Set(
      tracks.flatMap((track) =>
        track.tags.year === null || track.tags.year.trim() === ""
          ? []
          : [track.tags.year],
      ),
    ),
  ].sort(compareText);
  if (dates.length > 1)
    findings.push({
      id: "inconsistent-release-date",
      kind: "inconsistent-release-date",
      severity: "review",
      title: "Inconsistent release dates",
      explanation: `Tracks use different partial release dates: ${displayList(dates)}. Outgroove does not assume that the most precise or most common value is correct.`,
      affectedTrackIds: ids(tracks),
      workflow: "batch-release-date",
    });

  const kindOrder = new Map(
    albumDiagnosticKinds.map((kind, index) => [kind, index] as const),
  );
  return findings.sort(
    (left, right) =>
      (kindOrder.get(left.kind) ?? Number.MAX_SAFE_INTEGER) -
        (kindOrder.get(right.kind) ?? Number.MAX_SAFE_INTEGER) ||
      compareText(left.id, right.id),
  );
}
