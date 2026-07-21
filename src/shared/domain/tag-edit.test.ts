import { describe, expect, it } from "vitest";

import {
  changedTrackTags,
  isValidPartialDate,
  normalizeTrackTagChanges,
} from "./tag-edit";

describe("track metadata validation", () => {
  it.each([
    ["2026", true],
    ["2026-02", true],
    ["2024-02-29", true],
    ["2025-02-29", false],
    ["2026-13", false],
    ["2026-04-31", false],
    ["26", false],
  ])("validates partial date %s", (value, valid) => {
    expect(isValidPartialDate(value)).toBe(valid);
  });

  it("normalizes text, permits clearing optional fields, and rejects unsafe values", () => {
    expect(
      normalizeTrackTagChanges({
        title: "  A\u0308   track  ",
        trackNumber: null,
        year: null,
      }),
    ).toEqual({ title: "Ä track", trackNumber: null, year: null });
    expect(() => normalizeTrackTagChanges({ title: "   " })).toThrow(
      "title cannot be empty",
    );
    expect(() => normalizeTrackTagChanges({ discNumber: 0 })).toThrow(
      "discNumber must be between",
    );
    expect(() => normalizeTrackTagChanges({})).toThrow("Choose at least one");
  });

  it("removes unchanged values from a proposal", () => {
    const before = {
      title: "Track",
      album: "Album",
      artist: "Artist",
      albumArtist: "Album Artist",
      trackNumber: 1,
      discNumber: 1,
      year: "2026",
    };
    expect(
      changedTrackTags(before, {
        title: "Track",
        artist: "New Artist",
        year: "2026",
      }),
    ).toEqual({ artist: "New Artist" });
  });
});
