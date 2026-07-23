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
    discNumber: 1,
    year: null,
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
    discNumber: null,
    year: "2026-07",
  },
};

const disabledFields: SharedFieldEnabled = {
  artist: false,
  albumArtist: false,
  discNumber: false,
  year: false,
};

const emptyDraft: SharedFieldDraft = {
  artist: "",
  albumArtist: "",
  discNumber: "",
  year: "",
};

function editor({
  enabled = disabledFields,
  draft = emptyDraft,
  onEnabledChange = vi.fn(),
  onDraftChange = vi.fn(),
}: {
  enabled?: SharedFieldEnabled;
  draft?: SharedFieldDraft;
  onEnabledChange?: (field: keyof SharedFieldDraft, enabled: boolean) => void;
  onDraftChange?: (field: keyof SharedFieldDraft, value: string) => void;
} = {}) {
  return (
    <SharedFieldEditor
      busy={false}
      draft={draft}
      enabled={enabled}
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

    const comparison = screen.getByLabelText("Shared tag comparison");
    expect(within(comparison).getAllByText("Mixed values")).toHaveLength(3);
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
});
