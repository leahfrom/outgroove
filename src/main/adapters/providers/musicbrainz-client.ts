import { z } from "zod";

import type { AlbumIdentificationCandidate } from "../../../shared/domain/album-identification";

const responseSchemaVersion = 1;
const provider = "musicbrainz";
const cacheLifetimeMs = 24 * 60 * 60 * 1000;

const musicBrainzResponseSchema = z
  .object({
    releases: z
      .array(
        z
          .object({
            id: z.uuid(),
            score: z.number().int().min(0).max(100).optional(),
            title: z.string().max(1000),
            status: z.string().max(100).nullable().optional(),
            date: z.string().max(32).nullable().optional(),
            country: z.string().max(10).nullable().optional(),
            barcode: z.string().max(100).nullable().optional(),
            "artist-credit": z
              .array(
                z
                  .object({
                    name: z.string().max(1000),
                    joinphrase: z.string().max(100).optional(),
                    artist: z
                      .object({
                        id: z.uuid(),
                      })
                      .loose()
                      .optional(),
                  })
                  .loose(),
              )
              .max(100)
              .optional(),
            "release-group": z.object({ id: z.uuid() }).loose().optional(),
            media: z
              .array(
                z
                  .object({
                    "track-count": z.number().int().nonnegative().optional(),
                  })
                  .loose(),
              )
              .max(100)
              .optional(),
            "label-info": z
              .array(
                z
                  .object({
                    "catalog-number": z
                      .string()
                      .max(1000)
                      .nullable()
                      .optional(),
                  })
                  .loose(),
              )
              .max(100)
              .optional(),
          })
          .loose(),
      )
      .max(8)
      .default([]),
  })
  .loose();

export interface MusicBrainzCache {
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

export interface MusicBrainzSearchResult {
  readonly candidates: readonly AlbumIdentificationCandidate[];
  readonly source: "network" | "cache" | "stale-cache";
  readonly fetchedAt: string;
}

interface Options {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly random?: () => number;
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
            "The MusicBrainz search was cancelled.",
            "AbortError",
          ),
        );
      },
      { once: true },
    );
  });
}

function lucenePhrase(value: string): string {
  return `"${value.replace(/([+&|!(){}[\]^"~*?:\\/])/gu, "\\$1")}"`;
}

function requestKey(title: string, artist: string): string {
  return JSON.stringify({
    artist: artist.normalize("NFC").trim(),
    title: title.normalize("NFC").trim(),
  });
}

function mapResponse(
  payload: z.infer<typeof musicBrainzResponseSchema>,
): readonly AlbumIdentificationCandidate[] {
  return payload.releases.slice(0, 8).map((release) => ({
    releaseId: release.id.toLocaleLowerCase("en-US"),
    releaseGroupId:
      release["release-group"]?.id.toLocaleLowerCase("en-US") ?? null,
    title: release.title,
    artistCredits:
      release["artist-credit"]?.map((credit) => ({
        name: credit.name,
        joinPhrase: credit.joinphrase ?? "",
        artistId: credit.artist?.id.toLocaleLowerCase("en-US") ?? null,
      })) ?? [],
    date: release.date ?? null,
    country: release.country ?? null,
    status: release.status ?? null,
    trackCount:
      release.media?.reduce(
        (total, medium) => total + (medium["track-count"] ?? 0),
        0,
      ) ?? null,
    catalogNumbers: [
      ...new Set(
        (release["label-info"] ?? []).flatMap((label) =>
          label["catalog-number"] ? [label["catalog-number"]] : [],
        ),
      ),
    ],
    musicBrainzScore: release.score ?? 0,
  }));
}

export class MusicBrainzClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;
  private readonly random: () => number;
  private readonly inFlight = new Map<
    string,
    Promise<MusicBrainzSearchResult>
  >();
  private nextRequestAt = 0;

  constructor(
    private readonly cache: MusicBrainzCache,
    private readonly userAgent: string,
    options: Options = {},
  ) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? wait;
    this.random = options.random ?? Math.random;
  }

  searchReleases(
    title: string,
    artist: string,
    signal: AbortSignal,
  ): Promise<MusicBrainzSearchResult> {
    const key = requestKey(title, artist);
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const pending = this.executeSearch(key, title, artist, signal).finally(() =>
      this.inFlight.delete(key),
    );
    this.inFlight.set(key, pending);
    return pending;
  }

  private readCached(
    key: string,
  ): (MusicBrainzSearchResult & { readonly expired: boolean }) | undefined {
    const cached = this.cache.getProviderCache(provider, key);
    if (
      cached?.status !== 200 ||
      cached.responseSchemaVersion !== responseSchemaVersion
    )
      return undefined;
    let payload: unknown;
    try {
      payload = JSON.parse(cached.payloadJson) as unknown;
    } catch {
      return undefined;
    }
    const parsed = musicBrainzResponseSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    return {
      candidates: mapResponse(parsed.data),
      source: "cache",
      fetchedAt: cached.fetchedAt,
      expired: Date.parse(cached.expiresAt) <= this.now(),
    };
  }

  private async executeSearch(
    key: string,
    title: string,
    artist: string,
    signal: AbortSignal,
  ): Promise<MusicBrainzSearchResult> {
    const cached = this.readCached(key);
    if (cached && !cached.expired) return cached;
    const query = `release:${lucenePhrase(title)} AND artist:${lucenePhrase(artist)}`;
    const url = new URL("https://musicbrainz.org/ws/2/release/");
    url.searchParams.set("query", query);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "8");

    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const limiterDelay = Math.max(0, this.nextRequestAt - this.now());
        if (limiterDelay > 0) await this.sleep(limiterDelay, signal);
        this.nextRequestAt = this.now() + 1000;
        const response = await this.fetchImplementation(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": this.userAgent,
          },
          signal,
        });
        if (
          (response.status === 429 || response.status === 503) &&
          attempt < 2
        ) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delay = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : 1000 * 2 ** attempt + Math.floor(this.random() * 250);
          await this.sleep(delay, signal);
          continue;
        }
        if (!response.ok)
          throw new Error(
            `MusicBrainz returned HTTP ${response.status}. Try again later.`,
          );
        const rawPayload = await response.text();
        if (rawPayload.length > 2_000_000)
          throw new Error(
            "MusicBrainz returned an unexpectedly large response.",
          );
        const payload = musicBrainzResponseSchema.parse(
          JSON.parse(rawPayload) as unknown,
        );
        const fetchedAt = new Date(this.now()).toISOString();
        this.cache.putProviderCache({
          provider,
          requestKey: key,
          responseSchemaVersion,
          status: response.status,
          fetchedAt,
          expiresAt: new Date(this.now() + cacheLifetimeMs).toISOString(),
          payloadJson: JSON.stringify(payload),
        });
        return {
          candidates: mapResponse(payload),
          source: "network",
          fetchedAt,
        };
      }
      throw new Error("MusicBrainz did not accept the request.");
    } catch (error) {
      if (signal.aborted) throw error;
      if (cached) return { ...cached, source: "stale-cache" };
      throw error;
    }
  }
}
