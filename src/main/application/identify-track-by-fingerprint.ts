import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  AcoustIdTrackLookupResultDto,
  AcoustIdTrackPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogTrack } from "../../shared/domain/catalog";
import type { AudioFingerprint } from "../adapters/fingerprint/fpcalc-fingerprinter";
import type { AcoustIdLookupResult } from "../adapters/providers/acoustid-client";

interface TrackCatalog {
  getTrack(fileId: string): CatalogTrack | undefined;
}

interface TrackFingerprinter {
  fingerprint(
    audioPath: string,
    signal: AbortSignal,
  ): Promise<AudioFingerprint>;
  inspect(audioPath: string): Promise<{
    readonly size: number;
    readonly modifiedMs: number;
  }>;
}

interface FingerprintLookupProvider {
  lookup(
    fingerprint: string,
    durationSeconds: number,
    signal: AbortSignal,
  ): Promise<AcoustIdLookupResult>;
}

interface PendingFingerprint {
  readonly operationId: string;
  readonly confirmationToken: string;
  readonly fileId: string;
  readonly trackTitle: string;
  readonly path: string;
  readonly size: number;
  readonly modifiedMs: number;
  readonly fingerprint: AudioFingerprint;
  readonly fingerprintSha256: string;
  readonly expiresAtMs: number;
}

const pendingLifetimeMs = 10 * 60 * 1000;

export class IdentifyTrackByFingerprint {
  private pending: PendingFingerprint | undefined;
  private active:
    | { readonly fileId: string; readonly controller: AbortController }
    | undefined;

  constructor(
    private readonly catalog: TrackCatalog,
    private readonly fingerprinter: TrackFingerprinter,
    private readonly provider: FingerprintLookupProvider,
    private readonly now: () => number = Date.now,
  ) {}

  async preview(fileId: string): Promise<AcoustIdTrackPreviewDto> {
    const track = this.catalog.getTrack(fileId);
    if (!track || track.scanError)
      throw new Error("The track is no longer available in the Library.");
    this.cancelActive();
    this.pending = undefined;
    const controller = new AbortController();
    this.active = { fileId, controller };
    try {
      const fingerprint = await this.fingerprinter.fingerprint(
        track.path,
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new Error("Fingerprinting was cancelled.");
      const fingerprintSha256 = createHash("sha256")
        .update(fingerprint.value)
        .digest("hex");
      if (
        fingerprint.sourceSize !== track.size ||
        fingerprint.sourceModifiedMs !== track.modifiedMs
      )
        throw new Error(
          "The selected track changed since its last scan. Rescan it before identification.",
        );
      const pending: PendingFingerprint = {
        operationId: randomUUID(),
        confirmationToken: randomBytes(24).toString("base64url"),
        fileId,
        trackTitle: track.tags.title,
        path: track.path,
        size: fingerprint.sourceSize,
        modifiedMs: fingerprint.sourceModifiedMs,
        fingerprint,
        fingerprintSha256,
        expiresAtMs: this.now() + pendingLifetimeMs,
      };
      this.pending = pending;
      return this.toPreview(pending);
    } finally {
      this.clearActive(controller);
    }
  }

  async confirm(
    operationId: string,
    confirmationToken: string,
  ): Promise<AcoustIdTrackLookupResultDto> {
    const pending = this.pending;
    if (
      pending?.operationId !== operationId ||
      pending.confirmationToken !== confirmationToken
    )
      throw new Error(
        "The AcoustID preview is no longer current. Fingerprint the track again.",
      );
    if (pending.expiresAtMs <= this.now()) {
      this.pending = undefined;
      throw new Error(
        "The AcoustID preview expired. Fingerprint the track again.",
      );
    }
    const current = this.catalog.getTrack(pending.fileId);
    const currentFile = await this.fingerprinter.inspect(pending.path);
    if (
      !current ||
      current.scanError ||
      current.path !== pending.path ||
      currentFile.size !== pending.size ||
      currentFile.modifiedMs !== pending.modifiedMs
    ) {
      this.pending = undefined;
      throw new Error(
        "The selected track changed after fingerprinting. Rescan it and create a new preview.",
      );
    }
    this.cancelActive();
    const controller = new AbortController();
    this.active = { fileId: pending.fileId, controller };
    try {
      const result = await this.provider.lookup(
        pending.fingerprint.value,
        pending.fingerprint.durationSeconds,
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new Error("The AcoustID lookup was cancelled.");
      this.pending = undefined;
      return {
        fileId: pending.fileId,
        sent: this.sent(pending),
        candidates: result.candidates,
        source: result.source,
        fetchedAt: result.fetchedAt,
        readOnly: true,
      };
    } finally {
      this.clearActive(controller);
    }
  }

  cancel(fileId: string): { readonly cancelled: boolean } {
    let cancelled = false;
    if (this.active?.fileId === fileId) {
      this.cancelActive();
      cancelled = true;
    }
    if (this.pending?.fileId === fileId) {
      this.pending = undefined;
      cancelled = true;
    }
    return { cancelled };
  }

  private cancelActive(): void {
    this.active?.controller.abort();
    this.active = undefined;
  }

  private clearActive(controller: AbortController): void {
    if (this.active?.controller === controller) this.active = undefined;
  }

  private sent(pending: PendingFingerprint): AcoustIdTrackPreviewDto["sent"] {
    return {
      fingerprintAlgorithm: "Chromaprint",
      fingerprintCharacters: pending.fingerprint.value.length,
      fingerprintSha256: pending.fingerprintSha256,
      durationSeconds: pending.fingerprint.durationSeconds,
    };
  }

  private toPreview(pending: PendingFingerprint): AcoustIdTrackPreviewDto {
    return {
      operationId: pending.operationId,
      confirmationToken: pending.confirmationToken,
      fileId: pending.fileId,
      trackTitle: pending.trackTitle,
      sent: this.sent(pending),
      expiresAt: new Date(pending.expiresAtMs).toISOString(),
      readOnly: true,
    };
  }
}
