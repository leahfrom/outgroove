import type { CatalogAlbum } from "./catalog";
import { summarizeAlbumReleaseDate } from "./catalog";
import { isValidPartialDate } from "./partial-date";

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

export function formatArtistCredits(
  credits: readonly MusicBrainzArtistCredit[],
): string {
  return credits
    .map((credit) => `${credit.name}${credit.joinPhrase}`)
    .join("")
    .normalize("NFC")
    .trim();
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
      `Track count differs (Library ${album.tracks.length}, MusicBrainz ${candidate.trackCount})`,
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
      matches.push(`Release date agrees at known precision (${localDate})`);
    } else {
      conflicts.push(
        `Release date differs (Library ${localDate}, MusicBrainz ${candidate.date})`,
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
    "Album title is not included because title editing is a separate album operation.",
    "Track and disc totals are not inferred from MusicBrainz media counts.",
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
        ? "Album artist is too long for Outgroove's safe writer."
        : "MusicBrainz did not provide an album artist.",
    );

  if (candidate.date && isValidPartialDate(candidate.date))
    proposed.push({
      field: "year",
      label: "Release date",
      value: candidate.date,
      current: (track) => track.tags.year ?? "",
    });
  else
    omissions.push("MusicBrainz did not provide a valid partial release date.");

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
      "Catalog number is not included because this release has multiple values.",
    );
  else if (catalogNumbers.length === 1)
    omissions.push(
      "Catalog number is not included because at least one selected track has multiple current values or the proposed value is too long.",
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
      "Release artist ID is not included because this release has multiple credited artists.",
    );
  else if (releaseArtistIds.length === 1)
    omissions.push(
      "Release artist ID is not included because at least one selected track has multiple current values.",
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
