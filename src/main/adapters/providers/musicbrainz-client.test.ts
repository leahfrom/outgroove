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
      artistCredit: "Fixture Artist",
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
