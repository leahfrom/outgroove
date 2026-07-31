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
    trackTotal: 12,
    discNumber: 1,
    discTotal: 2,
    year: "2026-07",
    genres: ["Post Rock"],
    composers: ["Fixture Composer"],
    conductors: ["Fixture Conductor"],
    lyricists: ["Fixture Lyricist"],
    isrcs: ["DEABC2600001"],
    copyright: "Copyright Fixture",
    originalReleaseDate: "2020-03",
    language: "deu",
    comment: "First line\nSecond line",
    comments: [
      {
        text: "First line\nSecond line",
        language: "eng",
        descriptor: null,
      },
    ],
  },
  nativeTags: [],
  scanError: null,
};

const unchangedDraft: TrackMetadataDraft = {
  title: track.tags.title,
  artist: track.tags.artist,
  albumArtist: track.tags.albumArtist,
  trackNumber: String(track.tags.trackNumber),
  trackTotal: String(track.tags.trackTotal),
  discNumber: String(track.tags.discNumber),
  discTotal: String(track.tags.discTotal),
  year: track.tags.year ?? "",
  genre: "Post Rock",
  composer: "Fixture Composer",
  conductor: "Fixture Conductor",
  lyricist: "Fixture Lyricist",
  isrc: "DEABC2600001",
  copyright: "Copyright Fixture",
  originalReleaseDate: "2020-03",
  language: "deu",
  comment: "First line\nSecond line",
  publisher: "",
  description: "",
  grouping: "",
  catalogNumber: "",
  publishingDate: "",
  bpm: "",
  compilation: "false",
  musicBrainzRecordingId: "",
  musicBrainzReleaseTrackId: "",
  musicBrainzReleaseId: "",
  musicBrainzArtistId: "",
  musicBrainzReleaseArtistId: "",
  musicBrainzReleaseGroupId: "",
  musicBrainzWorkId: "",
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

    const editorRegion = screen.getByLabelText("Track metadata editor");
    expect(editorRegion).toHaveTextContent(
      "Change the fields you want while keeping the current values beside them",
    );
    expect(editorRegion).not.toHaveTextContent("exact restoration");
    const comparison = screen.getByLabelText("Basic track tag comparison");
    expect(within(comparison).getAllByText("Unchanged")).toHaveLength(7);
    const moreSummary = screen.getByText("More fields").closest("summary");
    const moreFields = screen.getByText("More fields").closest("details");
    if (!moreSummary || !moreFields)
      throw new Error("More fields disclosure missing");
    expect(moreFields).not.toHaveAttribute("open");
    moreSummary.focus();
    await user.click(moreSummary);
    expect(moreFields).toHaveAttribute("open");
    expect(
      screen.getByRole("spinbutton", { name: "Track total proposed value" }),
    ).toHaveValue(12);
    expect(
      screen.getByRole("spinbutton", { name: "Disc total proposed value" }),
    ).toHaveValue(2);
    expect(
      screen.getByRole("button", { name: "Review exact changes" }),
    ).toBeDisabled();
    expect(screen.getByText(track.path)).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Genre proposed value" }),
    ).toHaveValue("Post Rock");
    expect(
      screen.getByRole("textbox", { name: "Composer proposed value" }),
    ).toHaveValue("Fixture Composer");
    expect(
      screen.getByRole("textbox", { name: "Conductor proposed value" }),
    ).toHaveValue("Fixture Conductor");
    expect(
      screen.getByRole("textbox", { name: "Lyricist proposed value" }),
    ).toHaveValue("Fixture Lyricist");
    expect(
      screen.getByRole("textbox", { name: "ISRC proposed value" }),
    ).toHaveValue("DEABC2600001");
    expect(
      screen.getByRole("textbox", { name: "Copyright proposed value" }),
    ).toHaveValue("Copyright Fixture");
    expect(
      screen.getByRole("textbox", {
        name: "Original release date proposed value",
      }),
    ).toHaveValue("2020-03");
    expect(
      screen.getByRole("textbox", { name: "Language proposed value" }),
    ).toHaveValue("deu");
    expect(
      screen.getByRole("textbox", { name: "Comment proposed value" }),
    ).toHaveValue("First line\nSecond line");
    expect(
      screen.getByRole("textbox", { name: "Comment proposed value" }),
    ).toHaveAccessibleName("Comment proposed value");
    expect(
      screen.getByRole("combobox", { name: "Compilation proposed value" }),
    ).toHaveValue("false");
    expect(
      screen.getByRole("textbox", {
        name: "MusicBrainz release ID proposed value",
      }),
    ).toHaveAccessibleName("MusicBrainz release ID proposed value");
    expect(screen.getByText("MusicBrainz identifiers")).toBeVisible();
    const commentRow = screen
      .getByRole("textbox", { name: "Comment proposed value" })
      .closest(".tag-comparison-row");
    if (!(commentRow instanceof HTMLElement))
      throw new Error("Comment comparison row missing");
    expect(within(commentRow).getByText(/language eng/u)).toBeVisible();

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

  it("reveals and summarizes a changed secondary field", async () => {
    const user = userEvent.setup();
    render(
      editor({
        ...unchangedDraft,
        lyricist: "Changed Lyricist",
      }),
    );

    expect(screen.getByText("More fields").closest("details")).toHaveAttribute(
      "open",
    );
    const lyricist = screen.getByRole("textbox", {
      name: "Lyricist proposed value",
    });
    const row = lyricist.closest(".tag-comparison-row");
    if (!(row instanceof HTMLElement))
      throw new Error("Lyricist comparison row missing");
    expect(within(row).getByText("Changed")).toBeVisible();
    await user.click(screen.getByText("More fields"));
    expect(
      screen.getByText("More fields").closest("details"),
    ).not.toHaveAttribute("open");
    expect(screen.getByText("1 change drafted")).toBeVisible();
  });

  it("shows boolean tag evidence as yes or no in the explicit preview", () => {
    render(
      editor(
        { ...unchangedDraft, compilation: "true" },
        {
          operationId: "4f2f7939-d847-47e0-a08e-ae47ac0727b2",
          confirmationToken: "track-confirmation-token-long-enough",
          fileId: track.id,
          path: track.path,
          changes: [{ field: "compilation", before: false, after: true }],
          warnings: [],
        },
      ),
    );

    const confirmation = screen.getByLabelText("Track metadata confirmation");
    expect(within(confirmation).getByText("No")).toBeVisible();
    expect(within(confirmation).getByText("Yes")).toBeVisible();
    expect(
      within(confirmation).getByRole("button", {
        name: "Confirm and write track",
      }),
    ).toBeEnabled();
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
    expect(confirmation).toHaveTextContent(
      "These changes can’t be confirmed yet.",
    );
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
    expect(error).toHaveTextContent(
      "Nothing is treated as complete until Outgroove verifies it",
    );
  });
});
