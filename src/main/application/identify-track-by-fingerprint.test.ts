import { describe, expect, it, vi } from "vitest";

import type { CatalogTrack } from "../../shared/domain/catalog";
import { IdentifyTrackByFingerprint } from "./identify-track-by-fingerprint";

const fileId = "d3a52a1d-f00b-46d8-ac01-e848675a2139";
const track: CatalogTrack = {
  id: fileId,
  path: "/fixture/track.flac",
  size: 100,
  modifiedMs: 10,
  format: "FLAC",
  durationSeconds: 12,
  tags: {
    title: "Fixture Track",
    album: "Fixture Album",
    artist: "Fixture Artist",
    albumArtist: "Fixture Artist",
    trackNumber: null,
    discNumber: null,
    year: null,
  },
  nativeTags: [],
  scanError: null,
};

function setup(now = 1_000) {
  const catalog = { getTrack: vi.fn(() => track as CatalogTrack | undefined) };
  const fingerprinter = {
    fingerprint: vi.fn(() =>
      Promise.resolve({
        durationSeconds: 12,
        value: "AQAAS8kSSUmiKBIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        sourceSize: 100,
        sourceModifiedMs: 10,
      }),
    ),
    inspect: vi.fn(() => Promise.resolve({ size: 100, modifiedMs: 10 })),
  };
  const provider = {
    lookup: vi.fn(() =>
      Promise.resolve({
        candidates: [
          {
            acoustId: "11111111-1111-4111-8111-111111111111",
            recordingId: "22222222-2222-4222-8222-222222222222",
            title: "Fixture Track",
            artists: [],
            durationSeconds: 12,
            releaseGroups: [],
            score: 0.98,
          },
        ],
        source: "network" as const,
        fetchedAt: "2026-07-28T12:00:00.000Z",
      }),
    ),
  };
  return {
    catalog,
    fingerprinter,
    provider,
    service: new IdentifyTrackByFingerprint(
      catalog,
      fingerprinter,
      provider,
      () => now,
    ),
  };
}

describe("IdentifyTrackByFingerprint", () => {
  it("keeps the fingerprint privileged until the exact preview is confirmed", async () => {
    const { service, fingerprinter, provider } = setup();
    const preview = await service.preview(fileId);

    expect(fingerprinter.fingerprint).toHaveBeenCalledWith(
      track.path,
      expect.any(AbortSignal),
    );
    expect(provider.lookup).not.toHaveBeenCalled();
    expect(preview).toMatchObject({
      fileId,
      trackTitle: "Fixture Track",
      sent: {
        fingerprintAlgorithm: "Chromaprint",
        fingerprintCharacters: 52,
        durationSeconds: 12,
      },
      readOnly: true,
    });
    expect(JSON.stringify(preview)).not.toContain("AQAAS8kSSUmi");

    const result = await service.confirm(
      preview.operationId,
      preview.confirmationToken,
    );
    expect(provider.lookup).toHaveBeenCalledWith(
      "AQAAS8kSSUmiKBIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      12,
      expect.any(AbortSignal),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.readOnly).toBe(true);
  });

  it("rejects stale confirmation state without contacting AcoustID", async () => {
    const { service, provider } = setup();
    const preview = await service.preview(fileId);
    await expect(
      service.confirm(preview.operationId, "wrong-confirmation-token-value"),
    ).rejects.toThrow("no longer current");
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it("rechecks the targeted file before sending its pending fingerprint", async () => {
    const { service, fingerprinter, provider } = setup();
    const preview = await service.preview(fileId);
    fingerprinter.inspect.mockResolvedValue({ size: 100, modifiedMs: 11 });
    await expect(
      service.confirm(preview.operationId, preview.confirmationToken),
    ).rejects.toThrow("changed after fingerprinting");
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it("cancels local or network work and discards pending fingerprints", async () => {
    const { service, provider } = setup();
    const preview = await service.preview(fileId);
    expect(service.cancel(fileId)).toEqual({ cancelled: true });
    await expect(
      service.confirm(preview.operationId, preview.confirmationToken),
    ).rejects.toThrow("no longer current");
    expect(provider.lookup).not.toHaveBeenCalled();
    expect(service.cancel(fileId)).toEqual({ cancelled: false });
  });
});
