import { describe, expect, it, vi } from "vitest";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import { FindAlbumCandidates } from "./find-album-candidates";

const album: CatalogAlbum = {
  id: "adb9be31-d450-45f9-99de-c9c6143988ad",
  title: "Fixture Album",
  albumArtist: "Fixture Artist",
  tracks: [
    {
      id: "73b6d616-0f52-4ef3-b71a-ffb42844e306",
      path: "/private/not-sent.flac",
      size: 1,
      modifiedMs: 1,
      format: "FLAC",
      durationSeconds: 1,
      tags: {
        title: "Track",
        album: "Fixture Album",
        artist: "Fixture Artist",
        albumArtist: "Fixture Artist",
        trackNumber: 1,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [{ id: "PRIVATE", value: "not sent" }],
      scanError: null,
    },
  ],
};

describe("find album candidates", () => {
  it("loads only an explicitly selected release ID and returns a read-only tracklist", async () => {
    const lookupRelease = vi.fn(() =>
      Promise.resolve({
        source: "network" as const,
        fetchedAt: "2026-07-27T12:00:00.000Z",
        release: {
          releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
          title: "Fixture Album",
          tracks: [],
        },
      }),
    );
    const service = new FindAlbumCandidates(
      { getAlbum: () => album },
      { searchReleases: vi.fn(), lookupRelease },
    );
    await expect(
      service.release(album.id, "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef"),
    ).resolves.toMatchObject({
      albumId: album.id,
      readOnly: true,
      release: {
        releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
      },
    });
    expect(lookupRelease).toHaveBeenCalledWith(
      "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(lookupRelease.mock.calls)).not.toContain(
      "/private/not-sent.flac",
    );
  });

  it("derives the narrow provider request from the catalog and returns read-only comparison", async () => {
    const searchReleases = vi.fn(() =>
      Promise.resolve({
        source: "network" as const,
        fetchedAt: "2026-07-27T12:00:00.000Z",
        candidates: [
          {
            releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
            releaseGroupId: null,
            title: "Fixture Album",
            artistCredits: [
              {
                name: "Fixture Artist",
                joinPhrase: "",
                artistId: "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
              },
            ],
            date: "2026-04",
            country: "DE",
            status: "Official",
            trackCount: 1,
            catalogNumbers: [],
            musicBrainzScore: 100,
          },
        ],
      }),
    );
    const service = new FindAlbumCandidates(
      { getAlbum: () => album },
      { searchReleases, lookupRelease: vi.fn() },
    );

    await expect(service.search(album.id)).resolves.toMatchObject({
      albumId: album.id,
      sent: {
        albumTitle: "Fixture Album",
        albumArtist: "Fixture Artist",
      },
      readOnly: true,
      candidates: [{ confidence: "strong" }],
    });
    expect(searchReleases).toHaveBeenCalledWith(
      "Fixture Album",
      "Fixture Artist",
      expect.any(AbortSignal),
    );
    expect(JSON.stringify(searchReleases.mock.calls)).not.toContain(
      "/private/not-sent.flac",
    );
  });

  it("rejects missing albums before any provider call", async () => {
    const searchReleases = vi.fn();
    const service = new FindAlbumCandidates(
      { getAlbum: () => undefined },
      { searchReleases, lookupRelease: vi.fn() },
    );
    await expect(service.search(album.id)).rejects.toThrow(
      "no longer in the Library",
    );
    expect(searchReleases).not.toHaveBeenCalled();
  });

  it("cancels only an active search for the requested album", async () => {
    let signal: AbortSignal | undefined;
    const service = new FindAlbumCandidates(
      { getAlbum: () => album },
      {
        lookupRelease: vi.fn(),
        searchReleases: vi.fn(
          (_title: string, _artist: string, candidateSignal: AbortSignal) =>
            new Promise<never>((_resolve, reject) => {
              signal = candidateSignal;
              candidateSignal.addEventListener("abort", () =>
                reject(new DOMException("cancelled", "AbortError")),
              );
            }),
        ),
      },
    );
    const pending = service.search(album.id);
    expect(service.cancel(album.id)).toEqual({ cancelled: true });
    expect(signal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(service.cancel(album.id)).toEqual({ cancelled: false });
  });
});
