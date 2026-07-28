import { describe, expect, it, vi } from "vitest";

import type { FavoriteArtistDto } from "../../shared/contracts/api";
import type { MusicBrainzArtistCandidate } from "../../shared/domain/favorite-artist";
import { ManageFavoriteArtists } from "./manage-favorite-artists";

const candidate: MusicBrainzArtistCandidate = {
  artistId: "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
  name: "Fixture Artist",
  sortName: "Fixture Artist",
  disambiguation: "German electronic duo",
  type: "Group",
  country: "DE",
  area: "Germany",
  score: 100,
};

function favorite(): FavoriteArtistDto {
  return {
    id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
    musicBrainzArtistId: candidate.artistId,
    name: candidate.name,
    sortName: candidate.sortName,
    disambiguation: candidate.disambiguation,
    type: candidate.type,
    country: candidate.country,
    createdAt: "2026-07-28T08:00:00.000Z",
    lastSuccessfulRefreshAt: null,
    lastProviderFetchAt: null,
    lastRefreshTruncated: false,
  };
}

describe("manage favorite artists", () => {
  it("discloses only the typed query and saves only a candidate from the current reviewed result", async () => {
    const addFavoriteArtist = vi.fn(() => favorite());
    const searchArtists = vi.fn(() =>
      Promise.resolve({
        candidates: [candidate],
        source: "network" as const,
        fetchedAt: "2026-07-28T08:00:00.000Z",
      }),
    );
    const service = new ManageFavoriteArtists(
      {
        listFavoriteArtists: vi.fn(() => []),
        addFavoriteArtist,
        removeFavoriteArtist: vi.fn(),
      },
      { searchArtists },
    );

    await expect(service.search("Fixture Artist")).resolves.toEqual({
      sent: { artistName: "Fixture Artist" },
      candidates: [candidate],
      source: "network",
      fetchedAt: "2026-07-28T08:00:00.000Z",
      readOnly: true,
    });
    expect(searchArtists).toHaveBeenCalledWith(
      "Fixture Artist",
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(searchArtists.mock.calls)).not.toMatch(
      /path|audio|tag|artwork|fingerprint/iu,
    );
    expect(service.add(candidate.artistId)).toEqual(favorite());
    expect(addFavoriteArtist).toHaveBeenCalledWith(candidate);
  });

  it("rejects an unreviewed or stale identity instead of trusting renderer metadata", async () => {
    const addFavoriteArtist = vi.fn();
    const service = new ManageFavoriteArtists(
      {
        listFavoriteArtists: vi.fn(() => []),
        addFavoriteArtist,
        removeFavoriteArtist: vi.fn(),
      },
      {
        searchArtists: vi.fn(() =>
          Promise.resolve({
            candidates: [candidate],
            source: "cache" as const,
            fetchedAt: "2026-07-28T08:00:00.000Z",
          }),
        ),
      },
    );
    expect(() => service.add(candidate.artistId)).toThrow(
      "current reviewed results",
    );
    await service.search("Fixture Artist");
    expect(() => service.add("16ffe2a4-14e9-4d25-a4db-c3a6370afacc")).toThrow(
      "current reviewed results",
    );
    expect(addFavoriteArtist).not.toHaveBeenCalled();
  });

  it("lists and removes durable local state without provider access", () => {
    const saved = favorite();
    const listFavoriteArtists = vi.fn(() => [saved]);
    const removeFavoriteArtist = vi.fn(() => ({ id: saved.id }));
    const searchArtists = vi.fn();
    const service = new ManageFavoriteArtists(
      {
        listFavoriteArtists,
        addFavoriteArtist: vi.fn(),
        removeFavoriteArtist,
      },
      { searchArtists },
    );
    expect(service.list("fixture")).toEqual([saved]);
    expect(service.remove(saved.id)).toEqual({ id: saved.id });
    expect(listFavoriteArtists).toHaveBeenCalledWith("fixture");
    expect(removeFavoriteArtist).toHaveBeenCalledWith(saved.id);
    expect(searchArtists).not.toHaveBeenCalled();
  });

  it("cancels the active artist search and does not expose its candidates", async () => {
    let signal: AbortSignal | undefined;
    const service = new ManageFavoriteArtists(
      {
        listFavoriteArtists: vi.fn(() => []),
        addFavoriteArtist: vi.fn(),
        removeFavoriteArtist: vi.fn(),
      },
      {
        searchArtists: vi.fn(
          (_query: string, candidateSignal: AbortSignal) =>
            new Promise<never>((_resolve, reject) => {
              signal = candidateSignal;
              candidateSignal.addEventListener("abort", () =>
                reject(new DOMException("cancelled", "AbortError")),
              );
            }),
        ),
      },
    );
    const pending = service.search("Fixture Artist");
    expect(service.cancel()).toEqual({ cancelled: true });
    expect(signal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(() => service.add(candidate.artistId)).toThrow(
      "current reviewed results",
    );
    expect(service.cancel()).toEqual({ cancelled: false });
  });
});
