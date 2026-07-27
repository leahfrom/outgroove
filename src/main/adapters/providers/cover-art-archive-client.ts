import { z } from "zod";

import { validatedArtworkInfo } from "../artwork/artwork-image-shape";

const provider = "coverartarchive";
const responseSchemaVersion = 1;
const cacheLifetimeMs = 24 * 60 * 60 * 1000;
const maxMetadataBytes = 2_000_000;
const maxThumbnailBytes = 2 * 1024 * 1024;
const maxOriginalArtworkBytes = 8 * 1024 * 1024;
const maxRedirects = 4;
const maxMemoryThumbnails = 8;
const maxRetryDelayMs = 30_000;

const artworkIdSchema = z.union([
  z.string().regex(/^\d+$/u).max(32),
  z.number().int().nonnegative().transform(String),
]);

const coverArtArchiveResponseSchema = z
  .object({
    release: z.url().max(2000),
    images: z
      .array(
        z
          .object({
            id: artworkIdSchema,
            types: z.array(z.string().max(100)).max(20),
            front: z.boolean(),
            back: z.boolean(),
            approved: z.boolean(),
            comment: z.string().max(2000),
            image: z.url().max(2000),
          })
          .loose(),
      )
      .max(100),
  })
  .loose();

export interface CoverArtArchiveCache {
  getProviderCache(
    provider: string,
    requestKey: string,
  ):
    | {
        readonly responseSchemaVersion: number;
        readonly status: number;
        readonly fetchedAt: string;
        readonly expiresAt: string;
        readonly payloadJson: string;
      }
    | undefined;
  putProviderCache(record: {
    readonly provider: string;
    readonly requestKey: string;
    readonly responseSchemaVersion: number;
    readonly status: number;
    readonly fetchedAt: string;
    readonly expiresAt: string;
    readonly payloadJson: string;
  }): void;
}

export interface CoverArtArchiveArtwork {
  readonly id: string;
  readonly types: readonly string[];
  readonly front: boolean;
  readonly back: boolean;
  readonly approved: boolean;
  readonly comment: string | null;
  readonly originalExtension: "jpg" | "jpeg" | "png";
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly mimeType: "image/jpeg" | "image/png";
}

export interface CoverArtArchiveResult {
  readonly artwork: CoverArtArchiveArtwork | null;
  readonly source: "network" | "cache" | "stale-cache";
  readonly fetchedAt: string;
}

interface Options {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

interface CachedMetadata {
  readonly artwork: {
    readonly id: string;
    readonly types: readonly string[];
    readonly front: boolean;
    readonly back: boolean;
    readonly approved: boolean;
    readonly comment: string | null;
    readonly originalExtension: "jpg" | "jpeg" | "png";
  } | null;
  readonly fetchedAt: string;
  readonly expired: boolean;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(
          new DOMException(
            "The Cover Art Archive request was cancelled.",
            "AbortError",
          ),
        );
      },
      { once: true },
    );
  });
}

function requestKey(releaseId: string): string {
  return JSON.stringify({ releaseId });
}

function releaseUrl(releaseId: string): URL {
  return new URL(
    `https://coverartarchive.org/release/${encodeURIComponent(releaseId)}`,
  );
}

function thumbnailUrl(
  releaseId: string,
  artworkId: string,
  size: 250 | 500,
): URL {
  return new URL(
    `https://coverartarchive.org/release/${encodeURIComponent(releaseId)}/${encodeURIComponent(artworkId)}-${size}.jpg`,
  );
}

function originalArtworkUrl(
  releaseId: string,
  artworkId: string,
  extension: CoverArtArchiveArtwork["originalExtension"],
): URL {
  return new URL(
    `https://coverartarchive.org/release/${encodeURIComponent(releaseId)}/${encodeURIComponent(artworkId)}.${extension}`,
  );
}

function isAllowedProviderUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "coverartarchive.org" ||
      url.hostname === "archive.org" ||
      url.hostname.endsWith(".archive.org"))
  );
}

function responseReleaseId(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "musicbrainz.org" &&
        !url.hostname.endsWith(".musicbrainz.org"))
    )
      return undefined;
    const parts = url.pathname.split("/").filter(Boolean);
    const releaseIndex = parts.lastIndexOf("release");
    return releaseIndex >= 0
      ? parts[releaseIndex + 1]?.toLowerCase()
      : undefined;
  } catch {
    return undefined;
  }
}

async function readBoundedBody(
  response: Response,
  maximum: number,
  tooLargeMessage: string,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximum)
    throw new Error(tooLargeMessage);
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maximum) {
      await reader.cancel();
      throw new Error(tooLargeMessage);
    }
    chunks.push(chunk.value);
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

function primaryFront(
  payload: z.infer<typeof coverArtArchiveResponseSchema>,
): CachedMetadata["artwork"] {
  const image = payload.images.find((candidate) => candidate.front);
  if (!image) return null;
  const originalExtension = originalImageExtension(
    image.image,
    responseReleaseId(payload.release),
    image.id,
  );
  if (!originalExtension)
    throw new Error(
      "Cover Art Archive returned an unsafe original-image identity.",
    );
  return {
    id: image.id,
    types: image.types,
    front: image.front,
    back: image.back,
    approved: image.approved,
    comment: image.comment.trim() || null,
    originalExtension,
  };
}

function originalImageExtension(
  value: string,
  releaseId: string | undefined,
  artworkId: string,
): CoverArtArchiveArtwork["originalExtension"] | undefined {
  if (!releaseId) return;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.hostname !== "coverartarchive.org"
    )
      return;
    const match = /^\/release\/([^/]+)\/(\d+)\.(jpg|jpeg|png)$/iu.exec(
      url.pathname,
    );
    if (match?.[1]?.toLowerCase() !== releaseId || match[2] !== artworkId)
      return;
    const extension = match[3]?.toLowerCase();
    return extension === "jpg" || extension === "jpeg" || extension === "png"
      ? extension
      : undefined;
  } catch {
    return;
  }
}

export class CoverArtArchiveClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;
  private readonly random: () => number;
  private readonly inFlight = new Map<string, Promise<CoverArtArchiveResult>>();
  private readonly thumbnails = new Map<
    string,
    Omit<
      CoverArtArchiveArtwork,
      | "id"
      | "types"
      | "front"
      | "back"
      | "approved"
      | "comment"
      | "originalExtension"
    >
  >();

  constructor(
    private readonly cache: CoverArtArchiveCache,
    private readonly userAgent: string,
    options: Options = {},
  ) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? wait;
    this.random = options.random ?? Math.random;
  }

  loadFrontArtwork(
    releaseId: string,
    signal: AbortSignal,
  ): Promise<CoverArtArchiveResult> {
    const normalizedId = releaseId.toLowerCase();
    const existing = this.inFlight.get(normalizedId);
    if (existing) return existing;
    const pending = this.execute(normalizedId, signal).finally(() =>
      this.inFlight.delete(normalizedId),
    );
    this.inFlight.set(normalizedId, pending);
    return pending;
  }

  async loadOriginalFrontArtwork(
    releaseId: string,
    expectedArtworkId: string,
    signal: AbortSignal,
  ): Promise<CoverArtArchiveArtwork> {
    const normalizedId = releaseId.toLowerCase();
    const preview = await this.loadFrontArtwork(normalizedId, signal);
    if (!preview.artwork)
      throw new Error(
        "This release no longer has a front cover in the Cover Art Archive.",
      );
    if (preview.artwork.id !== expectedArtworkId)
      throw new Error(
        "The release front cover changed after it was displayed. Load it again before preparing a replacement.",
      );
    const response = await this.performRequest(
      originalArtworkUrl(
        normalizedId,
        expectedArtworkId,
        preview.artwork.originalExtension,
      ),
      "image/jpeg, image/png",
      signal,
    );
    if (!response.ok)
      throw new Error(
        `Cover Art Archive original image returned HTTP ${response.status}. Try again later.`,
      );
    const data = await readBoundedBody(
      response,
      maxOriginalArtworkBytes,
      "The Cover Art Archive original image exceeds Outgroove's 8 MiB artwork limit.",
    );
    const info = validatedArtworkInfo(data);
    if (!info)
      throw new Error(
        "Cover Art Archive returned an invalid or unsafe original JPEG/PNG image.",
      );
    return {
      ...preview.artwork,
      data,
      width: info.width,
      height: info.height,
      mimeType: info.mimeType,
    };
  }

  private async execute(
    releaseId: string,
    signal: AbortSignal,
  ): Promise<CoverArtArchiveResult> {
    const cached = this.readCachedMetadata(releaseId);
    let metadata:
      | (CachedMetadata & {
          readonly source: "network" | "cache" | "stale-cache";
        })
      | undefined;
    if (cached && !cached.expired) metadata = { ...cached, source: "cache" };
    else {
      try {
        metadata = await this.fetchMetadata(releaseId, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        if (cached) metadata = { ...cached, source: "stale-cache" };
        else throw error;
      }
    }
    if (!metadata.artwork)
      return {
        artwork: null,
        source: metadata.source,
        fetchedAt: metadata.fetchedAt,
      };

    const thumbnailKey = `${releaseId}:${metadata.artwork.id}`;
    const existingThumbnail = this.thumbnails.get(thumbnailKey);
    const thumbnail =
      existingThumbnail ??
      (await this.fetchThumbnail(releaseId, metadata.artwork.id, signal));
    if (!existingThumbnail) this.rememberThumbnail(thumbnailKey, thumbnail);
    return {
      artwork: {
        ...metadata.artwork,
        ...thumbnail,
      },
      source: existingThumbnail ? metadata.source : "network",
      fetchedAt: existingThumbnail
        ? metadata.fetchedAt
        : new Date(this.now()).toISOString(),
    };
  }

  private readCachedMetadata(releaseId: string): CachedMetadata | undefined {
    const cached = this.cache.getProviderCache(provider, requestKey(releaseId));
    if (cached?.responseSchemaVersion !== responseSchemaVersion) return;
    const expired = Date.parse(cached.expiresAt) <= this.now();
    if (cached.status === 404)
      return { artwork: null, fetchedAt: cached.fetchedAt, expired };
    if (cached.status !== 200) return;
    let payload: unknown;
    try {
      payload = JSON.parse(cached.payloadJson) as unknown;
    } catch {
      return;
    }
    const parsed = coverArtArchiveResponseSchema.safeParse(payload);
    if (!parsed.success || responseReleaseId(parsed.data.release) !== releaseId)
      return;
    try {
      return {
        artwork: primaryFront(parsed.data),
        fetchedAt: cached.fetchedAt,
        expired,
      };
    } catch {
      return;
    }
  }

  private async fetchMetadata(
    releaseId: string,
    signal: AbortSignal,
  ): Promise<CachedMetadata & { readonly source: "network" }> {
    const response = await this.performRequest(
      releaseUrl(releaseId),
      "application/json",
      signal,
    );
    const fetchedAt = new Date(this.now()).toISOString();
    if (response.status === 404) {
      this.cacheResponse(releaseId, 404, fetchedAt, "");
      return {
        artwork: null,
        fetchedAt,
        expired: false,
        source: "network",
      };
    }
    if (!response.ok)
      throw new Error(
        `Cover Art Archive returned HTTP ${response.status}. Try again later.`,
      );
    const data = await readBoundedBody(
      response,
      maxMetadataBytes,
      "Cover Art Archive returned unexpectedly large metadata.",
    );
    const rawPayload = new TextDecoder().decode(data);
    const payload = coverArtArchiveResponseSchema.parse(
      JSON.parse(rawPayload) as unknown,
    );
    if (responseReleaseId(payload.release) !== releaseId)
      throw new Error("Cover Art Archive returned a different release.");
    this.cacheResponse(releaseId, response.status, fetchedAt, rawPayload);
    return {
      artwork: primaryFront(payload),
      fetchedAt,
      expired: false,
      source: "network",
    };
  }

  private async fetchThumbnail(
    releaseId: string,
    artworkId: string,
    signal: AbortSignal,
  ): Promise<
    Omit<
      CoverArtArchiveArtwork,
      | "id"
      | "types"
      | "front"
      | "back"
      | "approved"
      | "comment"
      | "originalExtension"
    >
  > {
    let response = await this.performRequest(
      thumbnailUrl(releaseId, artworkId, 500),
      "image/jpeg, image/png",
      signal,
    );
    if (response.status === 404)
      response = await this.performRequest(
        thumbnailUrl(releaseId, artworkId, 250),
        "image/jpeg, image/png",
        signal,
      );
    if (!response.ok)
      throw new Error(
        `Cover Art Archive thumbnail returned HTTP ${response.status}. Try again later.`,
      );
    const data = await readBoundedBody(
      response,
      maxThumbnailBytes,
      "Cover Art Archive returned an unexpectedly large thumbnail.",
    );
    const info = validatedArtworkInfo(data);
    if (!info)
      throw new Error(
        "Cover Art Archive returned an invalid or unsafe JPEG/PNG thumbnail.",
      );
    return {
      data,
      width: info.width,
      height: info.height,
      mimeType: info.mimeType,
    };
  }

  private async performRequest(
    initialUrl: URL,
    accept: string,
    signal: AbortSignal,
  ): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let url = initialUrl;
      for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
        const response = await this.fetchImplementation(url, {
          headers: { Accept: accept, "User-Agent": this.userAgent },
          redirect: "manual",
          signal,
        });
        if (
          response.status >= 300 &&
          response.status < 400 &&
          response.headers.has("location")
        ) {
          if (redirects === maxRedirects)
            throw new Error("Cover Art Archive redirected too many times.");
          const next = new URL(response.headers.get("location") ?? "", url);
          if (!isAllowedProviderUrl(next))
            throw new Error(
              "Cover Art Archive redirected outside its approved archive hosts.",
            );
          url = next;
          continue;
        }
        if (response.status === 503 && attempt < 2) {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfter = Number(retryAfterHeader);
          const retryAfterMilliseconds = retryAfter * 1000;
          const delay =
            retryAfterHeader !== null &&
            Number.isFinite(retryAfterMilliseconds) &&
            retryAfterMilliseconds >= 0
              ? Math.min(retryAfterMilliseconds, maxRetryDelayMs)
              : 1000 * 2 ** attempt + Math.floor(this.random() * 250);
          await this.sleep(delay, signal);
          break;
        }
        return response;
      }
    }
    throw new Error("Cover Art Archive did not accept the request.");
  }

  private cacheResponse(
    releaseId: string,
    status: number,
    fetchedAt: string,
    payloadJson: string,
  ): void {
    this.cache.putProviderCache({
      provider,
      requestKey: requestKey(releaseId),
      responseSchemaVersion,
      status,
      fetchedAt,
      expiresAt: new Date(this.now() + cacheLifetimeMs).toISOString(),
      payloadJson,
    });
  }

  private rememberThumbnail(
    key: string,
    thumbnail: Omit<
      CoverArtArchiveArtwork,
      | "id"
      | "types"
      | "front"
      | "back"
      | "approved"
      | "comment"
      | "originalExtension"
    >,
  ): void {
    this.thumbnails.delete(key);
    this.thumbnails.set(key, thumbnail);
    while (this.thumbnails.size > maxMemoryThumbnails) {
      const oldest = this.thumbnails.keys().next().value;
      if (!oldest) break;
      this.thumbnails.delete(oldest);
    }
  }
}
