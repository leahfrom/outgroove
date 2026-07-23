// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import { TrackOrderEditor } from "./track-order-editor";

const firstTrack: CatalogAlbum["tracks"][number] = {
  id: "d3a52a1d-f00b-46d8-ac01-e848675a2139",
  path: "/fixture/a/very/long/folder/First Track.mp3",
  size: 100,
  modifiedMs: 1,
  format: "MPEG",
  durationSeconds: 1,
  tags: {
    title: "First Track",
    album: "Fixture Album",
    artist: "Fixture Artist",
    albumArtist: "Fixture Artist",
    trackNumber: null,
    discNumber: null,
    year: "2026",
  },
  nativeTags: [],
  scanError: null,
};

const secondTrack: CatalogAlbum["tracks"][number] = {
  ...firstTrack,
  id: "c878d5df-f462-45ec-a4b1-84623fd525b3",
  path: "/fixture/a/Second Track.flac",
  format: "FLAC",
  tags: {
    ...firstTrack.tags,
    title: "Second Track",
    trackNumber: 2,
    discNumber: 1,
  },
};

function editor({
  tracks = [firstTrack, secondTrack],
  startDraft = "7",
  discEnabled = false,
  discDraft = "1",
  onMove = vi.fn(),
  onPreview = vi.fn(),
}: {
  tracks?: readonly CatalogAlbum["tracks"][number][];
  startDraft?: string;
  discEnabled?: boolean;
  discDraft?: string;
  onMove?: (fileId: string, offset: -1 | 1) => void;
  onPreview?: () => void;
} = {}) {
  return (
    <TrackOrderEditor
      busy={false}
      discDraft={discDraft}
      discEnabled={discEnabled}
      onCancelPreview={vi.fn()}
      onConfirm={vi.fn()}
      onDiscChange={vi.fn()}
      onDiscEnabledChange={vi.fn()}
      onMove={onMove}
      onPreview={onPreview}
      onStartChange={vi.fn()}
      preview={undefined}
      result={undefined}
      startDraft={startDraft}
      tracks={tracks}
    />
  );
}

describe("TrackOrderEditor", () => {
  it("compares missing and existing numbers with the proposed sequence", () => {
    render(editor({ discEnabled: true, discDraft: "3" }));

    const firstRow = screen.getByLabelText(
      "Sequence comparison for First Track",
    );
    expect(firstRow).toHaveTextContent("Track Not set · Disc Not set");
    expect(firstRow).toHaveTextContent("Track 7 · Disc 3");
    expect(within(firstRow).getByText("Changed")).toBeVisible();
    expect(firstRow).toHaveTextContent(firstTrack.path);

    const secondRow = screen.getByLabelText(
      "Sequence comparison for Second Track",
    );
    expect(secondRow).toHaveTextContent("Track 2 · Disc 1");
    expect(secondRow).toHaveTextContent("Track 8 · Disc 3");
    expect(
      screen.getByText("2 of 2 selected tracks differ from this draft."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Preview track-number sequence" }),
    ).toBeEnabled();
  });

  it("supports keyboard reordering and blocks invalid overflow", async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    const { rerender } = render(editor({ onMove }));

    const moveSecondUp = screen.getByRole("button", {
      name: "Move Second Track up",
    });
    moveSecondUp.focus();
    await user.keyboard("{Enter}");
    expect(onMove).toHaveBeenCalledWith(secondTrack.id, -1);

    rerender(editor({ onMove, startDraft: "9999" }));
    expect(screen.getByLabelText("Starting track number")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.getByText("The resulting track number would exceed 9999."),
    ).toBeVisible();
    expect(screen.getAllByText("Invalid")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Preview track-number sequence" }),
    ).toBeDisabled();
  });

  it("labels an unchanged draft and does not request a no-op preview", async () => {
    const onPreview = vi.fn();
    const user = userEvent.setup();
    const numberedFirst = {
      ...firstTrack,
      tags: { ...firstTrack.tags, trackNumber: 1 },
    };
    render(
      editor({
        tracks: [numberedFirst, secondTrack],
        startDraft: "1",
        onPreview,
      }),
    );

    expect(screen.getAllByText("Unchanged")).toHaveLength(2);
    expect(
      screen.getByText("Every selected track already has this sequence."),
    ).toBeVisible();
    const preview = screen.getByRole("button", {
      name: "Preview track-number sequence",
    });
    expect(preview).toBeDisabled();
    await user.click(preview);
    expect(onPreview).not.toHaveBeenCalled();
  });
});
