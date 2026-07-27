import { describe, expect, it } from "vitest";

import {
  changedTrackTags,
  isValidPartialDate,
  normalizeTrackTagChanges,
  validateTrackTagRelationships,
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
        trackTotal: 12,
        discTotal: null,
        year: null,
        genres: ["  Post   Rock  "],
        composers: ["  Fixture   Composer  "],
        conductors: ["  Fixture   Conductor  "],
      }),
    ).toEqual({
      title: "Ä track",
      trackNumber: null,
      trackTotal: 12,
      discTotal: null,
      year: null,
      genres: ["Post Rock"],
      composers: ["Fixture Composer"],
      conductors: ["Fixture Conductor"],
    });
    expect(() => normalizeTrackTagChanges({ title: "   " })).toThrow(
      "title cannot be empty",
    );
    expect(() => normalizeTrackTagChanges({ discNumber: 0 })).toThrow(
      "discNumber must be between",
    );
    expect(() => normalizeTrackTagChanges({ trackTotal: 10_000 })).toThrow(
      "trackTotal must be between",
    );
    expect(() => normalizeTrackTagChanges({ discTotal: 0 })).toThrow(
      "discTotal must be between",
    );
    expect(() => normalizeTrackTagChanges({})).toThrow("Choose at least one");
    expect(() =>
      normalizeTrackTagChanges({ genres: ["Rock", "Metal"] }),
    ).toThrow("one proposed genre value");
    expect(() =>
      normalizeTrackTagChanges({
        composers: ["First Composer", "Second Composer"],
      }),
    ).toThrow("one proposed composer value");
    expect(() =>
      normalizeTrackTagChanges({
        conductors: ["First Conductor", "Second Conductor"],
      }),
    ).toThrow("one proposed conductor value");
  });

  it("validates explicit number and total relationships without correcting values", () => {
    const before = {
      title: "Track",
      album: "Album",
      artist: "Artist",
      albumArtist: "Artist",
      trackNumber: 3,
      trackTotal: 12,
      discNumber: 1,
      discTotal: 2,
      year: null,
      genres: [],
      composers: [],
    };
    expect(() =>
      validateTrackTagRelationships(before, { trackTotal: 2 }),
    ).toThrow("Track number 3 cannot exceed track total 2");
    expect(() =>
      validateTrackTagRelationships(before, { discNumber: 3 }),
    ).toThrow("Disc number 3 cannot exceed disc total 2");
    expect(() =>
      validateTrackTagRelationships(
        { ...before, trackNumber: null },
        { trackTotal: 12 },
      ),
    ).toThrow("Track total requires a track number");
    expect(() =>
      validateTrackTagRelationships(before, {
        trackNumber: 7,
        trackTotal: 7,
        discTotal: null,
      }),
    ).not.toThrow();
    expect(() =>
      validateTrackTagRelationships(before, { artist: "Other Artist" }),
    ).not.toThrow();
  });

  it("removes unchanged scalar and genre values from a proposal", () => {
    const before = {
      title: "Track",
      album: "Album",
      artist: "Artist",
      albumArtist: "Album Artist",
      trackNumber: 1,
      discNumber: 1,
      year: "2026",
      genres: ["Post Rock"],
      composers: ["Fixture Composer"],
      conductors: ["Fixture Conductor"],
    };
    expect(
      changedTrackTags(before, {
        title: "Track",
        artist: "New Artist",
        year: "2026",
        genres: ["Post Rock"],
        composers: ["Fixture Composer"],
        conductors: ["Fixture Conductor"],
      }),
    ).toEqual({ artist: "New Artist" });
    expect(changedTrackTags(before, { genres: [] })).toEqual({ genres: [] });
    expect(changedTrackTags(before, { composers: [] })).toEqual({
      composers: [],
    });
    expect(changedTrackTags(before, { conductors: [] })).toEqual({
      conductors: [],
    });
  });
});
