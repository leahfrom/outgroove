import { createHash } from "node:crypto";

import { z } from "zod";

import type { AcoustIdRecordingCandidate } from "../../../shared/domain/acoustid-identification";

const provider = "acoustid";
const responseSchemaVersion = 1;
const cacheLifetimeMs = 24 * 60 * 60 * 1000;
const requestIntervalMs = 334;

const artistSchema = z
  .object({
    id: z.uuid().optional(),
    name: z.string().min(1).max(1000),
  })
  .loose();

const releaseGroupSchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).max(1000),
    type: z.string().max(100).nullable().optional(),
  })
  .loose();

const recordingSchema = z
  .object({
    id: z.uuid(),
    title: z.string().min(1).max(1000).optional(),
    duration: z
      .number()
      .nonnegative()
      .max(24 * 60 * 60)
      .optional(),
    artists: z.array(artistSchema).max(100).optional(),
    releasegroups: z.array(releaseGroupSchema).max(100).optional(),
  })
  .loose();

const lookupResponseSchema = z
  .object({
    status: z.literal("ok"),
    results: z
      .array(
        z
          .object({
            id: z.uuid(),
            score: z.number().min(0).max(1),
            recordings: z.array(recordingSchema).max(100).optional(),
          })
          .loose(),
      )
      .max(100),
  })
  .loose();

interface ProviderCacheRecord {
  readonly provider: string;
  readonly requestKey: string;
  readonly responseSchemaVersion: number;
  readonly status: number;
  readonly fetchedAt: string;
  readonly expiresAt: string;
  readonly payloadJson: string;
}

export interface AcoustIdCache {
  getProviderCache(
    provider: string,
    requestKey: string,
  ): ProviderCacheRecord | undefined;
  putProviderCache(record: ProviderCacheRecord): void;
}

interface Options {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

export interface AcoustIdLookupResult {
  readonly candidates: readonly AcoustIdRecordingCandidate[];
  readonly source: "network" | "cache" | "stale-cache";
  readonly fetchedAt: string;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("The AcoustID lookup was cancelled."));
      },
      { once: true },
    );
  });
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes)
    throw new Error("AcoustID returned an unexpectedly large response.");
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumBytes)
      throw new Error("AcoustID returned an unexpectedly large response.");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";
  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > maximumBytes) {
        await reader.cancel();
        throw new Error("AcoustID returned an unexpectedly large response.");
      }
      text += decoder.decode(chunk.value, { stream: true });
      chunk = await reader.read();
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function mapResponse(
  response: z.infer<typeof lookupResponseSchema>,
): readonly AcoustIdRecordingCandidate[] {
  const candidates = response.results.flatMap((result) => {
    const recordings = result.recordings ?? [];
    if (recordings.length === 0)
      return [
        {
          acoustId: result.id,
          recordingId: null,
          title: null,
          artists: [],
          durationSeconds: null,
          releaseGroups: [],
          score: result.score,
        } satisfies AcoustIdRecordingCandidate,
      ];
    return recordings.map((recording): AcoustIdRecordingCandidate => ({
      acoustId: result.id,
      recordingId: recording.id.toLocaleLowerCase("en-US"),
      title: recording.title ?? null,
      artists: (recording.artists ?? []).map((artist) => ({
        id: artist.id?.toLocaleLowerCase("en-US") ?? null,
        name: artist.name,
      })),
      durationSeconds:
        recording.duration === undefined
          ? null
          : Math.round(recording.duration),
      releaseGroups: (recording.releasegroups ?? []).map((releaseGroup) => ({
        id: releaseGroup.id.toLocaleLowerCase("en-US"),
        title: releaseGroup.title,
        type: releaseGroup.type ?? null,
      })),
      score: result.score,
    }));
  });
  const unique = new Map<string, AcoustIdRecordingCandidate>();
  for (const candidate of candidates) {
    const key = candidate.recordingId ?? candidate.acoustId;
    const previous = unique.get(key);
    if (!previous || candidate.score > previous.score)
      unique.set(key, candidate);
  }
  return [...unique.values()].sort(
    (left, right) =>
      right.score - left.score ||
      (left.title ?? "").localeCompare(right.title ?? "") ||
      (left.recordingId ?? left.acoustId).localeCompare(
        right.recordingId ?? right.acoustId,
      ),
  );
}

export class AcoustIdClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (
    milliseconds: number,
    signal: AbortSignal,
  ) => Promise<void>;
  private readonly random: () => number;
  private nextRequestAt = 0;
  private requestGate: Promise<void> = Promise.resolve();

  constructor(
    private readonly cache: AcoustIdCache,
    private readonly apiKey: string | undefined,
    private readonly userAgent: string,
    options: Options = {},
  ) {
    this.fetchImplementation = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? wait;
    this.random = options.random ?? Math.random;
  }

  async lookup(
    fingerprint: string,
    durationSeconds: number,
    signal: AbortSignal,
  ): Promise<AcoustIdLookupResult> {
    if (!this.apiKey || !/^[A-Za-z0-9_-]{1,100}$/u.test(this.apiKey))
      throw new Error(
        "AcoustID lookup is unavailable because this build has no registered application key.",
      );
    const requestKey = createHash("sha256")
      .update(`${durationSeconds}:${fingerprint}`)
      .digest("hex");
    const cached = this.readCache(requestKey);
    if (cached && !cached.expired)
      return {
        candidates: mapResponse(cached.payload),
        source: "cache",
        fetchedAt: cached.fetchedAt,
      };
    try {
      const response = await this.performRequest(
        fingerprint,
        durationSeconds,
        signal,
      );
      this.cache.putProviderCache({
        provider,
        requestKey,
        responseSchemaVersion,
        status: response.status,
        fetchedAt: response.fetchedAt,
        expiresAt: new Date(this.now() + cacheLifetimeMs).toISOString(),
        payloadJson: JSON.stringify(response.payload),
      });
      return {
        candidates: mapResponse(response.payload),
        source: "network",
        fetchedAt: response.fetchedAt,
      };
    } catch (error) {
      if (signal.aborted) throw error;
      if (cached)
        return {
          candidates: mapResponse(cached.payload),
          source: "stale-cache",
          fetchedAt: cached.fetchedAt,
        };
      throw error;
    }
  }

  private readCache(requestKey: string):
    | {
        readonly payload: z.infer<typeof lookupResponseSchema>;
        readonly fetchedAt: string;
        readonly expired: boolean;
      }
    | undefined {
    const cached = this.cache.getProviderCache(provider, requestKey);
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
    const parsed = lookupResponseSchema.safeParse(payload);
    if (!parsed.success) return undefined;
    return {
      payload: parsed.data,
      fetchedAt: cached.fetchedAt,
      expired: Date.parse(cached.expiresAt) <= this.now(),
    };
  }

  private async waitForRequestSlot(signal: AbortSignal): Promise<void> {
    let release = (): void => undefined;
    const previous = this.requestGate;
    this.requestGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const delay = Math.max(0, this.nextRequestAt - this.now());
      if (delay > 0) await this.sleep(delay, signal);
      this.nextRequestAt = this.now() + requestIntervalMs;
    } finally {
      release();
    }
  }

  private async performRequest(
    fingerprint: string,
    durationSeconds: number,
    signal: AbortSignal,
  ): Promise<{
    readonly status: number;
    readonly payload: z.infer<typeof lookupResponseSchema>;
    readonly fetchedAt: string;
  }> {
    const form = new URLSearchParams({
      client: this.apiKey ?? "",
      duration: String(durationSeconds),
      fingerprint,
      format: "json",
      meta: "recordings releasegroups compress",
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.waitForRequestSlot(signal);
      const response = await this.fetchImplementation(
        "https://api.acoustid.org/v2/lookup",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": this.userAgent,
          },
          body: form,
          signal,
        },
      );
      if ((response.status === 429 || response.status === 503) && attempt < 2) {
        const retryAfterHeader = response.headers.get("retry-after");
        const retryAfter = Number(retryAfterHeader);
        const delay =
          retryAfterHeader !== null &&
          Number.isFinite(retryAfter) &&
          retryAfter >= 0
            ? retryAfter * 1000
            : 1000 * 2 ** attempt + Math.floor(this.random() * 250);
        await this.sleep(delay, signal);
        continue;
      }
      if (!response.ok)
        throw new Error(
          `AcoustID returned HTTP ${response.status}. Try again later.`,
        );
      const rawPayload = await readBoundedText(response, 1_000_000);
      let payload: unknown;
      try {
        payload = JSON.parse(rawPayload) as unknown;
      } catch {
        throw new Error("AcoustID returned an unreadable response.");
      }
      const parsed = lookupResponseSchema.safeParse(payload);
      if (!parsed.success)
        throw new Error("AcoustID returned an invalid response.");
      return {
        status: response.status,
        payload: parsed.data,
        fetchedAt: new Date(this.now()).toISOString(),
      };
    }
    throw new Error("AcoustID did not accept the request.");
  }
}
