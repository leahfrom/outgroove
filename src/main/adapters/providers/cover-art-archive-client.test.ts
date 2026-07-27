import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  CoverArtArchiveClient,
  type CoverArtArchiveCache,
} from "./cover-art-archive-client";

const releaseId = "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef";
const fixture = readFileSync(
  join(
    process.cwd(),
    "fixtures",
    "providers",
    "cover-art-archive",
    "release.json",
  ),
  "utf8",
);
const thumbnail = Buffer.from(
  readFileSync(
    join(
      process.cwd(),
      "fixtures",
      "providers",
      "cover-art-archive",
      "front-500.png.base64",
    ),
    "utf8",
  ).trim(),
  "base64",
);

function cache(): CoverArtArchiveCache & {
  readonly records: Map<
    string,
    Parameters<CoverArtArchiveCache["putProviderCache"]>[0]
  >;
} {
  const records = new Map<
    string,
    Parameters<CoverArtArchiveCache["putProviderCache"]>[0]
  >();
  return {
    records,
    getProviderCache: (provider, key) => records.get(`${provider}:${key}`),
    putProviderCache: (record) =>
      records.set(`${record.provider}:${record.requestKey}`, record),
  };
}

describe("Cover Art Archive adapter", () => {
  it("loads only the selected release's validated front thumbnail through fixed and approved hosts", async () => {
    const storage = cache();
    const fetchImplementation = vi.fn(
      (input: string | URL | Request, options?: RequestInit) => {
        void options;
        const url = input instanceof Request ? input.url : input.toString();
        if (url === `https://coverartarchive.org/release/${releaseId}`)
          return Promise.resolve(
            new Response(null, {
              status: 307,
              headers: {
                location:
                  "https://archive.org/download/mbid-fixture/index.json",
              },
            }),
          );
        if (url.endsWith("index.json"))
          return Promise.resolve(new Response(fixture, { status: 200 }));
        if (url.endsWith("829521842-500.jpg"))
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: {
                location:
                  "https://ia801.example.archive.org/download/mbid-fixture/front.png",
              },
            }),
          );
        return Promise.resolve(new Response(thumbnail, { status: 200 }));
      },
    );
    const client = new CoverArtArchiveClient(storage, "Outgroove/test", {
      fetch: fetchImplementation,
      now: () => Date.parse("2026-07-27T12:00:00Z"),
    });

    await expect(
      client.loadFrontArtwork(
        releaseId.toUpperCase(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      source: "network",
      artwork: {
        id: "829521842",
        types: ["Front"],
        front: true,
        approved: true,
        comment: "Exact fixture edition",
        width: 1,
        height: 1,
        mimeType: "image/png",
      },
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    const options = fetchImplementation.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      redirect: "manual",
      headers: {
        Accept: "application/json",
        "User-Agent": "Outgroove/test",
      },
    });
    expect(JSON.stringify(fetchImplementation.mock.calls)).not.toContain(
      "not-sent",
    );
    expect(storage.records.size).toBe(1);

    await expect(
      client.loadOriginalFrontArtwork(
        releaseId,
        "829521842",
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      id: "829521842",
      width: 1,
      height: 1,
      mimeType: "image/png",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
    expect(
      fetchImplementation.mock.calls.map(([input]) =>
        input instanceof Request ? input.url : input.toString(),
      ),
    ).toContain(
      `https://coverartarchive.org/release/${releaseId}/829521842.jpg`,
    );
    await expect(
      client.loadOriginalFrontArtwork(
        releaseId,
        "999999999",
        new AbortController().signal,
      ),
    ).rejects.toThrow("changed after it was displayed");
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  it("uses fresh metadata and bounded in-memory thumbnail caches without another request", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(new Response(fixture, { status: 200 }))
      .mockResolvedValueOnce(new Response(thumbnail, { status: 200 }));
    const client = new CoverArtArchiveClient(cache(), "Outgroove/test", {
      fetch: fetchImplementation,
      now: () => 1000,
    });
    await client.loadFrontArtwork(releaseId, new AbortController().signal);
    await expect(
      client.loadFrontArtwork(releaseId, new AbortController().signal),
    ).resolves.toMatchObject({ source: "cache" });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("caches a missing cover and never infers another release or release-group image", async () => {
    const storage = cache();
    const firstFetch = vi.fn(() =>
      Promise.resolve(new Response("", { status: 404 })),
    );
    const first = new CoverArtArchiveClient(storage, "Outgroove/test", {
      fetch: firstFetch,
      now: () => 1000,
    });
    await expect(
      first.loadFrontArtwork(releaseId, new AbortController().signal),
    ).resolves.toMatchObject({ source: "network", artwork: null });

    const secondFetch = vi.fn();
    const second = new CoverArtArchiveClient(storage, "Outgroove/test", {
      fetch: secondFetch,
      now: () => 2000,
    });
    await expect(
      second.loadFrontArtwork(releaseId, new AbortController().signal),
    ).resolves.toMatchObject({ source: "cache", artwork: null });
    expect(firstFetch).toHaveBeenCalledOnce();
    expect(secondFetch).not.toHaveBeenCalled();
  });

  it("rejects mismatched releases, unsafe redirects, invalid images, and oversized bodies", async () => {
    const mismatched = JSON.parse(fixture) as {
      release: string;
    };
    mismatched.release =
      "https://musicbrainz.org/release/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const mismatchClient = new CoverArtArchiveClient(
      cache(),
      "Outgroove/test",
      {
        fetch: vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mismatched), { status: 200 }),
          ),
        ),
      },
    );
    await expect(
      mismatchClient.loadFrontArtwork(releaseId, new AbortController().signal),
    ).rejects.toThrow("different release");

    const unsafeOriginal = JSON.parse(fixture) as {
      images: { image: string }[];
    };
    const firstImage = unsafeOriginal.images[0];
    if (!firstImage) throw new Error("Cover fixture image missing");
    firstImage.image = "https://example.com/private.png";
    const unsafeOriginalClient = new CoverArtArchiveClient(
      cache(),
      "Outgroove/test",
      {
        fetch: vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(unsafeOriginal), { status: 200 }),
          ),
        ),
      },
    );
    await expect(
      unsafeOriginalClient.loadFrontArtwork(
        releaseId,
        new AbortController().signal,
      ),
    ).rejects.toThrow("unsafe original-image identity");

    const redirectClient = new CoverArtArchiveClient(
      cache(),
      "Outgroove/test",
      {
        fetch: vi.fn(() =>
          Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: "https://example.com/private" },
            }),
          ),
        ),
      },
    );
    await expect(
      redirectClient.loadFrontArtwork(releaseId, new AbortController().signal),
    ).rejects.toThrow("outside its approved archive hosts");

    const invalidImageClient = new CoverArtArchiveClient(
      cache(),
      "Outgroove/test",
      {
        fetch: vi
          .fn()
          .mockResolvedValueOnce(new Response(fixture, { status: 200 }))
          .mockResolvedValueOnce(new Response("not an image", { status: 200 })),
      },
    );
    await expect(
      invalidImageClient.loadFrontArtwork(
        releaseId,
        new AbortController().signal,
      ),
    ).rejects.toThrow("invalid or unsafe");

    const oversizedClient = new CoverArtArchiveClient(
      cache(),
      "Outgroove/test",
      {
        fetch: vi.fn(() =>
          Promise.resolve(
            new Response("", {
              status: 200,
              headers: { "content-length": "2000001" },
            }),
          ),
        ),
      },
    );
    await expect(
      oversizedClient.loadFrontArtwork(releaseId, new AbortController().signal),
    ).rejects.toThrow("unexpectedly large metadata");
  });

  it("bounds and validates the exact original image independently of its thumbnail", async () => {
    const oversized = new CoverArtArchiveClient(cache(), "Outgroove/test", {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(new Response(fixture, { status: 200 }))
        .mockResolvedValueOnce(new Response(thumbnail, { status: 200 }))
        .mockResolvedValueOnce(
          new Response("", {
            status: 200,
            headers: { "content-length": String(8 * 1024 * 1024 + 1) },
          }),
        ),
    });
    await oversized.loadFrontArtwork(releaseId, new AbortController().signal);
    await expect(
      oversized.loadOriginalFrontArtwork(
        releaseId,
        "829521842",
        new AbortController().signal,
      ),
    ).rejects.toThrow("exceeds Outgroove's 8 MiB artwork limit");

    const invalid = new CoverArtArchiveClient(cache(), "Outgroove/test", {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(new Response(fixture, { status: 200 }))
        .mockResolvedValueOnce(new Response(thumbnail, { status: 200 }))
        .mockResolvedValueOnce(
          new Response("not an original image", { status: 200 }),
        ),
    });
    await invalid.loadFrontArtwork(releaseId, new AbortController().signal);
    await expect(
      invalid.loadOriginalFrontArtwork(
        releaseId,
        "829521842",
        new AbortController().signal,
      ),
    ).rejects.toThrow("invalid or unsafe original");
  });

  it("retries temporary refusal with bounded delay and preserves cancellation", async () => {
    const controller = new AbortController();
    const sleep = vi.fn((_milliseconds: number, signal: AbortSignal) => {
      controller.abort();
      return Promise.reject(
        new DOMException(
          signal.aborted ? "cancelled" : "unexpected",
          "AbortError",
        ),
      );
    });
    const client = new CoverArtArchiveClient(cache(), "Outgroove/test", {
      fetch: vi.fn(() => Promise.resolve(new Response("", { status: 503 }))),
      sleep,
      random: () => 0,
    });
    await expect(
      client.loadFrontArtwork(releaseId, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(sleep).toHaveBeenCalledWith(1000, controller.signal);
    expect(controller.signal.aborted).toBe(true);
  });

  it("caps a provider-supplied retry delay before retrying successfully", async () => {
    const sleep = vi.fn(() => Promise.resolve());
    const client = new CoverArtArchiveClient(cache(), "Outgroove/test", {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
          new Response("", {
            status: 503,
            headers: { "retry-after": "999" },
          }),
        )
        .mockResolvedValueOnce(new Response(fixture, { status: 200 }))
        .mockResolvedValueOnce(new Response(thumbnail, { status: 200 })),
      sleep,
    });

    await expect(
      client.loadFrontArtwork(releaseId, new AbortController().signal),
    ).resolves.toMatchObject({ artwork: { id: "829521842" } });
    expect(sleep).toHaveBeenCalledWith(30_000, expect.any(AbortSignal));
  });
});
