// @vitest-environment jsdom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
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
  it("keeps technical facts read-only and progressively discloses native tags", async () => {
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
    expect(dialog).toHaveTextContent("MPEG 1 Layer 3");
    expect(dialog).toHaveTextContent("128 kbps");
    expect(dialog).toHaveTextContent(track.path);
    const nativeTags = screen.getByLabelText("Native track tags");
    expect(nativeTags).not.toBeVisible();
    expect(
      screen.queryByRole("button", { name: /write|confirm|review/u }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText("Native tags"));
    expect(nativeTags).toBeVisible();
    expect(nativeTags).toHaveTextContent("ID3v2:TALB");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
