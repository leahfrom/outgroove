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
        lyricists: ["  Fixture   Lyricist  "],
        isrcs: ["  DEABC2600001  "],
        copyright: "  Copyright   Fixture  ",
        comment: "  First line\r\nSecond line  ",
        originalReleaseDate: "  2020-03  ",
        language: "  deu  ",
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
      lyricists: ["Fixture Lyricist"],
      isrcs: ["DEABC2600001"],
      copyright: "Copyright Fixture",
      comment: "First line\nSecond line",
      originalReleaseDate: "2020-03",
      language: "deu",
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
    expect(() =>
      normalizeTrackTagChanges({
        lyricists: ["First Lyricist", "Second Lyricist"],
      }),
    ).toThrow("one proposed lyricist value");
    expect(() =>
      normalizeTrackTagChanges({
        isrcs: ["DEABC2600001", "DEABC2600002"],
      }),
    ).toThrow("one proposed ISRC");
    expect(normalizeTrackTagChanges({ copyright: "" })).toEqual({
      copyright: null,
    });
    expect(() =>
      normalizeTrackTagChanges({ lyricists: ["L".repeat(401)] }),
    ).toThrow("lyricist is too long");
    expect(() =>
      normalizeTrackTagChanges({ isrcs: ["I".repeat(101)] }),
    ).toThrow("ISRC is too long");
    expect(() =>
      normalizeTrackTagChanges({ copyright: "C".repeat(1001) }),
    ).toThrow("copyright is too long");
    expect(normalizeTrackTagChanges({ comment: "" })).toEqual({
      comment: null,
    });
    expect(() =>
      normalizeTrackTagChanges({ comment: "C".repeat(4001) }),
    ).toThrow("comment is too long");
    expect(() =>
      normalizeTrackTagChanges({ originalReleaseDate: "2020-13" }),
    ).toThrow("original release date must be YYYY");
    expect(() =>
      normalizeTrackTagChanges({ language: "L".repeat(101) }),
    ).toThrow("language is too long");
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

  it("normalizes completed catalog fields and enforces bounded, lossless proposals", () => {
    expect(
      normalizeTrackTagChanges({
        publishers: ["  Example   Label "],
        descriptions: ["  Liner   note "],
        grouping: "  Suite   One ",
        catalogNumbers: [" OUT-42 "],
        publishingDate: " 2024-08 ",
        bpm: 128,
        compilation: true,
        musicBrainzRecordingId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
        musicBrainzReleaseTrackId: null,
        musicBrainzReleaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        musicBrainzArtistIds: ["CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC"],
        musicBrainzReleaseArtistIds: [],
        musicBrainzReleaseGroupId: null,
        musicBrainzWorkId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      }),
    ).toEqual({
      publishers: ["Example Label"],
      descriptions: ["Liner note"],
      grouping: "Suite One",
      catalogNumbers: ["OUT-42"],
      publishingDate: "2024-08",
      bpm: 128,
      compilation: true,
      musicBrainzRecordingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      musicBrainzReleaseTrackId: null,
      musicBrainzReleaseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      musicBrainzArtistIds: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"],
      musicBrainzReleaseArtistIds: [],
      musicBrainzReleaseGroupId: null,
      musicBrainzWorkId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    expect(() => normalizeTrackTagChanges({ bpm: 0 })).toThrow(
      "BPM must be between 1 and 999",
    );
    expect(() => normalizeTrackTagChanges({ bpm: 1000 })).toThrow(
      "BPM must be between 1 and 999",
    );
    expect(() =>
      normalizeTrackTagChanges({ publishingDate: "2024-02-30" }),
    ).toThrow("publishing date must be YYYY");
    expect(() =>
      normalizeTrackTagChanges({ publishers: ["One", "Two"] }),
    ).toThrow("one proposed publisher");
    expect(() =>
      normalizeTrackTagChanges({
        musicBrainzRecordingId: "not-a-musicbrainz-id",
      }),
    ).toThrow("valid MusicBrainz UUID");
    expect(() =>
      normalizeTrackTagChanges({
        musicBrainzArtistIds: [
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ],
      }),
    ).toThrow("one proposed musicBrainzArtistIds");
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
      lyricists: ["Fixture Lyricist"],
      isrcs: ["DEABC2600001"],
      copyright: "Copyright Fixture",
    };
    expect(
      changedTrackTags(before, {
        title: "Track",
        artist: "New Artist",
        year: "2026",
        genres: ["Post Rock"],
        composers: ["Fixture Composer"],
        conductors: ["Fixture Conductor"],
        lyricists: ["Fixture Lyricist"],
        isrcs: ["DEABC2600001"],
        copyright: "Copyright Fixture",
      }),
    ).toEqual({ artist: "New Artist" });
    expect(changedTrackTags(before, { genres: [] })).toEqual({ genres: [] });
    expect(changedTrackTags(before, { composers: [] })).toEqual({
      composers: [],
    });
    expect(changedTrackTags(before, { conductors: [] })).toEqual({
      conductors: [],
    });
    expect(changedTrackTags(before, { lyricists: [] })).toEqual({
      lyricists: [],
    });
    expect(changedTrackTags(before, { isrcs: [] })).toEqual({ isrcs: [] });
    expect(changedTrackTags(before, { copyright: null })).toEqual({
      copyright: null,
    });
  });
});
