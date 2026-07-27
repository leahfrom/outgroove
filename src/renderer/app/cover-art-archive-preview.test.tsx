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
        result={undefined}
        onCancel={vi.fn()}
        onLoad={onLoad}
      />,
    );
    const section = screen.getByRole("region", {
      name: `Cover Art Archive preview for ${candidate.title}`,
    });
    expect(section).toHaveTextContent(
      `sends only MusicBrainz release ID ${candidate.releaseId}`,
    );
    expect(section).toHaveTextContent(
      "never sends audio, current artwork, tags, or file paths",
    );
    expect(section).toHaveTextContent(
      "cannot preview or start an artwork write",
    );
    expect(onLoad).not.toHaveBeenCalled();
    const button = screen.getByRole("button", {
      name: `Load Cover Art Archive front cover for ${candidate.title}, ${candidate.date}`,
    });
    button.focus();
    await user.keyboard("{Enter}");
    expect(onLoad).toHaveBeenCalledOnce();
  });

  it("renders only a safe read-only preview with accessible artwork text", () => {
    render(
      <CoverArtArchivePreview
        candidate={candidate}
        error={undefined}
        loading={false}
        result={result}
        onCancel={vi.fn()}
        onLoad={vi.fn()}
      />,
    );
    const image = screen.getByRole("img", {
      name: `Cover Art Archive front cover for ${candidate.title}`,
    });
    expect(image).toHaveAttribute("src", result.artwork?.previewDataUrl);
    expect(screen.getByText("Read-only release front cover")).toBeVisible();
    expect(screen.getByText(/Approved in MusicBrainz/u)).toBeVisible();
    expect(screen.getByText(/500 × 500 · 1 KiB/u)).toBeVisible();
    expect(screen.getByText(/No Library artwork changed/u)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /apply|write|replace|remove/u }),
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
        result={undefined}
        onCancel={onCancel}
        onLoad={vi.fn()}
      />,
    );
    const cancel = screen.getByRole("button", {
      name: "Cancel cover request",
    });
    cancel.focus();
    await user.keyboard("{Enter}");
    expect(onCancel).toHaveBeenCalledOnce();

    rerender(
      <CoverArtArchivePreview
        candidate={candidate}
        error="Cover Art Archive is unavailable."
        loading={false}
        result={undefined}
        onCancel={onCancel}
        onLoad={vi.fn()}
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
        result={{ ...result, artwork: null }}
        onCancel={onCancel}
        onLoad={vi.fn()}
      />,
    );
    expect(screen.getByText(/No front cover is indexed/u)).toHaveTextContent(
      "Library artwork remains unchanged",
    );
  });
});
