import { describe, expect, it } from "vitest";

import {
  musicBrainzReleaseLookupRequestSchema,
  musicBrainzTrackMappingPreviewRequestSchema,
} from "./api";

const valid = {
  albumId: "adb9be31-d450-45f9-99de-c9c6143988ad",
  releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
  edits: [
    {
      fileId: "73b6d616-0f52-4ef3-b71a-ffb42844e306",
      releaseTrackId: "11111111-1111-4111-8111-111111111111",
      changes: {
        title: "Mapped title",
        trackNumber: 1,
        trackTotal: 12,
      },
    },
  ],
};

describe("MusicBrainz track mapping IPC contracts", () => {
  it("accepts only narrow release and supported mapped-tag requests", () => {
    expect(
      musicBrainzReleaseLookupRequestSchema.parse({
        albumId: valid.albumId,
        releaseId: valid.releaseId,
      }),
    ).toEqual({ albumId: valid.albumId, releaseId: valid.releaseId });
    expect(musicBrainzTrackMappingPreviewRequestSchema.parse(valid)).toEqual(
      valid,
    );
  });

  it("rejects unsupported, duplicate, empty, and out-of-bounds proposals", () => {
    expect(
      musicBrainzTrackMappingPreviewRequestSchema.safeParse({
        ...valid,
        edits: [
          {
            ...valid.edits[0],
            changes: { album: "Not supported" },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      musicBrainzTrackMappingPreviewRequestSchema.safeParse({
        ...valid,
        edits: [valid.edits[0], valid.edits[0]],
      }).success,
    ).toBe(false);
    expect(
      musicBrainzTrackMappingPreviewRequestSchema.safeParse({
        ...valid,
        edits: [{ ...valid.edits[0], changes: {} }],
      }).success,
    ).toBe(false);
    expect(
      musicBrainzTrackMappingPreviewRequestSchema.safeParse({
        ...valid,
        edits: [
          {
            ...valid.edits[0],
            changes: { trackTotal: 10_000 },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
