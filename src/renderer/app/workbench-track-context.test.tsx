// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import { WorkbenchTrackContext } from "./workbench-track-context";

const firstTrack: CatalogAlbum["tracks"][number] = {
  id: "d3a52a1d-f00b-46d8-ac01-e848675a2139",
  path: "/fixture/a/very/long/folder/First Track.mp3",
  size: 100,
  modifiedMs: 1,
  format: "MPEG",
  durationSeconds: 61,
  codec: "MPEG 1 Layer 3",
  bitrate: 128_000,
  sampleRate: 44_100,
  bitDepth: null,
  channels: 2,
  tags: {
    title: "First Track",
    album: "Fixture Album",
    artist: "Fixture Artist",
    albumArtist: "Fixture Artist",
    trackNumber: 1,
    discNumber: 1,
    year: "2026",
  },
  nativeTags: [{ id: "ID3v2:TALB", value: "Fixture Album" }],
  scanError: null,
};

const tracks: readonly CatalogAlbum["tracks"][number][] = [
  firstTrack,
  {
    ...firstTrack,
    id: "c878d5df-f462-45ec-a4b1-84623fd525b3",
    path: "/fixture/Second.flac",
    tags: { ...firstTrack.tags, title: "Second", trackNumber: 2 },
  },
  {
    ...firstTrack,
    id: "b9b669f0-5996-4365-b2ec-9f1348bedaf5",
    path: "/fixture/Third.flac",
    tags: { ...firstTrack.tags, title: "Third", trackNumber: 3 },
  },
  {
    ...firstTrack,
    id: "e97b14d0-60fa-4b01-b2a7-33dfa51bc2c3",
    path: "/fixture/Fourth.flac",
    tags: { ...firstTrack.tags, title: "Fourth", trackNumber: 4 },
  },
];

function context({
  selectedTrackIds = [],
  onSelectAll = vi.fn(),
  onClearSelection = vi.fn(),
  onToggleTrack = vi.fn(),
  onEditTrack = vi.fn(),
}: {
  selectedTrackIds?: readonly string[];
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onToggleTrack?: (fileId: string) => void;
  onEditTrack?: (track: CatalogAlbum["tracks"][number]) => void;
} = {}) {
  return (
    <WorkbenchTrackContext
      busy={false}
      selectedTrackIds={selectedTrackIds}
      selectionPurpose="shared-field editing"
      tracks={tracks}
      onClearSelection={onClearSelection}
      onEditTrack={onEditTrack}
      onSelectAll={onSelectAll}
      onToggleTrack={onToggleTrack}
    />
  );
}

describe("WorkbenchTrackContext", () => {
  it("opens the chooser for an empty selection and collapses it after Select all", async () => {
    const user = userEvent.setup();
    const onSelectAll = vi.fn();
    const onClearSelection = vi.fn();
    const { rerender } = render(context({ onClearSelection, onSelectAll }));

    const chooserSummary = screen.getByText("Choose or inspect tracks");
    const chooser = chooserSummary.closest("details");
    if (!chooser) throw new Error("Track chooser missing");
    expect(chooser).toHaveAttribute("open");
    expect(
      screen.getByRole("checkbox", {
        name: "Select First Track for shared-field editing",
      }),
    ).toBeVisible();

    const selectAll = screen.getByRole("button", {
      name: "Select all tracks",
    });
    selectAll.focus();
    await user.keyboard("{Enter}");
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(selectAll).toHaveFocus();
    expect(chooser).not.toHaveAttribute("open");

    rerender(
      context({
        onClearSelection,
        selectedTrackIds: tracks.map((track) => track.id),
        onSelectAll,
      }),
    );
    const selectedNames = screen.getByRole("list", {
      name: "Selected track names",
    });
    expect(within(selectedNames).getByText("First Track")).toBeVisible();
    expect(within(selectedNames).getByText("Second")).toBeVisible();
    expect(within(selectedNames).getByText("Third")).toBeVisible();
    expect(within(selectedNames).getByText("+1 more track")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(onClearSelection).toHaveBeenCalledTimes(1);
    expect(chooser).toHaveAttribute("open");
  });

  it("keeps selection and technical inspection keyboard accessible", async () => {
    const user = userEvent.setup();
    const onToggleTrack = vi.fn();
    const onEditTrack = vi.fn();
    render(context({ onEditTrack, onToggleTrack }));

    const firstCheckbox = screen.getByRole("checkbox", {
      name: "Select First Track for shared-field editing",
    });
    firstCheckbox.focus();
    await user.keyboard(" ");
    expect(onToggleTrack).toHaveBeenCalledWith(firstTrack.id);

    const edit = screen.getByRole("button", {
      name: "Edit metadata for First Track",
    });
    edit.focus();
    await user.keyboard("{Enter}");
    expect(onEditTrack).toHaveBeenCalledWith(firstTrack);

    const technicalSummary = screen.getByText("Inspect file and tag details");
    const technical = technicalSummary.closest("details");
    if (!technical) throw new Error("Technical disclosure missing");
    expect(technical).not.toHaveAttribute("open");
    technicalSummary.focus();
    expect(technicalSummary).toHaveFocus();
    await user.click(technicalSummary);
    expect(technical).toHaveAttribute("open");
    expect(within(technical).getByText("1.1 First Track")).toBeVisible();
  });
});
