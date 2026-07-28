import { describe, expect, it, vi } from "vitest";

import { AcoustIdClient, type AcoustIdCache } from "./acoustid-client";

const apiKey = "fixture_application_key";
const fingerprint = "AQAAS8kSSUmiKBIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const response = {
  status: "ok",
  results: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      score: 0.98,
      recordings: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          title: "Fixture Track",
          duration: 12,
          artists: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "Fixture Artist",
            },
          ],
          releasegroups: [
            {
              id: "44444444-4444-4444-8444-444444444444",
              title: "Fixture Album",
              type: "Album",
            },
          ],
        },
      ],
    },
  ],
};

function cache(): AcoustIdCache {
  const records = new Map<
    string,
    Parameters<AcoustIdCache["putProviderCache"]>[0]
  >();
  return {
    getProviderCache: (provider, requestKey) =>
      records.get(`${provider}:${requestKey}`),
    putProviderCache: (record) => {
      records.set(`${record.provider}:${record.requestKey}`, record);
    },
  };
}

describe("AcoustIdClient", () => {
  it("sends only the documented fingerprint lookup fields and validates candidates", async () => {
    const fetchImplementation = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Outgroove/test",
        });
        const requestBody = init?.body;
        expect(requestBody).toBeInstanceOf(URLSearchParams);
        if (!(requestBody instanceof URLSearchParams))
          throw new Error("Expected a URL-encoded AcoustID request.");
        const form = new URLSearchParams(requestBody.toString());
        expect(Object.fromEntries(form)).toEqual({
          client: apiKey,
          duration: "12",
          fingerprint,
          format: "json",
          meta: "recordings releasegroups compress",
        });
        expect(form.has("path")).toBe(false);
        expect(form.has("title")).toBe(false);
        return Promise.resolve(
          new Response(JSON.stringify(response), { status: 200 }),
        );
      },
    ) as typeof fetch;
    const result = await new AcoustIdClient(cache(), apiKey, "Outgroove/test", {
      fetch: fetchImplementation,
      now: () => 1_000,
    }).lookup(fingerprint, 12, new AbortController().signal);

    expect(result).toMatchObject({
      source: "network",
      candidates: [
        {
          acoustId: "11111111-1111-4111-8111-111111111111",
          recordingId: "22222222-2222-4222-8222-222222222222",
          title: "Fixture Track",
          score: 0.98,
          artists: [{ name: "Fixture Artist" }],
          releaseGroups: [{ title: "Fixture Album", type: "Album" }],
        },
      ],
    });
  });

  it("uses a fingerprint-hash cache key and falls back honestly to stale data", async () => {
    const storage = cache();
    const online = new AcoustIdClient(storage, apiKey, "Outgroove/test", {
      fetch: vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify(response))),
      ),
      now: () => 1_000,
    });
    await online.lookup(fingerprint, 12, new AbortController().signal);

    const freshFetch = vi.fn();
    const fresh = new AcoustIdClient(storage, apiKey, "Outgroove/test", {
      fetch: freshFetch,
      now: () => 2_000,
    });
    await expect(
      fresh.lookup(fingerprint, 12, new AbortController().signal),
    ).resolves.toMatchObject({ source: "cache" });
    expect(freshFetch).not.toHaveBeenCalled();

    const offline = new AcoustIdClient(storage, apiKey, "Outgroove/test", {
      fetch: vi.fn(() => Promise.reject(new Error("offline"))),
      now: () => 1_000 + 25 * 60 * 60 * 1000,
    });
    await expect(
      offline.lookup(fingerprint, 12, new AbortController().signal),
    ).resolves.toMatchObject({ source: "stale-cache" });
  });

  it("refuses missing application identity and invalid provider responses", async () => {
    const fetchImplementation = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ status: "ok", results: [{ score: 2 }] })),
      ),
    ) as typeof fetch;
    await expect(
      new AcoustIdClient(cache(), undefined, "Outgroove/test", {
        fetch: fetchImplementation,
      }).lookup(fingerprint, 12, new AbortController().signal),
    ).rejects.toThrow("no registered application key");
    expect(fetchImplementation).not.toHaveBeenCalled();

    await expect(
      new AcoustIdClient(cache(), apiKey, "Outgroove/test", {
        fetch: fetchImplementation,
      }).lookup(fingerprint, 12, new AbortController().signal),
    ).rejects.toThrow("invalid response");
  });

  it("stops reading provider responses above the byte limit", async () => {
    const oversizedResponse = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(750_000).fill(65));
          controller.enqueue(new Uint8Array(250_001).fill(65));
          controller.close();
        },
      }),
      { status: 200 },
    );
    await expect(
      new AcoustIdClient(cache(), apiKey, "Outgroove/test", {
        fetch: vi.fn(() => Promise.resolve(oversizedResponse)),
      }).lookup(fingerprint, 12, new AbortController().signal),
    ).rejects.toThrow("unexpectedly large response");
  });

  it("bounds retries and honors the separate request-start limiter", async () => {
    let now = 1_000;
    const sleeps: number[] = [];
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(response)));
    const client = new AcoustIdClient(cache(), apiKey, "Outgroove/test", {
      fetch: fetchImplementation,
      now: () => now,
      random: () => 0,
      sleep: (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    });
    await client.lookup(fingerprint, 12, new AbortController().signal);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(sleeps).toContain(1_000);
    expect(sleeps.every((delay) => delay >= 334)).toBe(true);
  });
});
