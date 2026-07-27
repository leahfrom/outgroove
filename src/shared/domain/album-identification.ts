import type { CatalogAlbum } from "./catalog";
import { summarizeAlbumReleaseDate } from "./catalog";

export interface AlbumIdentificationCandidate {
  readonly releaseId: string;
  readonly releaseGroupId: string | null;
  readonly title: string;
  readonly artistCredit: string;
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
    comparisonText(album.albumArtist) === comparisonText(candidate.artistCredit)
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
