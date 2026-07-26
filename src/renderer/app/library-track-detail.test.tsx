// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import { LibraryTrackDetail } from "./library-track-detail";

const track: CatalogAlbum["tracks"][number] = {
  id: "d3a52a1d-f00b-46d8-ac01-e848675a2139",
  path: "/fixture/track.mp3",
  size: 100,
  modifiedMs: 1,
  format: "MPEG",
  durationSeconds: 1,
  codec: "MPEG 1 Layer 3",
  bitrate: 128_000,
  sampleRate: 44_100,
  bitDepth: null,
  channels: 2,
  tags: {
    title: "Fixture Track",
    album: "Fixture Album",
    artist: "Fixture Artist",
    albumArtist: "Fixture Artist",
    trackNumber: 1,
    discNumber: 1,
    year: "2026",
  },
  nativeTags: [],
  scanError: null,
};

function trackRow(onEdit = vi.fn(), onMoreInfo = vi.fn()) {
  return {
    onEdit,
    onMoreInfo,
    view: render(
      <LibraryTrackDetail
        busy={false}
        mode="library"
        onEdit={onEdit}
        onMoreInfo={onMoreInfo}
        onToggleBatch={vi.fn()}
        selectedForBatch={false}
        selectionPurpose="shared metadata"
        track={track}
      />,
    ),
  };
}

describe("LibraryTrackDetail", () => {
  it("activates editing directly without opening technical information", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onMoreInfo = vi.fn();
    trackRow(onEdit, onMoreInfo);

    const activation = screen.getByRole("button", {
      name: "Edit metadata for Fixture Track",
    });
    activation.focus();
    await user.keyboard("{Enter}");

    expect(onEdit).toHaveBeenCalledOnce();
    expect(onMoreInfo).not.toHaveBeenCalled();
  });

  it("supports More, arrow-key movement, Escape, and focus restoration", async () => {
    const user = userEvent.setup();
    const onMoreInfo = vi.fn();
    trackRow(vi.fn(), onMoreInfo);

    const more = screen.getByRole("button", {
      name: "More actions for Fixture Track",
    });
    await user.click(more);
    const editItem = screen.getByRole("menuitem", { name: "Edit metadata" });
    const infoItem = screen.getByRole("menuitem", { name: "More info" });
    expect(editItem).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(infoItem).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(more).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(more);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onMoreInfo).toHaveBeenCalledOnce();
    expect(more).toHaveFocus();
  });

  it("opens the same action menu for right-click and Shift+F10", async () => {
    const user = userEvent.setup();
    const { view } = trackRow();
    const activation = screen.getByRole("button", {
      name: "Edit metadata for Fixture Track",
    });
    const row = view.container.querySelector(".library-track-row");
    if (!(row instanceof HTMLElement)) throw new Error("Track row missing");

    fireEvent.contextMenu(row, { clientX: 120, clientY: 80 });
    const pointerMenu = screen.getByRole("menu", {
      name: "Actions for Fixture Track",
    });
    expect(pointerMenu).toBeVisible();
    expect(pointerMenu).toHaveStyle({ left: "120px", top: "80px" });
    await user.keyboard("{Escape}");

    activation.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(
      screen.getByRole("menu", { name: "Actions for Fixture Track" }),
    ).toBeVisible();
    expect(
      screen.getByRole("menuitem", { name: "Edit metadata" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
