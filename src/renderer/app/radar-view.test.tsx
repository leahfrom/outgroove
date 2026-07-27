// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  FavoriteArtistDto,
  FavoriteArtistSearchResultDto,
} from "../../shared/contracts/api";
import { RadarView } from "./radar-view";

const favorite: FavoriteArtistDto = {
  id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
  musicBrainzArtistId: "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
  name: "Fixture Artist",
  sortName: "Fixture Artist",
  disambiguation: "German electronic duo",
  type: "Group",
  country: "DE",
  createdAt: "2026-07-28T08:00:00.000Z",
};

const result: FavoriteArtistSearchResultDto = {
  sent: { artistName: "Fixture Artist" },
  candidates: [
    {
      artistId: favorite.musicBrainzArtistId,
      name: favorite.name,
      sortName: favorite.sortName,
      disambiguation: favorite.disambiguation,
      type: favorite.type,
      country: favorite.country,
      area: "Germany",
      score: 100,
    },
    {
      artistId: "16ffe2a4-14e9-4d25-a4db-c3a6370afacc",
      name: "Fixture Artist",
      sortName: "Fixture Artist",
      disambiguation: "Canadian solo artist with a deliberately long identity",
      type: "Person",
      country: "CA",
      area: "Canada",
      score: 78,
    },
  ],
  source: "network",
  fetchedAt: "2026-07-28T08:00:00.000Z",
  readOnly: true,
};

function renderView(
  overrides: Partial<React.ComponentProps<typeof RadarView>> = {},
): void {
  render(
    <RadarView
      artistSearchError={undefined}
      artistSearchLoading={false}
      artistSearchResult={result}
      artistSearchText="Fixture Artist"
      favoriteArtistIds={[favorite.musicBrainzArtistId]}
      favoriteFilter=""
      favoriteFilterText=""
      favorites={[favorite]}
      mutationBusy={false}
      removal={undefined}
      onAdd={vi.fn()}
      onArtistSearchTextChange={vi.fn()}
      onCancelArtistSearch={vi.fn()}
      onCancelRemoval={vi.fn()}
      onClearFavoriteFilter={vi.fn()}
      onConfirmRemoval={vi.fn()}
      onFavoriteFilterTextChange={vi.fn()}
      onFilterFavorites={vi.fn()}
      onRemove={vi.fn()}
      onSearchArtists={vi.fn()}
      {...overrides}
    />,
  );
}

describe("Radar favorite artists", () => {
  it("discloses the exact network boundary and requires explicit candidate selection", async () => {
    const onAdd = vi.fn();
    renderView({ onAdd });
    expect(
      screen.getByText(
        /sends only the artist name typed below to MusicBrainz/iu,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Audio, paths, tags, artwork, fingerprints/iu),
    ).toBeVisible();
    expect(onAdd).not.toHaveBeenCalled();

    const candidates = screen.getByRole("list", {
      name: "MusicBrainz artist candidates",
    });
    expect(within(candidates).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(candidates).getByRole("button", {
        name: "Fixture Artist is already a favorite",
      }),
    ).toBeDisabled();
    const add = within(candidates).getByRole("button", {
      name: "Add Fixture Artist to favorites",
    });
    add.focus();
    await userEvent.setup().keyboard("{Enter}");
    expect(onAdd).toHaveBeenCalledWith("16ffe2a4-14e9-4d25-a4db-c3a6370afacc");
  });

  it("keeps local filtering separate and presents a keyboard-dismissable removal confirmation", async () => {
    const onFilterFavorites = vi.fn();
    const onCancelRemoval = vi.fn();
    const onConfirmRemoval = vi.fn();
    renderView({
      favoriteFilterText: "Fixture",
      onFilterFavorites,
      onCancelRemoval,
      onConfirmRemoval,
      removal: favorite,
    });
    const user = userEvent.setup();
    const filter = screen.getByRole("search", {
      name: "Search saved favorite artists",
    });
    const submit = within(filter).getByRole("button", {
      name: "Search saved favorites",
    });
    submit.focus();
    await user.keyboard("{Enter}");
    expect(onFilterFavorites).toHaveBeenCalledOnce();

    const dialog = screen.getByRole("dialog", {
      name: "Remove Fixture Artist from favorites",
    });
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm remove favorite",
    });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(onConfirmRemoval).toHaveBeenCalledOnce();

    dialog.focus();
    await user.keyboard("{Escape}");
    expect(onCancelRemoval).toHaveBeenCalledOnce();
  });
});
