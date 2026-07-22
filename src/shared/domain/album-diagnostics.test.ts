import { describe, expect, it } from "vitest";

import type { CatalogAlbum, CatalogTrack } from "./catalog";
import {
  diagnoseAlbum,
  diagnosticMatchesFilter,
  type AlbumDiagnosticFilter,
} from "./album-diagnostics";

const baseTrack: CatalogTrack = {
  id: "track-1",
  path: "/album/01.flac",
  size: 100,
  modifiedMs: 1,
  format: "FLAC",
  durationSeconds: 60,
  tags: {
    title: "First",
    album: "Album",
    artist: "Artist",
    albumArtist: "Album Artist",
    trackNumber: 1,
    discNumber: 1,
    year: "2026-07",
  },
  nativeTags: [],
  scanError: null,
};

function track(
  id: string,
  changes: Partial<CatalogTrack["tags"]> = {},
): CatalogTrack {
  return {
    ...baseTrack,
    id,
    path: `/album/${id}.flac`,
    tags: { ...baseTrack.tags, ...changes },
  };
}

function album(tracks: readonly CatalogTrack[]): CatalogAlbum {
  return {
    id: "album-1",
    title: "Album",
    albumArtist: "Album Artist",
    tracks,
  };
}

describe("album data-quality diagnostics", () => {
  it("groups every diagnostic kind into deterministic issue filters", () => {
    const findings = diagnoseAlbum(
      album([
        track("unknown", {
          title: "Unknown title",
          album: "Unknown album",
          artist: "Unknown artist",
          trackNumber: null,
          year: null,
        }),
        track("duplicate-a", {
          trackNumber: 2,
          albumArtist: "Other Artist",
          year: "2025",
        }),
        track("duplicate-b", { trackNumber: 2, year: "2026" }),
        track("four", { trackNumber: 4, year: "2026" }),
      ]),
    );
    const kinds = (filter: AlbumDiagnosticFilter): string[] =>
      findings
        .filter((finding) => diagnosticMatchesFilter(finding, filter))
        .map((finding) => finding.kind);

    expect(kinds("numbering")).toEqual([
      "missing-track-number",
      "duplicate-track-number",
      "track-number-gap",
    ]);
    expect(kinds("consistency")).toEqual([
      "inconsistent-album-artist",
      "inconsistent-release-date",
    ]);
    expect(kinds("missing-tags")).toEqual([
      "missing-title",
      "placeholder-tags",
      "placeholder-tags",
      "missing-release-date",
    ]);
    expect(kinds("all")).toEqual(findings.map((finding) => finding.kind));
  });

  it("orders findings and affected tracks deterministically", () => {
    const input = album([
      track("z", {
        title: "Unknown title",
        trackNumber: null,
        year: "2026",
      }),
      track("a", {
        trackNumber: null,
        albumArtist: "Other Artist",
        year: "2026-07",
      }),
    ]);
    const reversed = album([...input.tracks].reverse());

    expect(diagnoseAlbum(input)).toEqual(diagnoseAlbum(reversed));
    expect(diagnoseAlbum(input).map((finding) => finding.kind)).toEqual([
      "missing-title",
      "missing-track-number",
      "inconsistent-album-artist",
      "inconsistent-release-date",
    ]);
    expect(diagnoseAlbum(input)[1]?.affectedTrackIds).toEqual(["a", "z"]);
  });

  it("reports missing and duplicate disc/track numbers", () => {
    const findings = diagnoseAlbum(
      album([
        track("missing", { trackNumber: null }),
        track("duplicate-a", { trackNumber: 2 }),
        track("duplicate-b", { trackNumber: 2 }),
      ]),
    );

    expect(
      findings.find((finding) => finding.kind === "missing-track-number")
        ?.affectedTrackIds,
    ).toEqual(["missing"]);
    expect(
      findings.find((finding) => finding.kind === "duplicate-track-number"),
    ).toMatchObject({
      id: "duplicate-track-number:1:2",
      affectedTrackIds: ["duplicate-a", "duplicate-b"],
      workflow: "sequence",
    });
  });

  it("keeps the same track number on different discs distinct", () => {
    const findings = diagnoseAlbum(
      album([
        track("disc-1", { discNumber: 1, trackNumber: 1 }),
        track("disc-2", { discNumber: 2, trackNumber: 1 }),
      ]),
    );

    expect(
      findings.some((finding) => finding.kind === "duplicate-track-number"),
    ).toBe(false);
  });

  it("reports internal gaps per disc without inventing a starting number", () => {
    const findings = diagnoseAlbum(
      album([
        track("two", { trackNumber: 2 }),
        track("four", { trackNumber: 4 }),
        track("disc-2", { discNumber: 2, trackNumber: 4 }),
      ]),
    );

    const gap = findings.find((finding) => finding.kind === "track-number-gap");
    expect(gap).toMatchObject({
      id: "track-number-gap:1",
      affectedTrackIds: ["two", "four"],
    });
    expect(gap?.explanation).toContain("“3” between 2 and 4");
  });

  it("reports mixed album artists and preserves distinct partial dates", () => {
    const findings = diagnoseAlbum(
      album([
        track("year", { albumArtist: "Artist A", year: "2026" }),
        track("month", { albumArtist: "Artist B", year: "2026-07" }),
        track("missing-date", { albumArtist: "Artist B", year: null }),
      ]),
    );

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "inconsistent-album-artist" }),
        expect.objectContaining({ kind: "missing-release-date" }),
        expect.objectContaining({
          kind: "inconsistent-release-date",
          explanation: expect.stringContaining("“2026”, “2026-07”") as string,
        }),
      ]),
    );
  });

  it("handles exact normalized placeholders without guessing values", () => {
    const findings = diagnoseAlbum(
      album([
        track("unknown", {
          title: "Unknown title",
          album: "Unknown album",
          artist: "Unknown artist",
          albumArtist: "Unknown artist",
          trackNumber: null,
          discNumber: null,
          year: null,
        }),
      ]),
    );

    expect(findings.map((finding) => finding.kind)).toEqual([
      "missing-title",
      "placeholder-tags",
      "placeholder-tags",
      "missing-track-number",
      "missing-release-date",
    ]);
    expect(
      findings.filter((finding) => finding.kind === "placeholder-tags"),
    ).toHaveLength(2);
    expect(findings[1]?.explanation).toContain(
      "exact “Unknown album” fallback",
    );
  });

  it("returns no findings for a consistently tagged album", () => {
    expect(
      diagnoseAlbum(
        album([
          track("one", { trackNumber: 1 }),
          track("two", { title: "Second", trackNumber: 2 }),
          track("three", { title: "Third", trackNumber: 3 }),
        ]),
      ),
    ).toEqual([]);
  });
});
