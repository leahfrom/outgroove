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
  lastSuccessfulRefreshAt: null,
  lastProviderFetchAt: null,
  lastRefreshTruncated: false,
  unseenRadarCount: 7,
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
): ReturnType<typeof render> {
  return render(
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
      radarActionBusyId={undefined}
      radarBackgroundBusy={false}
      radarBackgroundError={undefined}
      radarBackgroundSettings={{
        enabled: false,
        pauseOnBattery: true,
        notificationsEnabled: false,
        notificationCapability: {
          available: false,
          unavailableReason: "development",
        },
        nextRefreshAt: null,
        lastCheckedAt: null,
        lastSuccessfulRefreshAt: null,
        lastOutcome: null,
        lastCompleted: 0,
        lastSucceeded: 0,
        lastFailed: 0,
      }}
      radarError={undefined}
      radarFavoriteArtistId={null}
      radarFilterFavorites={[favorite]}
      radarIncludeDismissed={false}
      radarItems={[]}
      radarLimit={20}
      radarLoading={false}
      radarOffset={0}
      radarPrimaryType="all"
      radarRefreshAllActive={false}
      radarRefreshAllCancelling={false}
      radarRefreshAllResult={undefined}
      radarRefreshResult={undefined}
      radarSummary={{
        current: 21,
        unseen: 7,
        upcoming: 3,
        recent: 4,
        newlyFound: 2,
      }}
      radarTotalItems={0}
      radarUnseenOnly={false}
      radarView="all"
      refreshingFavoriteId={undefined}
      removal={undefined}
      onAdd={vi.fn()}
      onArtistSearchTextChange={vi.fn()}
      onCancelArtistSearch={vi.fn()}
      onCancelRemoval={vi.fn()}
      onClearFavoriteFilter={vi.fn()}
      onConfirmRemoval={vi.fn()}
      onFavoriteFilterTextChange={vi.fn()}
      onFilterFavorites={vi.fn()}
      onRadarDismissed={vi.fn()}
      onRadarFavoriteArtistChange={vi.fn()}
      onRadarIncludeDismissedChange={vi.fn()}
      onRadarOpen={vi.fn()}
      onRadarPage={vi.fn()}
      onRadarPrimaryTypeChange={vi.fn()}
      onRadarSeen={vi.fn()}
      onRadarUnseenOnlyChange={vi.fn()}
      onRadarViewChange={vi.fn()}
      onRadarBackgroundChange={vi.fn()}
      onRefreshAll={vi.fn()}
      onRefreshFavorite={vi.fn()}
      onCancelRefreshAll={vi.fn()}
      onCancelRefresh={vi.fn()}
      onRemove={vi.fn()}
      onSearchArtists={vi.fn()}
      {...overrides}
    />,
  );
}

describe("Radar favorite artists", () => {
  it("keeps automatic refresh opt-in, collapsed, and keyboard accessible", async () => {
    const onRadarBackgroundChange = vi.fn();
    renderView({
      onRadarBackgroundChange,
      radarBackgroundSettings: {
        enabled: false,
        pauseOnBattery: true,
        notificationsEnabled: false,
        notificationCapability: {
          available: false,
          unavailableReason: "development",
        },
        nextRefreshAt: null,
        lastCheckedAt: "2026-07-28T09:00:00.000Z",
        lastSuccessfulRefreshAt: null,
        lastOutcome: "offline",
        lastCompleted: 0,
        lastSucceeded: 0,
        lastFailed: 0,
      },
    });
    expect(
      screen.getByRole("checkbox", {
        name: "Check favorite artists automatically",
        hidden: true,
      }),
    ).not.toBeVisible();

    const summary = screen.getByText("Automatic refresh");
    await userEvent.setup().click(summary);
    const enabled = screen.getByRole("checkbox", {
      name: "Check favorite artists automatically",
    });
    expect(enabled).not.toBeChecked();
    enabled.focus();
    await userEvent.setup().keyboard(" ");
    expect(onRadarBackgroundChange).toHaveBeenCalledWith(true, true, false);
    expect(
      screen.getByRole("checkbox", {
        name: "Pause automatic checks on battery power",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: "Notify me about newly found releases",
      }),
    ).toBeDisabled();
    expect(
      screen.getByText(/available only in an installed release build/iu),
    ).toBeVisible();
    expect(screen.getByText("Paused while offline")).toBeVisible();
  });

  it("keeps notifications separately opt-in and keyboard operable when available", async () => {
    const onRadarBackgroundChange = vi.fn();
    renderView({
      onRadarBackgroundChange,
      radarBackgroundSettings: {
        enabled: true,
        pauseOnBattery: true,
        notificationsEnabled: false,
        notificationCapability: {
          available: true,
          unavailableReason: null,
        },
        nextRefreshAt: "2026-07-29T09:00:00.000Z",
        lastCheckedAt: null,
        lastSuccessfulRefreshAt: null,
        lastOutcome: null,
        lastCompleted: 0,
        lastSucceeded: 0,
        lastFailed: 0,
      },
    });
    await userEvent.setup().click(screen.getByText("Automatic refresh"));
    const notifications = screen.getByRole("checkbox", {
      name: "Notify me about newly found releases",
    });
    expect(notifications).not.toBeChecked();
    notifications.focus();
    await userEvent.setup().keyboard(" ");
    expect(onRadarBackgroundChange).toHaveBeenCalledWith(true, true, true);
  });

  it("discloses the exact network boundary and requires explicit candidate selection", async () => {
    const onAdd = vi.fn();
    renderView({ onAdd });
    expect(
      screen.getByText(
        /sends only the artist name typed below to MusicBrainz/iu,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Your audio, file locations, tags, artwork, fingerprints/iu,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/Artist results for “Fixture Artist”/u),
    ).toHaveTextContent("checked with MusicBrainz");
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

  it("explains recent and older saved MusicBrainz results without cache jargon", () => {
    const { unmount } = renderView({
      artistSearchResult: { ...result, source: "cache" },
    });
    expect(
      screen.getByText(/Artist results for “Fixture Artist”/u),
    ).toHaveTextContent("using a recent result saved on this device");
    unmount();

    renderView({
      artistSearchResult: { ...result, source: "stale-cache" },
    });
    expect(
      screen.getByText(/Artist results for “Fixture Artist”/u),
    ).toHaveTextContent(
      "using an older saved result because MusicBrainz could not be reached",
    );
    expect(screen.queryByText(/cache/iu)).not.toBeInTheDocument();
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
    expect(screen.getByText("7 unseen releases")).toBeVisible();
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
    expect(dialog).toHaveTextContent("saved online search results");
    expect(dialog).not.toHaveTextContent("provider caches");
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

  it("starts and cancels the all-favorites sweep from the keyboard and reports partial failure", async () => {
    const onRefreshAll = vi.fn();
    const user = userEvent.setup();
    const { unmount } = renderView({ onRefreshAll });
    const refreshAll = screen.getByRole("button", {
      name: "Refresh all favorites",
    });
    refreshAll.focus();
    await user.keyboard("{Enter}");
    expect(onRefreshAll).toHaveBeenCalledOnce();
    unmount();

    const onCancelRefreshAll = vi.fn();
    renderView({
      onCancelRefreshAll,
      radarRefreshAllActive: true,
      radarRefreshAllResult: {
        totalFavorites: 2,
        completed: 2,
        successful: 1,
        failed: 1,
        cancelled: false,
        results: [
          {
            favoriteArtistId: "1f5053fe-7aab-4ca8-861b-4ed97bc69f91",
            favoriteArtistName: "Second Artist",
            added: 1,
            newlyDiscovered: 1,
            updated: 0,
            unchanged: 2,
            total: 3,
            source: "cache",
            providerFetchedAt: "2026-07-28T08:00:00.000Z",
            refreshedAt: "2026-07-28T09:00:00.000Z",
            truncated: false,
          },
        ],
        failures: [
          {
            favoriteArtistId: favorite.id,
            favoriteArtistName: favorite.name,
            message: "MusicBrainz unavailable",
          },
        ],
      },
    });
    const cancel = screen.getByRole("button", {
      name: "Cancel refresh all",
    });
    cancel.focus();
    await user.keyboard("{Enter}");
    expect(onCancelRefreshAll).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checked 2 of 2 artists: 1 refreshed and 1 could not be refreshed.",
    );
    const failures = screen.getByRole("list", {
      name: "Favorites that failed to refresh",
    });
    expect(failures).toHaveTextContent("Fixture ArtistMusicBrainz unavailable");
    expect(
      screen.getByRole("button", {
        name: `Refresh releases for ${favorite.name}`,
      }),
    ).toBeDisabled();
    const successful = screen.getByText("Refreshed artists (1)");
    successful.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("list", {
        name: "Favorites refreshed successfully",
      }),
    ).toHaveTextContent("Second Artist1 new, 0 changed, 2 unchanged");
  });
});
