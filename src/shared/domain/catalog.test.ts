import { describe, expect, it } from "vitest";

import {
  albumGroupingKey,
  compareAlbumsByArtistReleaseDateTitle,
  folderAlbumGroupingKey,
  normalizeGenres,
  normalizeTagTextList,
  normalizeNumber,
  normalizeTagText,
  sortTracks,
  summarizeAlbumReleaseDate,
  type CatalogAlbum,
  type NormalizedTags,
} from "./catalog";

const tags: NormalizedTags = {
  title: "Track",
  album: "Album",
  artist: "Artist",
  albumArtist: "Album Artist",
  trackNumber: 2,
  discNumber: 1,
  year: "2026",
};

describe("catalog normalization and grouping", () => {
  it("normalizes whitespace, Unicode, and fractional track numbers", () => {
    expect(normalizeTagText("  Cafe\u0301   Session ", "fallback")).toBe(
      "Café Session",
    );
    expect(normalizeNumber("03/12")).toBe(3);
    expect(normalizeNumber("none")).toBeNull();
  });

  it("normalizes, deduplicates, and deterministically orders multi-value genres", () => {
    expect(
      normalizeGenres(["  Rock ", "ambient", "ROCK", "Cafe\u0301", "", null]),
    ).toEqual(["ambient", "Café", "Rock"]);
    expect(normalizeGenres(undefined)).toEqual([]);
    expect(normalizeGenres("Rock")).toEqual([]);
  });

  it("normalizes and deduplicates ordered contributor values", () => {
    expect(
      normalizeTagTextList([
        "  First   Composer ",
        "Second Composer",
        "first composer",
        "",
      ]),
    ).toEqual(["First Composer", "Second Composer"]);
  });

  it("groups by normalized album artist and album, then orders disc and track", () => {
    expect(albumGroupingKey(tags, "/one")).toBe(
      albumGroupingKey({ ...tags, albumArtist: "ALBUM ARTIST" }, "/two"),
    );
    const ordered = sortTracks([
      { path: "b", tags },
      { path: "a", tags: { ...tags, trackNumber: 1 } },
    ]);
    expect(ordered.map((track) => track.path)).toEqual(["a", "b"]);
  });

  it("keeps unknown albums separated by folder", () => {
    const unknown = { ...tags, album: "Unknown album" };
    expect(albumGroupingKey(unknown, "/one")).not.toBe(
      albumGroupingKey(unknown, "/two"),
    );
  });

  it("matches album titles within one comparison-key folder independently of artist", () => {
    expect(folderAlbumGroupingKey("ALBUM", "/music/artist/album")).toBe(
      folderAlbumGroupingKey("Album", "/music/artist/album"),
    );
    expect(folderAlbumGroupingKey("Album", "/music/artist/album")).not.toBe(
      folderAlbumGroupingKey("Album", "/music/other/album"),
    );
  });
});

function album(
  id: string,
  albumArtist: string,
  title: string,
  dates: readonly (string | null)[],
): CatalogAlbum {
  return {
    id,
    albumArtist,
    title,
    tracks: dates.map((year, index) => ({
      id: `${id}-${index}`,
      path: `/fixture/${id}-${index}.flac`,
      size: 1,
      modifiedMs: 1,
      format: "FLAC",
      durationSeconds: 1,
      tags: {
        title: `Track ${index + 1}`,
        album: title,
        artist: albumArtist,
        albumArtist,
        trackNumber: index + 1,
        discNumber: 1,
        year,
      },
      nativeTags: [],
      scanError: null,
    })),
  };
}

describe("album presentation", () => {
  it("summarizes only one valid release date shared by every track", () => {
    expect(
      summarizeAlbumReleaseDate(
        album("one", "Artist", "One", ["2024-03", "2024-03"]).tracks,
      ),
    ).toEqual({ status: "consistent", value: "2024-03" });
    expect(
      summarizeAlbumReleaseDate(
        album("missing", "Artist", "Missing", [null, null]).tracks,
      ),
    ).toEqual({ status: "missing", value: null });
    expect(
      summarizeAlbumReleaseDate(
        album("mixed", "Artist", "Mixed", ["2024", "2024-03"]).tracks,
      ),
    ).toEqual({ status: "mixed", value: null });
    expect(
      summarizeAlbumReleaseDate(
        album("partial", "Artist", "Partial", ["2024", null]).tracks,
      ),
    ).toEqual({ status: "mixed", value: null });
    expect(
      summarizeAlbumReleaseDate(
        album("invalid", "Artist", "Invalid", ["2024-13"]).tracks,
      ),
    ).toEqual({ status: "mixed", value: null });
  });

  it("orders by artist, known preserved date, title, and stable id", () => {
    const albums = [
      album("unknown", "Artist", "Unknown", [null]),
      album("later", "Artist", "Later", ["2024"]),
      album("earlier-b", "Artist", "Beta", ["2020"]),
      album("other", "Another Artist", "Other", [null]),
      album("earlier-a", "Artist", "Alpha", ["2020"]),
    ];

    expect(
      [...albums]
        .sort(compareAlbumsByArtistReleaseDateTitle)
        .map((candidate) => candidate.id),
    ).toEqual(["other", "earlier-a", "earlier-b", "later", "unknown"]);
  });
});
