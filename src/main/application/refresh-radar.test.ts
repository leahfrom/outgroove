import { describe, expect, it, vi } from "vitest";

import type { FavoriteArtistDto } from "../../shared/contracts/api";
import type { RadarReleaseGroupObservation } from "../../shared/domain/radar";
import { RefreshRadar } from "./refresh-radar";

const favorite: FavoriteArtistDto = {
  id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
  musicBrainzArtistId: "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
  name: "Fixture Artist",
  sortName: "Fixture Artist",
  disambiguation: null,
  type: "Group",
  country: "DE",
  createdAt: "2026-07-01T00:00:00.000Z",
  lastSuccessfulRefreshAt: null,
  lastProviderFetchAt: null,
  lastRefreshTruncated: false,
  unseenRadarCount: 0,
};

const observation: RadarReleaseGroupObservation = {
  releaseGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  representativeReleaseId: "11111111-1111-4111-8111-111111111111",
  title: "Future Fixture",
  primaryType: "Album",
  secondaryTypes: [],
  firstReleaseDate: "2027-03",
  status: "Official",
  country: "DE",
};

const secondFavorite: FavoriteArtistDto = {
  ...favorite,
  id: "1f5053fe-7aab-4ca8-861b-4ed97bc69f91",
  musicBrainzArtistId: "16ffe2a4-14e9-4d25-a4db-c3a6370afacc",
  name: "Second Artist",
  sortName: "Second Artist",
};

function store() {
  return {
    listFavoriteArtists: vi.fn(() => [favorite]),
    getFavoriteArtist: vi.fn<(id: string) => FavoriteArtistDto>(() => favorite),
    commitRadarRefresh: vi.fn(() => ({
      added: 1,
      updated: 0,
      unchanged: 0,
    })),
    listRadarItems: vi.fn(() => ({
      items: [],
      totalItems: 0,
      offset: 0,
      limit: 50,
      summary: {
        current: 0,
        unseen: 0,
        upcoming: 0,
        recent: 0,
        newlyFound: 0,
      },
    })),
    setRadarItemSeen: vi.fn(),
    setRadarItemDismissed: vi.fn(),
  };
}

describe("manual Radar refresh", () => {
  it("routes local type filters to the store without provider access", () => {
    const repository = store();
    const browseArtistReleases = vi.fn();
    const service = new RefreshRadar(
      repository,
      { browseArtistReleases },
      () => new Date("2026-07-28T09:00:00.000Z"),
    );
    expect(
      service.list("recent", "single", true, 20, 10, favorite.id, true),
    ).toMatchObject({
      summary: {
        current: 0,
        unseen: 0,
        upcoming: 0,
        recent: 0,
        newlyFound: 0,
      },
    });
    expect(repository.listRadarItems).toHaveBeenCalledWith(
      "recent",
      "single",
      true,
      "2026-07-28",
      20,
      10,
      favorite.id,
      true,
    );
    expect(browseArtistReleases).not.toHaveBeenCalled();
  });

  it("sends only the saved artist identity and atomically commits a complete result", async () => {
    const repository = store();
    const browseArtistReleases = vi.fn(() =>
      Promise.resolve({
        observations: [observation],
        source: "network" as const,
        fetchedAt: "2026-07-28T08:00:00.000Z",
        truncated: false,
      }),
    );
    const service = new RefreshRadar(
      repository,
      { browseArtistReleases },
      () => new Date("2026-07-28T09:00:00.000Z"),
    );

    await expect(service.refresh(favorite.id)).resolves.toMatchObject({
      favoriteArtistName: "Fixture Artist",
      added: 1,
      newlyDiscovered: 0,
      total: 1,
      source: "network",
    });
    expect(browseArtistReleases).toHaveBeenCalledWith(
      favorite.musicBrainzArtistId,
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(browseArtistReleases.mock.calls)).not.toMatch(
      /path|audio|tag|artwork|fingerprint/iu,
    );
    expect(repository.commitRadarRefresh).toHaveBeenCalledWith(
      favorite.id,
      [observation],
      {
        refreshedAt: "2026-07-28T09:00:00.000Z",
        providerFetchedAt: "2026-07-28T08:00:00.000Z",
        truncated: false,
      },
    );
  });

  it("labels additions as newly discovered only after an earlier successful baseline", async () => {
    const repository = store();
    repository.getFavoriteArtist.mockReturnValue({
      ...favorite,
      lastSuccessfulRefreshAt: "2026-07-27T09:00:00.000Z",
    });
    const service = new RefreshRadar(repository, {
      browseArtistReleases: vi.fn(() =>
        Promise.resolve({
          observations: [observation],
          source: "network" as const,
          fetchedAt: "2026-07-28T08:00:00.000Z",
          truncated: false,
        }),
      ),
    });

    await expect(service.refresh(favorite.id)).resolves.toMatchObject({
      added: 1,
      newlyDiscovered: 1,
    });
  });

  it("keeps the last successful snapshot unchanged for stale fallback", async () => {
    const repository = store();
    const service = new RefreshRadar(repository, {
      browseArtistReleases: vi.fn(() =>
        Promise.resolve({
          observations: [observation],
          source: "stale-cache" as const,
          fetchedAt: "2026-01-01T00:00:00.000Z",
          truncated: false,
        }),
      ),
    });
    await expect(service.refresh(favorite.id)).rejects.toThrow(
      "kept the last successful Radar view unchanged",
    );
    expect(repository.commitRadarRefresh).not.toHaveBeenCalled();
  });

  it("cancels only the matching active favorite without committing partial work", async () => {
    const repository = store();
    let observedSignal: AbortSignal | undefined;
    const service = new RefreshRadar(repository, {
      browseArtistReleases: vi.fn(
        (_artistId: string, signal: AbortSignal) =>
          new Promise<never>((_resolve, reject) => {
            observedSignal = signal;
            signal.addEventListener("abort", () =>
              reject(new DOMException("cancelled", "AbortError")),
            );
          }),
      ),
    });
    const pending = service.refresh(favorite.id);
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    expect(service.cancel("26ec2b16-7ba3-4e48-9965-20503810709e")).toEqual({
      cancelled: false,
    });
    expect(service.cancel(favorite.id)).toEqual({ cancelled: true });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(repository.commitRadarRefresh).not.toHaveBeenCalled();
  });
});

describe("Refresh all Radar favorites", () => {
  it("never starts a later favorite before the current provider request finishes", async () => {
    const repository = store();
    repository.listFavoriteArtists.mockReturnValue([favorite, secondFavorite]);
    let finishFirst:
      | ((value: {
          observations: readonly RadarReleaseGroupObservation[];
          source: "network";
          fetchedAt: string;
          truncated: boolean;
        }) => void)
      | undefined;
    const browseArtistReleases = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce({
        observations: [observation],
        source: "network" as const,
        fetchedAt: "2026-07-28T08:01:00.000Z",
        truncated: false,
      });
    const service = new RefreshRadar(repository, {
      browseArtistReleases,
    });

    const pending = service.refreshAll(vi.fn());
    await vi.waitFor(() =>
      expect(browseArtistReleases).toHaveBeenCalledTimes(1),
    );
    finishFirst?.({
      observations: [observation],
      source: "network",
      fetchedAt: "2026-07-28T08:00:00.000Z",
      truncated: false,
    });
    await vi.waitFor(() =>
      expect(browseArtistReleases).toHaveBeenCalledTimes(2),
    );
    await expect(pending).resolves.toMatchObject({
      successful: 2,
      failed: 0,
    });
  });

  it("refreshes the stable local favorite list sequentially and reports partial failure", async () => {
    const repository = store();
    repository.listFavoriteArtists.mockReturnValue([favorite, secondFavorite]);
    const browseArtistReleases = vi
      .fn()
      .mockResolvedValueOnce({
        observations: [observation],
        source: "network" as const,
        fetchedAt: "2026-07-28T08:00:00.000Z",
        truncated: false,
      })
      .mockRejectedValueOnce(new Error("MusicBrainz unavailable"));
    const progress = vi.fn();
    const service = new RefreshRadar(
      repository,
      { browseArtistReleases },
      () => new Date("2026-07-28T09:00:00.000Z"),
    );

    await expect(service.refreshAll(progress)).resolves.toEqual({
      totalFavorites: 2,
      completed: 2,
      successful: 1,
      failed: 1,
      cancelled: false,
      results: [
        expect.objectContaining({
          favoriteArtistId: favorite.id,
          favoriteArtistName: favorite.name,
        }),
      ],
      failures: [
        {
          favoriteArtistId: secondFavorite.id,
          favoriteArtistName: secondFavorite.name,
          message: "MusicBrainz unavailable",
        },
      ],
    });
    expect(browseArtistReleases).toHaveBeenNthCalledWith(
      1,
      favorite.musicBrainzArtistId,
      expect.any(AbortSignal),
    );
    expect(browseArtistReleases).toHaveBeenNthCalledWith(
      2,
      secondFavorite.musicBrainzArtistId,
      expect.any(AbortSignal),
    );
    expect(repository.commitRadarRefresh).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls).toEqual([
      [0, 2, "Refreshing Radar for Fixture Artist"],
      [1, 2, "Finished Radar for Fixture Artist"],
      [1, 2, "Refreshing Radar for Second Artist"],
      [2, 2, "Finished Radar for Second Artist"],
    ]);
  });

  it("treats stale cache as an isolated failure and continues the sweep", async () => {
    const repository = store();
    repository.listFavoriteArtists.mockReturnValue([favorite, secondFavorite]);
    const browseArtistReleases = vi
      .fn()
      .mockResolvedValueOnce({
        observations: [observation],
        source: "stale-cache" as const,
        fetchedAt: "2026-01-01T00:00:00.000Z",
        truncated: false,
      })
      .mockResolvedValueOnce({
        observations: [observation],
        source: "cache" as const,
        fetchedAt: "2026-07-28T08:00:00.000Z",
        truncated: false,
      });
    const service = new RefreshRadar(repository, { browseArtistReleases });

    const result = await service.refreshAll(vi.fn());
    expect(result).toMatchObject({
      successful: 1,
      failed: 1,
      cancelled: false,
    });
    expect(result.failures[0]?.message).toMatch(/last successful Radar view/iu);
    expect(repository.commitRadarRefresh).toHaveBeenCalledWith(
      secondFavorite.id,
      [observation],
      expect.any(Object),
    );
  });

  it("stops cleanly on cancellation without committing the in-flight artist", async () => {
    const repository = store();
    repository.listFavoriteArtists.mockReturnValue([favorite, secondFavorite]);
    let observedSignal: AbortSignal | undefined;
    const service = new RefreshRadar(repository, {
      browseArtistReleases: vi.fn(
        (_artistId: string, signal: AbortSignal) =>
          new Promise<never>((_resolve, reject) => {
            observedSignal = signal;
            signal.addEventListener("abort", () =>
              reject(new DOMException("cancelled", "AbortError")),
            );
          }),
      ),
    });

    const progress = vi.fn();
    const pending = service.refreshAll(progress);
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    expect(service.cancel(favorite.id)).toEqual({ cancelled: false });
    expect(service.cancelAll()).toEqual({ cancelled: true });
    await expect(pending).resolves.toMatchObject({
      totalFavorites: 2,
      completed: 0,
      successful: 0,
      failed: 0,
      cancelled: true,
    });
    expect(repository.commitRadarRefresh).not.toHaveBeenCalled();
    expect(progress).toHaveBeenLastCalledWith(
      2,
      2,
      "Stopped the Radar refresh-all sweep",
    );
    expect(service.cancelAll()).toEqual({ cancelled: false });
  });

  it("cancels an older sweep before starting a new single-favorite refresh", async () => {
    const repository = store();
    repository.listFavoriteArtists.mockReturnValue([favorite, secondFavorite]);
    repository.getFavoriteArtist.mockImplementation((id) =>
      id === secondFavorite.id ? secondFavorite : favorite,
    );
    let firstSignal: AbortSignal | undefined;
    const browseArtistReleases = vi
      .fn()
      .mockImplementationOnce(
        (_artistId: string, signal: AbortSignal) =>
          new Promise<never>((_resolve, reject) => {
            firstSignal = signal;
            signal.addEventListener("abort", () =>
              reject(new DOMException("cancelled", "AbortError")),
            );
          }),
      )
      .mockResolvedValueOnce({
        observations: [observation],
        source: "network" as const,
        fetchedAt: "2026-07-28T08:00:00.000Z",
        truncated: false,
      });
    const service = new RefreshRadar(repository, {
      browseArtistReleases,
    });

    const sweep = service.refreshAll(vi.fn());
    await vi.waitFor(() => expect(firstSignal).toBeDefined());
    const single = service.refresh(secondFavorite.id);
    await expect(sweep).resolves.toMatchObject({
      completed: 0,
      cancelled: true,
    });
    await expect(single).resolves.toMatchObject({
      favoriteArtistId: secondFavorite.id,
    });
    expect(repository.commitRadarRefresh).toHaveBeenCalledTimes(1);
    expect(repository.commitRadarRefresh).toHaveBeenCalledWith(
      secondFavorite.id,
      [observation],
      expect.any(Object),
    );
  });

  it("starts a background sweep only while idle and yields to manual refresh", async () => {
    const repository = store();
    let backgroundSignal: AbortSignal | undefined;
    const browseArtistReleases = vi
      .fn()
      .mockImplementationOnce(
        (_artistId: string, signal: AbortSignal) =>
          new Promise<never>((_resolve, reject) => {
            backgroundSignal = signal;
            signal.addEventListener("abort", () =>
              reject(new DOMException("cancelled", "AbortError")),
            );
          }),
      )
      .mockResolvedValueOnce({
        observations: [observation],
        source: "network" as const,
        fetchedAt: "2026-07-28T08:00:00.000Z",
        truncated: false,
      });
    const service = new RefreshRadar(repository, { browseArtistReleases });

    const background = service.refreshAllIfIdle(vi.fn());
    await vi.waitFor(() => expect(backgroundSignal).toBeDefined());
    await expect(service.refreshAllIfIdle(vi.fn())).resolves.toBeUndefined();
    const manual = service.refresh(favorite.id);

    await expect(background).resolves.toMatchObject({ cancelled: true });
    await expect(manual).resolves.toMatchObject({
      favoriteArtistId: favorite.id,
    });
    expect(backgroundSignal?.aborted).toBe(true);
  });

  it("completes an empty sweep without provider access", async () => {
    const repository = store();
    repository.listFavoriteArtists.mockReturnValue([]);
    const browseArtistReleases = vi.fn();
    const progress = vi.fn();
    const service = new RefreshRadar(repository, {
      browseArtistReleases,
    });

    await expect(service.refreshAll(progress)).resolves.toMatchObject({
      totalFavorites: 0,
      completed: 0,
      successful: 0,
      failed: 0,
      cancelled: false,
    });
    expect(browseArtistReleases).not.toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });
});
