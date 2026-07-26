// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TrackTagEditPreviewDto } from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import {
  TrackMetadataEditor,
  type TrackMetadataDraft,
} from "./track-metadata-editor";

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
  nativeTags: [],
  scanError: null,
};

const unchangedDraft: TrackMetadataDraft = {
  title: track.tags.title,
  artist: track.tags.artist,
  albumArtist: track.tags.albumArtist,
  trackNumber: String(track.tags.trackNumber),
  discNumber: String(track.tags.discNumber),
  year: track.tags.year ?? "",
};

function editor(
  draft: TrackMetadataDraft,
  preview?: TrackTagEditPreviewDto,
  error?: string,
) {
  return (
    <TrackMetadataEditor
      busy={false}
      draft={draft}
      error={error}
      onCancelPreview={vi.fn()}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      onDraftChange={vi.fn()}
      onPreview={vi.fn()}
      preview={preview}
      result={undefined}
      track={track}
    />
  );
}

describe("TrackMetadataEditor", () => {
  it("keeps current evidence beside proposed values and labels every state", async () => {
    const user = userEvent.setup();
    const { rerender } = render(editor(unchangedDraft));

    const comparison = screen.getByLabelText("Track tag comparison");
    expect(within(comparison).getAllByText("Unchanged")).toHaveLength(6);
    expect(
      screen.getByRole("button", { name: "Review exact changes" }),
    ).toBeDisabled();
    expect(screen.getByText(track.path)).toBeVisible();

    const changedDraft = {
      ...unchangedDraft,
      title: "A deliberately long proposed track title",
    };
    rerender(editor(changedDraft));

    const titleInput = screen.getByRole("textbox", {
      name: "Track title proposed value",
    });
    const titleRow = titleInput.closest(".tag-comparison-row");
    if (!(titleRow instanceof HTMLElement))
      throw new Error("Track title comparison row missing");
    expect(within(titleRow).getByText("Fixture Track")).toBeVisible();
    expect(within(titleRow).getByText("Changed")).toBeVisible();
    expect(screen.getByText("1 field changed.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Review 1 change" }),
    ).toBeEnabled();

    titleInput.focus();
    await user.tab();
    expect(
      screen.getByRole("textbox", {
        name: "Track artist proposed value",
      }),
    ).toHaveFocus();
  });

  it("focuses a blocked preview and keeps confirmation unavailable", () => {
    render(
      editor(unchangedDraft, {
        operationId: "4f2f7939-d847-47e0-a08e-ae47ac0727b2",
        confirmationToken: "track-confirmation-token-long-enough",
        fileId: track.id,
        path: track.path,
        changes: [
          {
            field: "artist",
            before: "Externally changed artist",
            after: "Fixture Artist",
          },
        ],
        warnings: ["The current tag no longer matches this draft."],
      }),
    );

    const confirmation = screen.getByLabelText("Track metadata confirmation");
    expect(confirmation).toHaveFocus();
    expect(
      within(confirmation).getByRole("button", {
        name: "Confirm and write track",
      }),
    ).toBeDisabled();
    expect(confirmation).toHaveTextContent(
      "The current tag no longer matches this draft.",
    );
    expect(confirmation).toHaveTextContent("Confirmation is blocked.");
  });

  it("focuses a recoverable request error inside the editor", () => {
    render(
      editor(
        { ...unchangedDraft, title: "Proposed title" },
        undefined,
        "The file changed after the preview was created.",
      ),
    );

    const error = screen.getByRole("alert", {
      name: "Track metadata request error",
    });
    expect(error).toHaveFocus();
    expect(error).toHaveTextContent(
      "The file changed after the preview was created.",
    );
    expect(error).toHaveTextContent("No unverified change is reported");
  });
});
