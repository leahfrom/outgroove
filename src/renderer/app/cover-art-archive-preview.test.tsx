// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CoverArtArchiveResultDto } from "../../shared/contracts/api";
import type { ComparedAlbumCandidate } from "../../shared/domain/album-identification";
import { CoverArtArchivePreview } from "./cover-art-archive-preview";

const candidate: ComparedAlbumCandidate = {
  releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
  releaseGroupId: "13a6d13b-f42a-49ba-8d54-893791d9f752",
  title: "A very long Fixture Album title",
  artistCredits: [],
  date: "2026-04-02",
  country: "DE",
  status: "Official",
  trackCount: 2,
  catalogNumbers: [],
  musicBrainzScore: 100,
  score: 90,
  confidence: "strong",
  matches: [],
  conflicts: [],
};

const result: CoverArtArchiveResultDto = {
  albumId: "adb9be31-d450-45f9-99de-c9c6143988ad",
  sent: { releaseId: candidate.releaseId },
  artwork: {
    id: "829521842",
    types: ["Front"],
    front: true,
    back: false,
    approved: true,
    comment: "Exact fixture edition with a deliberately long note",
    previewDataUrl: "data:image/png;base64,fixture",
    width: 500,
    height: 500,
    mimeType: "image/png",
    byteLength: 1024,
  },
  source: "network",
  fetchedAt: "2026-07-27T12:00:00.000Z",
  readOnly: true,
};

describe("CoverArtArchivePreview", () => {
  it("discloses the exact request and requires an explicit keyboard action", async () => {
    const user = userEvent.setup();
    const onLoad = vi.fn();
    render(
      <CoverArtArchivePreview
        candidate={candidate}
        error={undefined}
        loading={false}
        prepareError={undefined}
        preparing={false}
        result={undefined}
        onCancel={vi.fn()}
        onLoad={onLoad}
        onPrepare={vi.fn()}
      />,
    );
    const section = screen.getByRole("region", {
      name: `Cover Art Archive preview for ${candidate.title}`,
    });
    expect(section).toHaveTextContent(
      `sends only MusicBrainz release ID ${candidate.releaseId}`,
    );
    expect(section).toHaveTextContent(
      "Your audio, current artwork, tags, and file paths stay on this device",
    );
    expect(section).toHaveTextContent("Viewing the cover cannot change");
    const requestDetails = screen
      .getByText("Request details")
      .closest("details");
    if (!requestDetails) throw new Error("Request details missing");
    expect(requestDetails).not.toHaveAttribute("open");
    expect(screen.getByText(candidate.releaseId)).not.toBeVisible();
    await user.click(screen.getByText("Request details"));
    expect(screen.getByText(candidate.releaseId)).toBeVisible();
    expect(onLoad).not.toHaveBeenCalled();
    const button = screen.getByRole("button", {
      name: `Show front cover for ${candidate.title}, ${candidate.date}`,
    });
    button.focus();
    await user.keyboard("{Enter}");
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it("renders a safe thumbnail and requires a separate keyboard action to prepare the original", async () => {
    const user = userEvent.setup();
    const onPrepare = vi.fn();
    render(
      <CoverArtArchivePreview
        candidate={candidate}
        error={undefined}
        loading={false}
        prepareError={undefined}
        preparing={false}
        result={result}
        onCancel={vi.fn()}
        onLoad={vi.fn()}
        onPrepare={onPrepare}
      />,
    );
    const image = screen.getByRole("img", {
      name: `Cover Art Archive front cover for ${candidate.title}`,
    });
    expect(image).toHaveAttribute("src", result.artwork?.previewDataUrl);
    expect(screen.getByText("Front cover from this release")).toBeVisible();
    expect(screen.getByText(/Approved in MusicBrainz/u)).toBeVisible();
    expect(screen.getByText(/500 × 500 · 1 KiB/u)).toBeVisible();
    expect(screen.getByText(/Your Library is unchanged/u)).toBeVisible();
    expect(onPrepare).not.toHaveBeenCalled();
    const prepare = screen.getByRole("button", {
      name: `Use front cover from ${candidate.title}, ${candidate.date}`,
    });
    prepare.focus();
    await user.keyboard("{Enter}");
    expect(onPrepare).toHaveBeenCalledWith(result.artwork?.id);
    expect(
      screen.queryByRole("button", { name: /confirm|write now|apply/u }),
    ).not.toBeInTheDocument();
  });

  it("offers keyboard cancellation and reports missing or failed artwork without changing the Library", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = render(
      <CoverArtArchivePreview
        candidate={candidate}
        error={undefined}
        loading
        prepareError={undefined}
        preparing={false}
        result={undefined}
        onCancel={onCancel}
        onLoad={vi.fn()}
        onPrepare={vi.fn()}
      />,
    );
    const cancel = screen.getByRole("button", {
      name: "Cancel",
    });
    cancel.focus();
    await user.keyboard("{Enter}");
    expect(onCancel).toHaveBeenCalledOnce();

    rerender(
      <CoverArtArchivePreview
        candidate={candidate}
        error="Cover Art Archive is unavailable."
        loading={false}
        prepareError={undefined}
        preparing={false}
        result={undefined}
        onCancel={onCancel}
        onLoad={vi.fn()}
        onPrepare={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Cover request failed: Cover Art Archive is unavailable.",
    );

    rerender(
      <CoverArtArchivePreview
        candidate={candidate}
        error={undefined}
        loading={false}
        prepareError={undefined}
        preparing={false}
        result={{ ...result, artwork: null }}
        onCancel={onCancel}
        onLoad={vi.fn()}
        onPrepare={vi.fn()}
      />,
    );
    expect(screen.getByText(/No front cover is available/u)).toHaveTextContent(
      "Your Library is unchanged",
    );
  });
});
