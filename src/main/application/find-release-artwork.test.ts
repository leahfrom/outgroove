import { describe, expect, it, vi } from "vitest";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import { FindReleaseArtwork } from "./find-release-artwork";

const album: CatalogAlbum = {
  id: "adb9be31-d450-45f9-99de-c9c6143988ad",
  title: "Fixture Album",
  albumArtist: "Fixture Artist",
  tracks: [
    {
      id: "73b6d616-0f52-4ef3-b71a-ffb42844e306",
      path: "/private/not-sent.flac",
      size: 1,
      modifiedMs: 1,
      format: "FLAC",
      durationSeconds: 1,
      tags: {
        title: "Track",
        album: "Fixture Album",
        artist: "Fixture Artist",
        albumArtist: "Fixture Artist",
        trackNumber: 1,
        discNumber: 1,
        year: "2026",
      },
      nativeTags: [{ id: "PRIVATE", value: "not sent" }],
      scanError: null,
    },
  ],
};
const releaseId = "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef";
const bytes = new Uint8Array([137, 80, 78, 71]);

describe("find release artwork", () => {
  it("re-resolves only the exact displayed artwork identity before creating the existing replacement preview", async () => {
    const loadOriginalFrontArtwork = vi.fn(() =>
      Promise.resolve({
        id: "829521842",
        types: ["Front"],
        front: true,
        back: false,
        approved: true,
        comment: "Exact edition",
        originalExtension: "png" as const,
        data: bytes,
        width: 1200,
        height: 1200,
        mimeType: "image/png" as const,
      }),
    );
    const preview = {
      operationId: "36e97945-004e-4771-bf22-b3891bb811c4",
      confirmationToken: "confirmation-token-long-enough",
      action: "replace" as const,
      files: [],
    };
    const previewData = vi.fn(() => Promise.resolve(preview));
    const service = new FindReleaseArtwork(
      { getAlbum: () => album },
      { loadFrontArtwork: vi.fn(), loadOriginalFrontArtwork },
      { encode: vi.fn() },
      { previewData },
    );

    await expect(
      service.previewReplacement(album.id, releaseId, "829521842"),
    ).resolves.toBe(preview);
    expect(loadOriginalFrontArtwork).toHaveBeenCalledWith(
      releaseId,
      "829521842",
      expect.any(AbortSignal),
    );
    expect(previewData).toHaveBeenCalledWith(album.id, bytes, {
      kind: "cover-art-archive",
      releaseId,
      artworkId: "829521842",
    });
    expect(JSON.stringify(loadOriginalFrontArtwork.mock.calls)).not.toContain(
      "/private/not-sent.flac",
    );
  });

  it("refuses a changed artwork identity and cancels original-image preparation", async () => {
    const changedPreview = vi.fn();
    const changed = new FindReleaseArtwork(
      { getAlbum: () => album },
      {
        loadFrontArtwork: vi.fn(),
        loadOriginalFrontArtwork: vi.fn(() =>
          Promise.resolve({
            id: "999999999",
            types: ["Front"],
            front: true,
            back: false,
            approved: true,
            comment: null,
            originalExtension: "png" as const,
            data: bytes,
            width: 1,
            height: 1,
            mimeType: "image/png" as const,
          }),
        ),
      },
      { encode: vi.fn() },
      { previewData: changedPreview },
    );
    await expect(
      changed.previewReplacement(album.id, releaseId, "829521842"),
    ).rejects.toThrow("different artwork identity");
    expect(changedPreview).not.toHaveBeenCalled();

    let signal: AbortSignal | undefined;
    const cancellable = new FindReleaseArtwork(
      { getAlbum: () => album },
      {
        loadFrontArtwork: vi.fn(),
        loadOriginalFrontArtwork: vi.fn(
          (
            _releaseId: string,
            _artworkId: string,
            requestSignal: AbortSignal,
          ) =>
            new Promise<never>((_resolve, reject) => {
              signal = requestSignal;
              requestSignal.addEventListener("abort", () =>
                reject(new DOMException("cancelled", "AbortError")),
              );
            }),
        ),
      },
      { encode: vi.fn() },
      { previewData: vi.fn() },
    );
    const pending = cancellable.previewReplacement(
      album.id,
      releaseId,
      "829521842",
    );
    expect(cancellable.cancel(album.id)).toEqual({ cancelled: true });
    expect(signal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sends only the selected release identity and returns an encoded read-only preview", async () => {
    const loadFrontArtwork = vi.fn(() =>
      Promise.resolve({
        source: "network" as const,
        fetchedAt: "2026-07-27T12:00:00.000Z",
        artwork: {
          id: "829521842",
          types: ["Front"],
          front: true,
          back: false,
          approved: true,
          comment: "Exact edition",
          originalExtension: "png" as const,
          data: bytes,
          width: 500,
          height: 500,
          mimeType: "image/png" as const,
        },
      }),
    );
    const encode = vi.fn(() => "data:image/png;base64,fixture");
    const service = new FindReleaseArtwork(
      { getAlbum: () => album },
      { loadFrontArtwork, loadOriginalFrontArtwork: vi.fn() },
      { encode },
      { previewData: vi.fn() },
    );

    await expect(service.load(album.id, releaseId)).resolves.toEqual({
      albumId: album.id,
      sent: { releaseId },
      artwork: {
        id: "829521842",
        types: ["Front"],
        front: true,
        back: false,
        approved: true,
        comment: "Exact edition",
        previewDataUrl: "data:image/png;base64,fixture",
        width: 500,
        height: 500,
        mimeType: "image/png",
        byteLength: bytes.byteLength,
      },
      source: "network",
      fetchedAt: "2026-07-27T12:00:00.000Z",
      readOnly: true,
    });
    expect(loadFrontArtwork).toHaveBeenCalledWith(
      releaseId,
      expect.any(AbortSignal),
    );
    expect(encode).toHaveBeenCalledWith(bytes);
    expect(JSON.stringify(loadFrontArtwork.mock.calls)).not.toContain(
      "/private/not-sent.flac",
    );
  });

  it("rejects a stale album and an image the local encoder cannot safely decode", async () => {
    const provider = {
      loadFrontArtwork: vi.fn(() =>
        Promise.resolve({
          source: "network" as const,
          fetchedAt: "2026-07-27T12:00:00.000Z",
          artwork: {
            id: "1",
            types: ["Front"],
            front: true,
            back: false,
            approved: false,
            comment: null,
            originalExtension: "png" as const,
            data: bytes,
            width: 1,
            height: 1,
            mimeType: "image/png" as const,
          },
        }),
      ),
      loadOriginalFrontArtwork: vi.fn(),
    };
    const missing = new FindReleaseArtwork(
      { getAlbum: () => undefined },
      provider,
      { encode: vi.fn() },
      { previewData: vi.fn() },
    );
    await expect(missing.load(album.id, releaseId)).rejects.toThrow(
      "no longer in the Library",
    );
    expect(provider.loadFrontArtwork).not.toHaveBeenCalled();

    const unsafe = new FindReleaseArtwork(
      { getAlbum: () => album },
      provider,
      {
        encode: () => undefined,
      },
      { previewData: vi.fn() },
    );
    await expect(unsafe.load(album.id, releaseId)).rejects.toThrow(
      "could not be decoded safely",
    );
  });

  it("returns an explicit missing result and cancels only the active album request", async () => {
    let signal: AbortSignal | undefined;
    const service = new FindReleaseArtwork(
      { getAlbum: () => album },
      {
        loadFrontArtwork: vi.fn(
          (_releaseId: string, requestSignal: AbortSignal) =>
            new Promise<never>((_resolve, reject) => {
              signal = requestSignal;
              requestSignal.addEventListener("abort", () =>
                reject(new DOMException("cancelled", "AbortError")),
              );
            }),
        ),
        loadOriginalFrontArtwork: vi.fn(),
      },
      { encode: vi.fn() },
      { previewData: vi.fn() },
    );
    const pending = service.load(album.id, releaseId);
    expect(service.cancel(album.id)).toEqual({ cancelled: true });
    expect(signal?.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(service.cancel(album.id)).toEqual({ cancelled: false });

    const missing = new FindReleaseArtwork(
      { getAlbum: () => album },
      {
        loadFrontArtwork: vi.fn(() =>
          Promise.resolve({
            source: "cache" as const,
            fetchedAt: "2026-07-27T12:00:00.000Z",
            artwork: null,
          }),
        ),
        loadOriginalFrontArtwork: vi.fn(),
      },
      { encode: vi.fn() },
      { previewData: vi.fn() },
    );
    await expect(missing.load(album.id, releaseId)).resolves.toMatchObject({
      artwork: null,
      readOnly: true,
    });
  });
});
