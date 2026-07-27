import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { MusicBrainzClient, type MusicBrainzCache } from "./musicbrainz-client";

const fixture = readFileSync(
  join(
    process.cwd(),
    "fixtures",
    "providers",
    "musicbrainz",
    "release-search.json",
  ),
  "utf8",
);
const releaseFixture = readFileSync(
  join(
    process.cwd(),
    "fixtures",
    "providers",
    "musicbrainz",
    "release-lookup.json",
  ),
  "utf8",
);
const artistFixture = readFileSync(
  join(
    process.cwd(),
    "fixtures",
    "providers",
    "musicbrainz",
    "artist-search.json",
  ),
  "utf8",
);

function cache(): MusicBrainzCache & {
  readonly records: Map<
    string,
    Parameters<MusicBrainzCache["putProviderCache"]>[0]
  >;
} {
  const records = new Map<
    string,
    Parameters<MusicBrainzCache["putProviderCache"]>[0]
  >();
  return {
    records,
    getProviderCache: (provider, key) => records.get(`${provider}:${key}`),
    putProviderCache: (record) =>
      records.set(`${record.provider}:${record.requestKey}`, record),
  };
}

describe("MusicBrainz release search adapter", () => {
  it("searches the fixed artist endpoint, maps ambiguous stable identities, and caches the validated response", async () => {
    const storage = cache();
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(new Response(artistFixture, { status: 200 })),
    );
    const client = new MusicBrainzClient(storage, "Outgroove/test", {
      fetch: fetchImplementation,
      now: () => Date.parse("2026-07-28T08:00:00Z"),
    });

    const result = await client.searchArtists(
      "Fixture Artist",
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      source: "network",
      candidates: [
        {
          artistId: "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
          name: "Fixture Artist",
          disambiguation: "German electronic duo",
          type: "Group",
          country: "DE",
          area: "Germany",
          score: 100,
        },
        {
          artistId: "16ffe2a4-14e9-4d25-a4db-c3a6370afacc",
          disambiguation: "Canadian solo artist",
        },
      ],
    });
    const [url, options] = (fetchImplementation.mock.calls[0] ??
      []) as unknown as [URL, RequestInit];
    expect(String(url)).toContain(
      "https://musicbrainz.org/ws/2/artist/?query=artist%3A%22Fixture+Artist%22",
    );
    expect(String(url)).toContain("limit=8");
    expect(String(url)).not.toContain("private");
    expect(options.headers).toMatchObject({
      "User-Agent": "Outgroove/test",
    });
    expect(storage.records.size).toBe(1);
  });

  it("uses the shared limiter for artist and release requests and falls back to validated stale artist cache", async () => {
    let time = 0;
    const sleep = vi.fn((milliseconds: number) => {
      time += milliseconds;
      return Promise.resolve();
    });
    const client = new MusicBrainzClient(cache(), "Outgroove/test", {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(new Response(artistFixture, { status: 200 }))
        .mockResolvedValueOnce(new Response(fixture, { status: 200 })),
      now: () => time,
      sleep,
    });
    await client.searchArtists("Artist", new AbortController().signal);
    await client.searchReleases(
      "Album",
      "Artist",
      new AbortController().signal,
    );
    expect(sleep).toHaveBeenCalledWith(1000, expect.any(AbortSignal));

    const storage = cache();
    storage.putProviderCache({
      provider: "musicbrainz",
      requestKey: JSON.stringify({ artistSearch: "Fixture Artist" }),
      responseSchemaVersion: 1,
      status: 200,
      fetchedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
      payloadJson: artistFixture,
    });
    const offline = new MusicBrainzClient(storage, "Outgroove/test", {
      fetch: vi.fn(() => Promise.reject(new Error("offline"))),
      now: () => Date.parse("2026-07-28T08:00:00Z"),
    });
    const stale = await offline.searchArtists(
      "Fixture Artist",
      new AbortController().signal,
    );
    expect(stale.source).toBe("stale-cache");
    expect(stale.candidates.map((candidate) => candidate.name)).toContain(
      "Fixture Artist",
    );
  });

  it("looks up a selected release through the fixed endpoint and preserves medium order and identities", async () => {
    const storage = cache();
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(new Response(releaseFixture, { status: 200 })),
    );
    const client = new MusicBrainzClient(storage, "Outgroove/test", {
      fetch: fetchImplementation,
      now: () => Date.parse("2026-07-27T12:00:00Z"),
    });

    const result = await client.lookupRelease(
      "2F3AD7A7-7D18-4F21-84EC-C5C3EAC2DEEF",
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      source: "network",
      release: {
        releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
        title: "Fixture Album",
        tracks: [
          {
            releaseTrackId: "11111111-1111-4111-8111-111111111111",
            recordingId: "22222222-2222-4222-8222-222222222222",
            discNumber: 1,
            discTotal: 2,
            trackNumber: 1,
            trackTotal: 1,
            title: "Remote First",
            isrcs: ["DEABC2600001"],
            lengthMs: 61000,
          },
          {
            discNumber: 2,
            discTotal: 2,
            trackNumber: 1,
            trackTotal: 1,
            artistCredits: [
              expect.objectContaining({ joinPhrase: " feat. " }),
              expect.objectContaining({ name: "Guest Artist" }),
            ],
            isrcs: ["DEABC2600002", "DEABC2600003"],
          },
        ],
      },
    });
    const [url, options] = (fetchImplementation.mock.calls[0] ??
      []) as unknown as [URL, RequestInit];
    expect(String(url)).toBe(
      "https://musicbrainz.org/ws/2/release/2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef?inc=recordings%2Bartist-credits%2Bisrcs&fmt=json",
    );
    expect(options.headers).toMatchObject({
      "User-Agent": "Outgroove/test",
    });
    expect(storage.records.size).toBe(1);
  });

  it("validates a release lookup and falls back to its stale cache without changing the requested identity", async () => {
    const storage = cache();
    const key = JSON.stringify({
      releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
    });
    storage.putProviderCache({
      provider: "musicbrainz",
      requestKey: key,
      responseSchemaVersion: 1,
      status: 200,
      fetchedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
      payloadJson: releaseFixture,
    });
    const client = new MusicBrainzClient(storage, "Outgroove/test", {
      fetch: vi.fn(() => Promise.reject(new Error("offline"))),
      now: () => Date.parse("2026-07-27T12:00:00Z"),
    });
    await expect(
      client.lookupRelease(
        "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      source: "stale-cache",
      release: {
        releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
      },
    });

    const mismatched = JSON.parse(releaseFixture) as Record<string, unknown>;
    mismatched.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const invalid = new MusicBrainzClient(cache(), "Outgroove/test", {
      fetch: vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(mismatched), { status: 200 }),
        ),
      ),
    });
    await expect(
      invalid.lookupRelease(
        "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
        new AbortController().signal,
      ),
    ).rejects.toThrow("different release");
  });

  it("uses a fixed endpoint and meaningful identity, validates, maps, and caches a fixture", async () => {
    const storage = cache();
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(
        new Response(fixture, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const client = new MusicBrainzClient(
      storage,
      "Outgroove/0.12.0 (https://github.com/leahfrom/outgroove)",
      {
        fetch: fetchImplementation,
        now: () => Date.parse("2026-07-27T12:00:00Z"),
      },
    );

    const result = await client.searchReleases(
      "Fixture Album",
      "Fixture Artist",
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      source: "network",
    });
    expect(result.candidates[0]).toMatchObject({
      title: "Fixture Album",
      artistCredits: [
        {
          name: "Fixture Artist",
          joinPhrase: "",
          artistId: "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
        },
      ],
      trackCount: 2,
      catalogNumbers: ["FIX-2026"],
    });
    const [url, options] = (fetchImplementation.mock.calls[0] ??
      []) as unknown as [URL, RequestInit];
    expect(String(url)).toMatch(
      /^https:\/\/musicbrainz\.org\/ws\/2\/release\//u,
    );
    expect(String(url)).toContain("limit=8");
    expect(String(url)).not.toContain("not-sent");
    expect(options.headers).toMatchObject({
      Accept: "application/json",
      "User-Agent": "Outgroove/0.12.0 (https://github.com/leahfrom/outgroove)",
    });
    expect(storage.records.size).toBe(1);
  });

  it("returns a fresh validated cache entry without network access", async () => {
    const storage = cache();
    const first = new MusicBrainzClient(storage, "Outgroove/test", {
      fetch: vi.fn(() =>
        Promise.resolve(new Response(fixture, { status: 200 })),
      ),
      now: () => 1000,
    });
    await first.searchReleases("Album", "Artist", new AbortController().signal);
    const fetchImplementation = vi.fn();
    const second = new MusicBrainzClient(storage, "Outgroove/test", {
      fetch: fetchImplementation,
      now: () => 2000,
    });
    await expect(
      second.searchReleases("Album", "Artist", new AbortController().signal),
    ).resolves.toMatchObject({ source: "cache" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("falls back to a stale valid cache when the network is unavailable", async () => {
    const storage = cache();
    const key = JSON.stringify({ artist: "Artist", title: "Album" });
    storage.putProviderCache({
      provider: "musicbrainz",
      requestKey: key,
      responseSchemaVersion: 1,
      status: 200,
      fetchedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-02T00:00:00.000Z",
      payloadJson: fixture,
    });
    const client = new MusicBrainzClient(storage, "Outgroove/test", {
      fetch: vi.fn(() => Promise.reject(new Error("offline"))),
      now: () => Date.parse("2026-07-27T12:00:00Z"),
    });
    await expect(
      client.searchReleases("Album", "Artist", new AbortController().signal),
    ).resolves.toMatchObject({ source: "stale-cache" });
  });

  it("retries throttling with bounded backoff and rejects malformed success payloads", async () => {
    let time = 0;
    const sleep = vi.fn((milliseconds: number) => {
      time += milliseconds;
      return Promise.resolve();
    });
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        new Response('{"releases":[{"id":"not-a-uuid"}]}', { status: 200 }),
      );
    const client = new MusicBrainzClient(cache(), "Outgroove/test", {
      fetch: fetchImplementation,
      now: () => time,
      sleep,
      random: () => 0,
    });
    await expect(
      client.searchReleases("Album", "Artist", new AbortController().signal),
    ).rejects.toThrow();
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000, expect.any(AbortSignal));
  });

  it("passes cancellation to the network request and does not cache it", async () => {
    const storage = cache();
    const fetchImplementation = vi.fn(
      (_url: string | URL | Request, options?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        }),
    );
    const client = new MusicBrainzClient(storage, "Outgroove/test", {
      fetch: fetchImplementation,
    });
    const controller = new AbortController();
    const pending = client.searchReleases("Album", "Artist", controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(storage.records.size).toBe(0);
  });
});
