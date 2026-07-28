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

function store() {
  return {
    getFavoriteArtist: vi.fn(() => favorite),
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
    service.list("recent", "single", true, 20, 10);
    expect(repository.listRadarItems).toHaveBeenCalledWith(
      "recent",
      "single",
      true,
      "2026-07-28",
      20,
      10,
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
