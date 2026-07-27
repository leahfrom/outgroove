// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { MusicBrainzReleaseTracklistDto } from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import { MusicBrainzTrackMapper } from "./musicbrainz-track-mapper";

const album: CatalogAlbum = {
  id: "adb9be31-d450-45f9-99de-c9c6143988ad",
  title: "Fixture Album",
  albumArtist: "Fixture Artist",
  tracks: [
    {
      id: "73b6d616-0f52-4ef3-b71a-ffb42844e306",
      path: "/preview/01-first.mp3",
      size: 1,
      modifiedMs: 1,
      format: "MP3",
      durationSeconds: 61,
      tags: {
        title: "Local First",
        album: "Fixture Album",
        artist: "Local Artist",
        albumArtist: "Fixture Artist",
        trackNumber: 1,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [],
      scanError: null,
    },
    {
      id: "48b1c12e-eb56-42e4-a780-f305c13ab630",
      path: "/preview/02-second.flac",
      size: 1,
      modifiedMs: 1,
      format: "FLAC",
      durationSeconds: 62,
      tags: {
        title: "Local Second",
        album: "Fixture Album",
        artist: "Local Artist",
        albumArtist: "Fixture Artist",
        trackNumber: 2,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [],
      scanError: null,
    },
  ],
};

const releaseResult: MusicBrainzReleaseTracklistDto = {
  albumId: album.id,
  source: "network",
  fetchedAt: "2026-07-27T12:00:00.000Z",
  readOnly: true,
  release: {
    releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
    title: "Fixture Album",
    tracks: [
      {
        releaseTrackId: "11111111-1111-4111-8111-111111111111",
        recordingId: "22222222-2222-4222-8222-222222222222",
        discNumber: 1,
        discTotal: 2,
        trackNumber: 1,
        trackTotal: 1,
        title: "Remote First",
        artistCredits: [
          {
            name: "Remote Artist",
            joinPhrase: "",
            artistId: "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
          },
        ],
        isrcs: ["DEABC2600001"],
        lengthMs: 61_000,
      },
      {
        releaseTrackId: "33333333-3333-4333-8333-333333333333",
        recordingId: "44444444-4444-4444-8444-444444444444",
        discNumber: 2,
        discTotal: 2,
        trackNumber: 1,
        trackTotal: 1,
        title: "Remote Second",
        artistCredits: [],
        isrcs: ["DEABC2600002", "DEABC2600003"],
        lengthMs: null,
      },
    ],
  },
};

const defaultProps = {
  album,
  busy: false,
  error: undefined,
  preview: undefined,
  releaseResult,
  result: undefined,
  onCancelPreview: vi.fn(),
  onConfirm: vi.fn(),
  onPreview: vi.fn(),
};

describe("MusicBrainzTrackMapper", () => {
  it("invalidates an older exact preview when its field draft changes", async () => {
    const user = userEvent.setup();
    const onCancelPreview = vi.fn();
    render(
      <MusicBrainzTrackMapper
        {...defaultProps}
        onCancelPreview={onCancelPreview}
        preview={{
          operationId: "57b1e44b-e00a-4daa-bd6f-985472166116",
          confirmationToken: "mapping-confirmation-token",
          files: [],
        }}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: /Track title/u }));
    expect(onCancelPreview).toHaveBeenCalledOnce();
  });

  it("starts with no inferred mapping or fields and routes only explicit effective proposals", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    render(<MusicBrainzTrackMapper {...defaultProps} onPreview={onPreview} />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading changed no Library metadata",
    );
    expect(
      screen.getByRole("button", { name: "Preview mapped tracks" }),
    ).toBeDisabled();
    expect(screen.getByText(/0 of 2 Library tracks mapped/u)).toBeVisible();

    const first = screen.getByRole("combobox", {
      name: "MusicBrainz track for Local First",
    });
    await user.selectOptions(first, "11111111-1111-4111-8111-111111111111");
    expect(screen.getByText(/Mapped; select fields/u)).toBeVisible();
    expect(onPreview).not.toHaveBeenCalled();

    await user.click(screen.getByRole("checkbox", { name: /Track title/u }));
    expect(screen.getByText("1 effective tag changes")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Preview mapped tracks" }),
    );
    expect(onPreview).toHaveBeenCalledWith([
      {
        fileId: album.tracks[0]?.id,
        releaseTrackId: "11111111-1111-4111-8111-111111111111",
        changes: { title: "Remote First" },
      },
    ]);
  });

  it("keeps advanced fields collapsed, prevents duplicate remote choices, and exposes omissions", async () => {
    const user = userEvent.setup();
    render(<MusicBrainzTrackMapper {...defaultProps} />);
    const more = screen.getByText("More fields").closest("details");
    expect(more).not.toHaveAttribute("open");
    await user.click(screen.getByText("More fields"));
    await user.click(screen.getByRole("checkbox", { name: /^ISRC/u }));

    const first = screen.getByRole("combobox", {
      name: "MusicBrainz track for Local First",
    });
    const second = screen.getByRole("combobox", {
      name: "MusicBrainz track for Local Second",
    });
    await user.selectOptions(first, "11111111-1111-4111-8111-111111111111");
    expect(
      within(second).getByRole("option", {
        name: /Remote First/u,
      }),
    ).toBeDisabled();
    await user.selectOptions(second, "33333333-3333-4333-8333-333333333333");
    expect(screen.getByText(/recording has multiple values/u)).toBeVisible();
  });
});
