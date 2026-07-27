import { z } from "zod";

import type {
  AlbumIdentificationCandidate,
  MusicBrainzArtistCredit,
  MusicBrainzReleaseTracklist,
} from "../../../shared/domain/album-identification";
import type { MusicBrainzArtistCandidate } from "../../../shared/domain/favorite-artist";

const responseSchemaVersion = 1;
const provider = "musicbrainz";
const cacheLifetimeMs = 24 * 60 * 60 * 1000;

const artistCreditSchema = z
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
  .loose();

const musicBrainzSearchResponseSchema = z
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
            "artist-credit": z.array(artistCreditSchema).max(100).optional(),
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

const musicBrainzArtistSearchResponseSchema = z
  .object({
    artists: z
      .array(
        z
          .object({
            id: z.uuid(),
            score: z.number().int().min(0).max(100).optional(),
            name: z.string().min(1).max(1000),
            "sort-name": z.string().min(1).max(1000),
            disambiguation: z.string().max(1000).nullable().optional(),
            type: z.string().max(100).nullable().optional(),
            country: z.string().max(10).nullable().optional(),
            area: z
              .object({
                name: z.string().min(1).max(1000),
              })
              .loose()
              .nullable()
              .optional(),
          })
          .loose(),
      )
      .max(8)
      .default([]),
  })
  .loose();

const musicBrainzReleaseResponseSchema = z
  .object({
    id: z.uuid(),
    title: z.string().max(1000),
    media: z
      .array(
        z
          .object({
            position: z.number().int().min(1).max(999),
            "track-count": z.number().int().min(1).max(9999).optional(),
            tracks: z
              .array(
                z
                  .object({
                    id: z.uuid(),
                    position: z.number().int().min(1).max(9999),
                    title: z.string().max(1000),
                    length: z
                      .number()
                      .int()
                      .nonnegative()
                      .nullable()
                      .optional(),
                    "artist-credit": z
                      .array(artistCreditSchema)
                      .max(100)
                      .optional(),
                    recording: z
                      .object({
                        id: z.uuid(),
                        title: z.string().max(1000),
                        length: z
                          .number()
                          .int()
                          .nonnegative()
                          .nullable()
                          .optional(),
                        isrcs: z.array(z.string().max(100)).max(100).optional(),
                        "artist-credit": z
                          .array(artistCreditSchema)
                          .max(100)
                          .optional(),
                      })
                      .loose(),
                  })
                  .loose(),
              )
              .max(500),
          })
          .loose(),
      )
      .min(1)
      .max(100),
  })
  .loose()
  .refine(
    (release) =>
      release.media.reduce(
        (total, medium) => total + medium.tracks.length,
        0,
      ) <= 100,
    { message: "Release tracklists are limited to 100 tracks." },
  );

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

export interface MusicBrainzReleaseResult {
  readonly release: MusicBrainzReleaseTracklist;
  readonly source: "network" | "cache" | "stale-cache";
  readonly fetchedAt: string;
}

export interface MusicBrainzArtistSearchResult {
  readonly candidates: readonly MusicBrainzArtistCandidate[];
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

function artistRequestKey(query: string): string {
  return JSON.stringify({
    artistSearch: query.normalize("NFC").trim(),
  });
}

function mapResponse(
  payload: z.infer<typeof musicBrainzSearchResponseSchema>,
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

function mapArtistResponse(
  payload: z.infer<typeof musicBrainzArtistSearchResponseSchema>,
): readonly MusicBrainzArtistCandidate[] {
  return payload.artists.slice(0, 8).map((artist) => ({
    artistId: artist.id.toLocaleLowerCase("en-US"),
    name: artist.name,
    sortName: artist["sort-name"],
    disambiguation: artist.disambiguation ?? null,
    type: artist.type ?? null,
    country: artist.country ?? null,
    area: artist.area?.name ?? null,
    score: artist.score ?? 0,
  }));
}

function mapArtistCredits(
  credits: readonly z.infer<typeof artistCreditSchema>[] | undefined,
): readonly MusicBrainzArtistCredit[] {
  return (
    credits?.map((credit) => ({
      name: credit.name,
      joinPhrase: credit.joinphrase ?? "",
      artistId: credit.artist?.id.toLocaleLowerCase("en-US") ?? null,
    })) ?? []
  );
}

function mapRelease(
  release: z.infer<typeof musicBrainzReleaseResponseSchema>,
): MusicBrainzReleaseTracklist {
  const discTotal = release.media.length;
  return {
    releaseId: release.id.toLocaleLowerCase("en-US"),
    title: release.title,
    tracks: release.media.flatMap((medium) => {
      const trackTotal = medium["track-count"] ?? medium.tracks.length;
      return medium.tracks.map((track) => ({
        releaseTrackId: track.id.toLocaleLowerCase("en-US"),
        recordingId: track.recording.id.toLocaleLowerCase("en-US"),
        discNumber: medium.position,
        discTotal,
        trackNumber: track.position,
        trackTotal,
        title: track.title || track.recording.title,
        artistCredits: mapArtistCredits(
          track["artist-credit"] ?? track.recording["artist-credit"],
        ),
        isrcs: track.recording.isrcs ?? [],
        lengthMs: track.length ?? track.recording.length ?? null,
      }));
    }),
  };
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
  private readonly releaseInFlight = new Map<
    string,
    Promise<MusicBrainzReleaseResult>
  >();
  private readonly artistInFlight = new Map<
    string,
    Promise<MusicBrainzArtistSearchResult>
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

  lookupRelease(
    releaseId: string,
    signal: AbortSignal,
  ): Promise<MusicBrainzReleaseResult> {
    const normalizedId = releaseId.toLocaleLowerCase("en-US");
    const key = JSON.stringify({ releaseId: normalizedId });
    const existing = this.releaseInFlight.get(key);
    if (existing) return existing;
    const pending = this.executeReleaseLookup(
      key,
      normalizedId,
      signal,
    ).finally(() => this.releaseInFlight.delete(key));
    this.releaseInFlight.set(key, pending);
    return pending;
  }

  searchArtists(
    query: string,
    signal: AbortSignal,
  ): Promise<MusicBrainzArtistSearchResult> {
    const key = artistRequestKey(query);
    const existing = this.artistInFlight.get(key);
    if (existing) return existing;
    const pending = this.executeArtistSearch(key, query, signal).finally(() =>
      this.artistInFlight.delete(key),
    );
    this.artistInFlight.set(key, pending);
    return pending;
  }

  private readCachedSearch(
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
    const parsed = musicBrainzSearchResponseSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    return {
      candidates: mapResponse(parsed.data),
      source: "cache",
      fetchedAt: cached.fetchedAt,
      expired: Date.parse(cached.expiresAt) <= this.now(),
    };
  }

  private readCachedRelease(
    key: string,
    releaseId: string,
  ): (MusicBrainzReleaseResult & { readonly expired: boolean }) | undefined {
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
    const parsed = musicBrainzReleaseResponseSchema.safeParse(payload);
    if (
      !parsed.success ||
      parsed.data.id.toLocaleLowerCase("en-US") !== releaseId
    )
      return undefined;
    return {
      release: mapRelease(parsed.data),
      source: "cache",
      fetchedAt: cached.fetchedAt,
      expired: Date.parse(cached.expiresAt) <= this.now(),
    };
  }

  private readCachedArtistSearch(
    key: string,
  ):
    | (MusicBrainzArtistSearchResult & { readonly expired: boolean })
    | undefined {
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
    const parsed = musicBrainzArtistSearchResponseSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    return {
      candidates: mapArtistResponse(parsed.data),
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
    const cached = this.readCachedSearch(key);
    if (cached && !cached.expired) return cached;
    const query = `release:${lucenePhrase(title)} AND artist:${lucenePhrase(artist)}`;
    const url = new URL("https://musicbrainz.org/ws/2/release/");
    url.searchParams.set("query", query);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "8");

    try {
      const response = await this.performRequest(url, signal);
      const payload = musicBrainzSearchResponseSchema.parse(
        JSON.parse(response.rawPayload) as unknown,
      );
      this.cacheResponse(key, response.status, response.fetchedAt, payload);
      return {
        candidates: mapResponse(payload),
        source: "network",
        fetchedAt: response.fetchedAt,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      if (cached) return { ...cached, source: "stale-cache" };
      throw error;
    }
  }

  private async executeReleaseLookup(
    key: string,
    releaseId: string,
    signal: AbortSignal,
  ): Promise<MusicBrainzReleaseResult> {
    const cached = this.readCachedRelease(key, releaseId);
    if (cached && !cached.expired) return cached;
    const url = new URL(
      `https://musicbrainz.org/ws/2/release/${encodeURIComponent(releaseId)}`,
    );
    url.searchParams.set("inc", "recordings+artist-credits+isrcs");
    url.searchParams.set("fmt", "json");
    try {
      const response = await this.performRequest(url, signal);
      const payload = musicBrainzReleaseResponseSchema.parse(
        JSON.parse(response.rawPayload) as unknown,
      );
      if (payload.id.toLocaleLowerCase("en-US") !== releaseId)
        throw new Error("MusicBrainz returned a different release.");
      this.cacheResponse(key, response.status, response.fetchedAt, payload);
      return {
        release: mapRelease(payload),
        source: "network",
        fetchedAt: response.fetchedAt,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      if (cached) return { ...cached, source: "stale-cache" };
      throw error;
    }
  }

  private async executeArtistSearch(
    key: string,
    query: string,
    signal: AbortSignal,
  ): Promise<MusicBrainzArtistSearchResult> {
    const cached = this.readCachedArtistSearch(key);
    if (cached && !cached.expired) return cached;
    const url = new URL("https://musicbrainz.org/ws/2/artist/");
    url.searchParams.set("query", `artist:${lucenePhrase(query)}`);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "8");
    try {
      const response = await this.performRequest(url, signal);
      const payload = musicBrainzArtistSearchResponseSchema.parse(
        JSON.parse(response.rawPayload) as unknown,
      );
      this.cacheResponse(key, response.status, response.fetchedAt, payload);
      return {
        candidates: mapArtistResponse(payload),
        source: "network",
        fetchedAt: response.fetchedAt,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      if (cached) return { ...cached, source: "stale-cache" };
      throw error;
    }
  }

  private async performRequest(
    url: URL,
    signal: AbortSignal,
  ): Promise<{
    readonly status: number;
    readonly rawPayload: string;
    readonly fetchedAt: string;
  }> {
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
      if ((response.status === 429 || response.status === 503) && attempt < 2) {
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
        throw new Error("MusicBrainz returned an unexpectedly large response.");
      return {
        status: response.status,
        rawPayload,
        fetchedAt: new Date(this.now()).toISOString(),
      };
    }
    throw new Error("MusicBrainz did not accept the request.");
  }

  private cacheResponse(
    key: string,
    status: number,
    fetchedAt: string,
    payload: unknown,
  ): void {
    this.cache.putProviderCache({
      provider,
      requestKey: key,
      responseSchemaVersion,
      status,
      fetchedAt,
      expiresAt: new Date(this.now() + cacheLifetimeMs).toISOString(),
      payloadJson: JSON.stringify(payload),
    });
  }
}
