// @vitest-environment jsdom
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import { TrackTechnicalInfo } from "./track-technical-info";

const track: CatalogAlbum["tracks"][number] = {
  id: "d3a52a1d-f00b-46d8-ac01-e848675a2139",
  path: "/fixture/a/very/long/folder/Fixture Track.mp3",
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
    albumArtist: "Fixture Album Artist",
    trackNumber: 1,
    discNumber: 1,
    year: "2026-07",
  },
  nativeTags: [{ id: "ID3v2:TALB", value: "Fixture Album" }],
  scanError: null,
};

function Harness(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Show track information</button>
      {open && (
        <TrackTechnicalInfo onClose={() => setOpen(false)} track={track} />
      )}
    </>
  );
}

describe("TrackTechnicalInfo", () => {
  it("explains Outgroove's tag view and progressively discloses original file tags", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", {
      name: "Show track information",
    });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", {
      name: "More information about Fixture Track",
    });
    expect(dialog).toHaveFocus();
    expect(dialog).toHaveTextContent("Track information");
    const identity = dialog.querySelector(".technical-info-heading");
    if (!(identity instanceof HTMLElement))
      throw new Error("Track identity missing");
    expect(
      within(identity).getByRole("heading", { name: "Fixture Track" }),
    ).toBeVisible();
    expect(within(identity).getByText("Fixture Artist")).toBeVisible();
    expect(within(identity).getByText("From Fixture Album")).toBeVisible();
    expect(dialog).toHaveTextContent("MPEG 1 Layer 3");
    expect(dialog).toHaveTextContent("128 kbps");
    expect(dialog).toHaveTextContent(track.path);
    expect(dialog).toHaveTextContent("How Outgroove reads the tags");
    const originalTags = screen.getByLabelText("Original file tags");
    expect(originalTags).not.toBeVisible();
    expect(
      screen.queryByRole("button", { name: /write|confirm|review/u }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText("Original file tag details"));
    expect(originalTags).toBeVisible();
    expect(originalTags).toHaveTextContent("ID3v2:TALB");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
