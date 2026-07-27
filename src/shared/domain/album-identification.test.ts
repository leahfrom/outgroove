import { describe, expect, it } from "vitest";

import type { CatalogAlbum } from "./catalog";
import {
  compareAlbumCandidate,
  compareAlbumCandidates,
  createAlbumCandidateTagDraft,
  formatArtistCredits,
  type AlbumIdentificationCandidate,
} from "./album-identification";

const album: CatalogAlbum = {
  id: "adb9be31-d450-45f9-99de-c9c6143988ad",
  title: "Café Album",
  albumArtist: "Fixture Artist",
  tracks: [1, 2].map((trackNumber) => ({
    id: `track-${trackNumber}`,
    path: `/not-sent/${trackNumber}.flac`,
    size: 1,
    modifiedMs: 1,
    format: "FLAC",
    durationSeconds: 1,
    tags: {
      title: `Track ${trackNumber}`,
      album: "Café Album",
      artist: "Fixture Artist",
      albumArtist: "Fixture Artist",
      trackNumber,
      discNumber: 1,
      year: "2026-04",
      catalogNumbers: ["FIX-2026"],
    },
    nativeTags: [],
    scanError: null,
  })),
};

const candidate: AlbumIdentificationCandidate = {
  releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
  releaseGroupId: "13a6d13b-f42a-49ba-8d54-893791d9f752",
  title: "Cafe Album",
  artistCredits: [
    {
      name: "Fixture Artist",
      joinPhrase: "",
      artistId: "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
    },
  ],
  date: "2026-04-02",
  country: "DE",
  status: "Official",
  trackCount: 2,
  catalogNumbers: ["fix 2026"],
  musicBrainzScore: 100,
};

describe("album candidate comparison", () => {
  it("normalizes text, respects partial dates, and explains a strong result", () => {
    expect(compareAlbumCandidate(album, candidate)).toMatchObject({
      score: 100,
      confidence: "strong",
      conflicts: [],
      matches: [
        "Album title matches",
        "Album artist matches",
        "Track count matches (2)",
        "Release date agrees at known precision (2026-04)",
        "Catalog number matches",
      ],
    });
  });

  it("reports conflicts without automatically correcting either side", () => {
    const compared = compareAlbumCandidate(album, {
      ...candidate,
      title: "Other",
      artistCredits: [{ name: "Other", joinPhrase: "", artistId: null }],
      date: "2025",
      trackCount: 12,
      catalogNumbers: [],
    });
    expect(compared).toMatchObject({ score: 0, confidence: "weak" });
    expect(compared.conflicts).toEqual([
      "Album title differs",
      "Album artist differs",
      "Track count differs (Library 2, MusicBrainz 12)",
      "Release date differs (Library 2026-04, MusicBrainz 2025)",
    ]);
  });

  it("orders deterministically by local evidence before provider score", () => {
    const results = compareAlbumCandidates(album, [
      { ...candidate, releaseId: "b0000000-0000-4000-8000-000000000000" },
      {
        ...candidate,
        releaseId: "a0000000-0000-4000-8000-000000000000",
        title: "Other",
        musicBrainzScore: 100,
      },
    ]);
    expect(results.map((result) => result.releaseId)).toEqual([
      "b0000000-0000-4000-8000-000000000000",
      "a0000000-0000-4000-8000-000000000000",
    ]);
  });

  it("preserves ordered credits and drafts only safe, explicit release fields", () => {
    const proposed = {
      ...candidate,
      artistCredits: [
        {
          name: "Fixture Artist",
          joinPhrase: " feat. ",
          artistId: "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
        },
        {
          name: "Guest Artist",
          joinPhrase: "",
          artistId: "16ffe2a4-14e9-4d25-a4db-c3a6370afacc",
        },
      ],
      catalogNumbers: ["FIX-2026", "ALT-2026"],
    };
    expect(formatArtistCredits(proposed.artistCredits)).toBe(
      "Fixture Artist feat. Guest Artist",
    );
    const draft = createAlbumCandidateTagDraft(album, proposed);
    expect(draft.fields.map(({ field }) => field)).toEqual([
      "albumArtist",
      "year",
      "musicBrainzReleaseId",
      "musicBrainzReleaseGroupId",
    ]);
    expect(draft.fields).not.toContainEqual(
      expect.objectContaining({ field: "trackTotal" }),
    );
    expect(draft.omissions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("title editing is a separate"),
        expect.stringContaining("not inferred"),
        expect.stringContaining("multiple values"),
        expect.stringContaining("multiple credited artists"),
      ]),
    );
  });

  it("does not draft no-ops and blocks lossy replacement of current list fields", () => {
    const alreadyTagged: CatalogAlbum = {
      ...album,
      tracks: album.tracks.map((track) => ({
        ...track,
        tags: {
          ...track.tags,
          year: candidate.date,
          musicBrainzReleaseId: candidate.releaseId,
          musicBrainzReleaseGroupId: candidate.releaseGroupId,
          musicBrainzReleaseArtistIds: [
            "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
            "16ffe2a4-14e9-4d25-a4db-c3a6370afacc",
          ],
          catalogNumbers: ["FIX-2026", "ALT-2026"],
        },
      })),
    };
    const draft = createAlbumCandidateTagDraft(alreadyTagged, {
      ...candidate,
      catalogNumbers: ["FIX-2026"],
    });
    expect(draft.fields).toEqual([]);
    expect(draft.omissions).toEqual(
      expect.arrayContaining([
        expect.stringContaining("multiple current values"),
      ]),
    );
  });
});
