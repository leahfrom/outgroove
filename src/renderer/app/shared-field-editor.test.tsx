// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import {
  SharedFieldEditor,
  type SharedFieldDraft,
  type SharedFieldEnabled,
} from "./shared-field-editor";

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
    artist: "First Artist",
    albumArtist: "Shared Album Artist",
    trackNumber: 1,
    trackTotal: 10,
    discNumber: 1,
    discTotal: 2,
    year: null,
    genres: ["Post Rock"],
    composers: ["First Composer"],
    conductors: ["First Conductor"],
    lyricists: ["First Lyricist"],
    isrcs: ["DEABC2600001"],
    copyright: "First Copyright",
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
    artist: "Second Artist",
    trackNumber: 2,
    trackTotal: 12,
    discNumber: null,
    discTotal: 3,
    year: "2026-07",
    genres: ["Metal"],
    composers: ["Second Composer"],
    conductors: ["Second Conductor"],
    lyricists: ["Second Lyricist"],
    isrcs: ["DEABC2600002"],
    copyright: "Second Copyright",
  },
};

const disabledFields: SharedFieldEnabled = {
  artist: false,
  albumArtist: false,
  trackTotal: false,
  discNumber: false,
  discTotal: false,
  year: false,
  genre: false,
  composer: false,
  conductor: false,
  lyricist: false,
  isrc: false,
  copyright: false,
};

const emptyDraft: SharedFieldDraft = {
  artist: "",
  albumArtist: "",
  trackTotal: "",
  discNumber: "",
  discTotal: "",
  year: "",
  genre: "",
  composer: "",
  conductor: "",
  lyricist: "",
  isrc: "",
  copyright: "",
};

function editor({
  enabled = disabledFields,
  draft = emptyDraft,
  error,
  onEnabledChange = vi.fn(),
  onDraftChange = vi.fn(),
}: {
  enabled?: SharedFieldEnabled;
  draft?: SharedFieldDraft;
  error?: string;
  onEnabledChange?: (field: keyof SharedFieldDraft, enabled: boolean) => void;
  onDraftChange?: (field: keyof SharedFieldDraft, value: string) => void;
} = {}) {
  return (
    <SharedFieldEditor
      busy={false}
      draft={draft}
      enabled={enabled}
      error={error}
      onCancelPreview={vi.fn()}
      onConfirm={vi.fn()}
      onDraftChange={onDraftChange}
      onEnabledChange={onEnabledChange}
      onPreview={vi.fn()}
      preview={undefined}
      result={undefined}
      tracks={[firstTrack, secondTrack]}
    />
  );
}

describe("SharedFieldEditor", () => {
  it("reports mixed values honestly and expands per-track evidence", async () => {
    const user = userEvent.setup();
    render(editor());

    const comparison = screen.getByLabelText("Basic shared tag comparison");
    expect(within(comparison).getAllByText("Mixed values")).toHaveLength(4);
    expect(within(comparison).getByText("Shared Album Artist")).toBeVisible();
    expect(screen.getByText("No shared fields selected.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Preview selected tracks" }),
    ).toBeDisabled();

    const artistInput = screen.getByLabelText("Batch track artist value");
    const artistRow = artistInput.closest(".tag-comparison-row");
    if (!(artistRow instanceof HTMLElement))
      throw new Error("Track artist comparison row missing");
    const mixedValues = within(artistRow).getByText("Mixed values");
    expect(within(artistRow).getByText("First Artist")).not.toBeVisible();

    await user.click(mixedValues);
    expect(within(artistRow).getByText("First Artist")).toBeVisible();
    expect(within(artistRow).getByText("Second Artist")).toBeVisible();
    expect(within(artistRow).getByText("First Track")).toBeVisible();
    expect(within(artistRow).getByText("Second Track")).toBeVisible();

    const discInput = screen.getByLabelText("Batch disc number value");
    const discRow = discInput.closest(".tag-comparison-row");
    if (!(discRow instanceof HTMLElement))
      throw new Error("Disc number comparison row missing");
    await user.click(within(discRow).getByText("Mixed values"));
    expect(within(discRow).getByText("Not set")).toBeVisible();

    const genreInput = screen.getByLabelText("Batch genre value");
    const genreRow = genreInput.closest(".tag-comparison-row");
    if (!(genreRow instanceof HTMLElement))
      throw new Error("Genre comparison row missing");
    await user.click(within(genreRow).getByText("Mixed values"));
    expect(within(genreRow).getByText("Post Rock")).toBeVisible();
    expect(within(genreRow).getByText("Metal")).toBeVisible();

    const moreSummary = screen.getByText("More fields").closest("summary");
    const moreFields = screen.getByText("More fields").closest("details");
    if (!moreSummary || !moreFields)
      throw new Error("More fields disclosure missing");
    expect(moreFields).not.toHaveAttribute("open");
    moreSummary.focus();
    await user.click(moreSummary);
    expect(moreFields).toHaveAttribute("open");
    expect(
      screen.getByLabelText("Batch track total value"),
    ).toHaveAccessibleName("Batch track total value");
    expect(
      screen.getByLabelText("Batch disc total value"),
    ).toHaveAccessibleName("Batch disc total value");

    const composerInput = screen.getByLabelText("Batch composer value");
    const composerRow = composerInput.closest(".tag-comparison-row");
    if (!(composerRow instanceof HTMLElement))
      throw new Error("Composer comparison row missing");
    await user.click(within(composerRow).getByText("Mixed values"));
    expect(within(composerRow).getByText("First Composer")).toBeVisible();
    expect(within(composerRow).getByText("Second Composer")).toBeVisible();

    const conductorInput = screen.getByLabelText("Batch conductor value");
    const conductorRow = conductorInput.closest(".tag-comparison-row");
    if (!(conductorRow instanceof HTMLElement))
      throw new Error("Conductor comparison row missing");
    await user.click(within(conductorRow).getByText("Mixed values"));
    expect(within(conductorRow).getByText("First Conductor")).toBeVisible();
    expect(within(conductorRow).getByText("Second Conductor")).toBeVisible();

    const lyricistInput = screen.getByLabelText("Batch lyricist value");
    const lyricistRow = lyricistInput.closest(".tag-comparison-row");
    if (!(lyricistRow instanceof HTMLElement))
      throw new Error("Lyricist comparison row missing");
    await user.click(within(lyricistRow).getByText("Mixed values"));
    expect(within(lyricistRow).getByText("First Lyricist")).toBeVisible();
    expect(within(lyricistRow).getByText("Second Lyricist")).toBeVisible();

    expect(screen.getByLabelText("Batch ISRC value")).toHaveAccessibleName(
      "Batch ISRC value",
    );
    expect(screen.getByLabelText("Batch copyright value")).toHaveAccessibleName(
      "Batch copyright value",
    );
  });

  it("reveals and summarizes a selected secondary field", async () => {
    const user = userEvent.setup();
    render(
      editor({
        enabled: { ...disabledFields, isrc: true },
        draft: { ...emptyDraft, isrc: "DEABC2600001" },
      }),
    );

    expect(screen.getByText("More fields").closest("details")).toHaveAttribute(
      "open",
    );
    expect(screen.getByLabelText("Batch ISRC value")).toBeEnabled();
    await user.click(screen.getByText("More fields"));
    expect(
      screen.getByText("More fields").closest("details"),
    ).not.toHaveAttribute("open");
    expect(screen.getByText("1 field selected")).toBeVisible();
  });

  it("keeps proposals opt-in and exposes the comparison in keyboard order", async () => {
    const user = userEvent.setup();
    const onEnabledChange = vi.fn();
    const onDraftChange = vi.fn();
    const { rerender } = render(editor({ onDraftChange, onEnabledChange }));

    const artistCheckbox = screen.getByRole("checkbox", {
      name: "Change track artist",
    });
    const artistInput = screen.getByLabelText("Batch track artist value");
    expect(artistInput).toBeDisabled();

    artistCheckbox.focus();
    await user.keyboard(" ");
    expect(onEnabledChange).toHaveBeenCalledWith("artist", true);

    rerender(
      editor({
        enabled: { ...disabledFields, artist: true },
        draft: { ...emptyDraft, artist: "Proposed Artist" },
        onDraftChange,
        onEnabledChange,
      }),
    );
    expect(artistInput).toBeEnabled();
    expect(
      screen.getByText("1 shared field selected for review."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Preview selected tracks" }),
    ).toBeEnabled();

    artistCheckbox.focus();
    await user.tab();
    expect(artistInput).toHaveFocus();
    await user.type(artistInput, "!");
    expect(onDraftChange).toHaveBeenLastCalledWith(
      "artist",
      "Proposed Artist!",
    );
  });

  it("keeps a request failure focused inside the shared-field workflow", () => {
    render(
      editor({
        enabled: { ...disabledFields, artist: true },
        draft: { ...emptyDraft, artist: "Proposed Artist" },
        error: "The batch preview is stale.",
      }),
    );

    const error = screen.getByRole("alert", {
      name: "Shared metadata request error",
    });
    expect(error).toHaveFocus();
    expect(error).toHaveTextContent("The batch preview is stale.");
    expect(error).toHaveTextContent("The per-file preview remains available");
  });
});
