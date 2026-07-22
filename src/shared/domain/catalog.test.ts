import { describe, expect, it } from "vitest";

import {
  albumGroupingKey,
  folderAlbumGroupingKey,
  normalizeGenres,
  normalizeNumber,
  normalizeTagText,
  sortTracks,
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
