import type { CatalogAlbum } from "./catalog";
import { summarizeAlbumReleaseDate } from "./catalog";
import { isValidPartialDate } from "./partial-date";
import { changedTrackTags, type TrackTagChanges } from "./tag-edit";

export interface MusicBrainzArtistCredit {
  readonly name: string;
  readonly joinPhrase: string;
  readonly artistId: string | null;
}

export interface AlbumIdentificationCandidate {
  readonly releaseId: string;
  readonly releaseGroupId: string | null;
  readonly title: string;
  readonly artistCredits: readonly MusicBrainzArtistCredit[];
  readonly date: string | null;
  readonly country: string | null;
  readonly status: string | null;
  readonly trackCount: number | null;
  readonly catalogNumbers: readonly string[];
  readonly musicBrainzScore: number;
}

export interface ComparedAlbumCandidate extends AlbumIdentificationCandidate {
  readonly score: number;
  readonly confidence: "strong" | "possible" | "weak";
  readonly matches: readonly string[];
  readonly conflicts: readonly string[];
}

export type AlbumCandidateTagField =
  | "albumArtist"
  | "year"
  | "catalogNumber"
  | "musicBrainzReleaseId"
  | "musicBrainzReleaseArtistId"
  | "musicBrainzReleaseGroupId";

export interface AlbumCandidateTagDraft {
  readonly fields: readonly {
    readonly field: AlbumCandidateTagField;
    readonly label: string;
    readonly value: string;
  }[];
  readonly omissions: readonly string[];
}

export interface MusicBrainzReleaseTrack {
  readonly releaseTrackId: string;
  readonly recordingId: string;
  readonly discNumber: number;
  readonly discTotal: number;
  readonly trackNumber: number;
  readonly trackTotal: number;
  readonly title: string;
  readonly artistCredits: readonly MusicBrainzArtistCredit[];
  readonly isrcs: readonly string[];
  readonly lengthMs: number | null;
}

export interface MusicBrainzReleaseTracklist {
  readonly releaseId: string;
  readonly title: string;
  readonly tracks: readonly MusicBrainzReleaseTrack[];
}

export type MusicBrainzTrackDraftField =
  "title" | "artist" | "numbering" | "isrc" | "musicBrainzIds";

export type MusicBrainzTrackDraftFields = Record<
  MusicBrainzTrackDraftField,
  boolean
>;

export interface MusicBrainzMappedTrackChanges {
  readonly title?: string;
  readonly artist?: string;
  readonly trackNumber?: number;
  readonly trackTotal?: number;
  readonly discNumber?: number;
  readonly discTotal?: number;
  readonly isrcs?: string[];
  readonly musicBrainzRecordingId?: string;
  readonly musicBrainzReleaseTrackId?: string;
  readonly musicBrainzArtistIds?: string[];
}

export interface MusicBrainzMappedTrackDraft {
  readonly changes: MusicBrainzMappedTrackChanges;
  readonly omissions: readonly string[];
}

export function formatArtistCredits(
  credits: readonly MusicBrainzArtistCredit[],
): string {
  return credits
    .map((credit) => `${credit.name}${credit.joinPhrase}`)
    .join("")
    .normalize("NFC")
    .trim();
}

export function createMusicBrainzMappedTrackDraft(
  localTrack: CatalogAlbum["tracks"][number],
  remoteTrack: MusicBrainzReleaseTrack,
  enabled: MusicBrainzTrackDraftFields,
): MusicBrainzMappedTrackDraft {
  const proposed: TrackTagChanges = {};
  const omissions: string[] = [];

  if (enabled.title) {
    const title = remoteTrack.title
      .normalize("NFC")
      .replace(/\s+/gu, " ")
      .trim();
    if (title && title.length <= 400) Object.assign(proposed, { title });
    else omissions.push("Track title is empty or longer than 400 characters.");
  }

  if (enabled.artist) {
    const artist = formatArtistCredits(remoteTrack.artistCredits);
    if (artist && artist.length <= 400) Object.assign(proposed, { artist });
    else omissions.push("Track artist is empty or longer than 400 characters.");
  }

  if (enabled.numbering)
    Object.assign(proposed, {
      trackNumber: remoteTrack.trackNumber,
      trackTotal: remoteTrack.trackTotal,
      discNumber: remoteTrack.discNumber,
      discTotal: remoteTrack.discTotal,
    });

  if (enabled.isrc) {
    const isrcs = [
      ...new Set(
        remoteTrack.isrcs
          .map((value) => value.normalize("NFC").trim())
          .filter(Boolean),
      ),
    ];
    if (
      isrcs.length === 1 &&
      isrcs[0] !== undefined &&
      isrcs[0].length <= 100 &&
      (localTrack.tags.isrcs ?? []).length <= 1
    )
      Object.assign(proposed, { isrcs: [isrcs[0]] });
    else if (isrcs.length > 1)
      omissions.push(
        "MusicBrainz lists more than one ISRC, so Outgroove won’t choose one.",
      );
    else if (isrcs.length === 1)
      omissions.push(
        "Outgroove can’t safely replace this track’s current ISRC values with the MusicBrainz value.",
      );
    else omissions.push("MusicBrainz did not provide an ISRC.");
  }

  if (enabled.musicBrainzIds) {
    Object.assign(proposed, {
      musicBrainzRecordingId: remoteTrack.recordingId,
      musicBrainzReleaseTrackId: remoteTrack.releaseTrackId,
    });
    const artistIds = [
      ...new Set(
        remoteTrack.artistCredits.flatMap((credit) =>
          credit.artistId ? [credit.artistId] : [],
        ),
      ),
    ];
    if (
      artistIds.length === 1 &&
      artistIds[0] !== undefined &&
      (localTrack.tags.musicBrainzArtistIds ?? []).length <= 1
    )
      Object.assign(proposed, { musicBrainzArtistIds: [artistIds[0]] });
    else if (artistIds.length > 1)
      omissions.push(
        "This track credits more than one artist, so Outgroove won’t choose one artist ID.",
      );
    else if (artistIds.length === 1)
      omissions.push(
        "This track already has more than one artist ID, so Outgroove won’t replace them automatically.",
      );
    else omissions.push("MusicBrainz did not provide a track artist ID.");
  }

  return {
    changes: changedTrackTags(
      localTrack.tags,
      proposed,
    ) as MusicBrainzMappedTrackChanges,
    omissions,
  };
}

function comparisonText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function consistentCatalogNumbers(album: CatalogAlbum): readonly string[] {
  const values = album.tracks.map((track) =>
    (track.tags.catalogNumbers ?? [])
      .map((value) => comparisonText(value))
      .filter(Boolean),
  );
  if (values.length === 0 || values.some((value) => value.length === 0))
    return [];
  const first = values[0] ?? [];
  return first.filter((value) =>
    values.every((candidate) => candidate.includes(value)),
  );
}

export function compareAlbumCandidate(
  album: CatalogAlbum,
  candidate: AlbumIdentificationCandidate,
): ComparedAlbumCandidate {
  let score = 0;
  const matches: string[] = [];
  const conflicts: string[] = [];
  const localTitle = comparisonText(album.title);
  const candidateTitle = comparisonText(candidate.title);
  if (localTitle === candidateTitle) {
    score += 35;
    matches.push("Album title matches");
  } else {
    conflicts.push("Album title differs");
  }

  if (
    comparisonText(album.albumArtist) ===
    comparisonText(formatArtistCredits(candidate.artistCredits))
  ) {
    score += 30;
    matches.push("Album artist matches");
  } else {
    conflicts.push("Album artist differs");
  }

  if (candidate.trackCount === album.tracks.length) {
    score += 20;
    matches.push(`Track count matches (${candidate.trackCount})`);
  } else if (candidate.trackCount !== null) {
    conflicts.push(
      `Track count differs (your Library: ${album.tracks.length}; MusicBrainz: ${candidate.trackCount})`,
    );
  }

  const localDate = summarizeAlbumReleaseDate(album.tracks).value;
  if (localDate && candidate.date) {
    const sharedPrecision = Math.min(localDate.length, candidate.date.length);
    if (
      localDate.slice(0, sharedPrecision) ===
      candidate.date.slice(0, sharedPrecision)
    ) {
      score += 10;
      matches.push(
        `Release date matches as far as the saved dates show (${localDate})`,
      );
    } else {
      conflicts.push(
        `Release date differs (your Library: ${localDate}; MusicBrainz: ${candidate.date})`,
      );
    }
  }

  const localCatalogNumbers = consistentCatalogNumbers(album);
  const remoteCatalogNumbers = candidate.catalogNumbers.map(comparisonText);
  if (
    localCatalogNumbers.length > 0 &&
    remoteCatalogNumbers.some((value) => localCatalogNumbers.includes(value))
  ) {
    score += 5;
    matches.push("Catalog number matches");
  }

  const boundedScore = Math.min(100, score);
  return {
    ...candidate,
    score: boundedScore,
    confidence:
      boundedScore >= 85 ? "strong" : boundedScore >= 60 ? "possible" : "weak",
    matches,
    conflicts,
  };
}

export function createAlbumCandidateTagDraft(
  album: CatalogAlbum,
  candidate: AlbumIdentificationCandidate,
): AlbumCandidateTagDraft {
  const proposed: {
    readonly field: AlbumCandidateTagField;
    readonly label: string;
    readonly value: string | null;
    readonly current: (track: CatalogAlbum["tracks"][number]) => string;
  }[] = [];
  const omissions = [
    "Album title stays unchanged because it has its own editing step.",
    "Track and disc totals stay unchanged because a MusicBrainz release can contain several discs.",
  ];
  const albumArtist = formatArtistCredits(candidate.artistCredits);
  if (albumArtist && albumArtist.length <= 400)
    proposed.push({
      field: "albumArtist",
      label: "Album artist",
      value: albumArtist,
      current: (track) => track.tags.albumArtist,
    });
  else
    omissions.push(
      albumArtist
        ? "Album artist is too long for Outgroove to write safely."
        : "MusicBrainz did not provide an album artist.",
    );

  if (candidate.date && isValidPartialDate(candidate.date))
    proposed.push({
      field: "year",
      label: "Release date",
      value: candidate.date,
      current: (track) => track.tags.year ?? "",
    });
  else omissions.push("MusicBrainz did not provide a usable release date.");

  const catalogNumbers = [
    ...new Map(
      candidate.catalogNumbers
        .map((value) => value.normalize("NFC").trim())
        .filter(Boolean)
        .map((value) => [comparisonText(value), value] as const),
    ).values(),
  ];
  if (
    catalogNumbers.length === 1 &&
    catalogNumbers[0] !== undefined &&
    catalogNumbers[0].length <= 200 &&
    album.tracks.every((track) => (track.tags.catalogNumbers ?? []).length <= 1)
  )
    proposed.push({
      field: "catalogNumber",
      label: "Catalog number",
      value: catalogNumbers[0],
      current: (track) => (track.tags.catalogNumbers ?? []).join(" · "),
    });
  else if (catalogNumbers.length > 1)
    omissions.push(
      "MusicBrainz lists more than one catalog number, so Outgroove won’t choose one.",
    );
  else if (catalogNumbers.length === 1)
    omissions.push(
      "Outgroove can’t safely replace the selected tracks’ current catalog numbers with this value.",
    );
  else omissions.push("MusicBrainz did not provide a catalog number.");

  proposed.push({
    field: "musicBrainzReleaseId",
    label: "MusicBrainz release ID",
    value: candidate.releaseId,
    current: (track) => track.tags.musicBrainzReleaseId ?? "",
  });
  if (candidate.releaseGroupId)
    proposed.push({
      field: "musicBrainzReleaseGroupId",
      label: "MusicBrainz release group ID",
      value: candidate.releaseGroupId,
      current: (track) => track.tags.musicBrainzReleaseGroupId ?? "",
    });
  else omissions.push("MusicBrainz did not provide a release-group ID.");

  const releaseArtistIds = [
    ...new Set(
      candidate.artistCredits.flatMap((credit) =>
        credit.artistId ? [credit.artistId] : [],
      ),
    ),
  ];
  if (
    releaseArtistIds.length === 1 &&
    releaseArtistIds[0] !== undefined &&
    album.tracks.every(
      (track) => (track.tags.musicBrainzReleaseArtistIds ?? []).length <= 1,
    )
  )
    proposed.push({
      field: "musicBrainzReleaseArtistId",
      label: "MusicBrainz release artist ID",
      value: releaseArtistIds[0],
      current: (track) =>
        (track.tags.musicBrainzReleaseArtistIds ?? []).join(" · "),
    });
  else if (releaseArtistIds.length > 1)
    omissions.push(
      "This release credits more than one artist, so Outgroove won’t choose one artist ID.",
    );
  else if (releaseArtistIds.length === 1)
    omissions.push(
      "At least one selected track already has more than one release artist ID, so Outgroove won’t replace them automatically.",
    );
  else omissions.push("MusicBrainz did not provide a release artist ID.");

  return {
    fields: proposed
      .filter(({ value }) => value !== null)
      .filter(({ current, value }) =>
        album.tracks.some((track) => current(track) !== value),
      )
      .map(({ field, label, value }) => ({
        field,
        label,
        value: value ?? "",
      })),
    omissions,
  };
}

export function compareAlbumCandidates(
  album: CatalogAlbum,
  candidates: readonly AlbumIdentificationCandidate[],
): readonly ComparedAlbumCandidate[] {
  return candidates
    .map((candidate) => compareAlbumCandidate(album, candidate))
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        right.musicBrainzScore - left.musicBrainzScore ||
        left.releaseId.localeCompare(right.releaseId),
    );
}
