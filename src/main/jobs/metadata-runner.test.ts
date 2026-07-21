import { describe, expect, it } from "vitest";

import type { MetadataReader } from "../adapters/metadata/metadata-reader";
import { LocalMetadataJobRunner } from "./metadata-runner";

describe("streaming metadata runner", () => {
  it("applies consumer backpressure without retaining later results", async () => {
    let reads = 0;
    let delivered = 0;
    let releaseConsumers: (() => void) | undefined;
    const consumersReleased = new Promise<void>((resolve) => {
      releaseConsumers = resolve;
    });
    let firstWindowDelivered: (() => void) | undefined;
    const firstWindow = new Promise<void>((resolve) => {
      firstWindowDelivered = resolve;
    });
    const reader: MetadataReader = {
      read(path) {
        reads++;
        return Promise.resolve({
          path,
          size: 1,
          modifiedMs: 1,
          format: "Synthetic",
          durationSeconds: 1,
          tags: {
            title: path,
            album: "Streaming",
            artist: "Fixture Artist",
            albumArtist: "Fixture Artist",
            trackNumber: 1,
            discNumber: 1,
            year: "2026",
          },
          nativeTags: [],
        });
      },
    };
    const runner = new LocalMetadataJobRunner(reader, 2);
    const running = runner.processAll(
      Array.from({ length: 10 }, (_, index) => `/fixture/${index}.mp3`),
      async () => {
        delivered++;
        if (delivered === 2) firstWindowDelivered?.();
        await consumersReleased;
      },
      () => undefined,
    );

    await firstWindow;
    expect(reads).toBe(2);
    expect(delivered).toBe(2);
    releaseConsumers?.();
    await running;
    expect(reads).toBe(10);
    expect(delivered).toBe(10);
  });

  it("drops an in-flight local result when cancellation wins", async () => {
    let finishRead: (() => void) | undefined;
    const readReleased = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    const reader: MetadataReader = {
      async read(path) {
        await readReleased;
        return {
          path,
          size: 1,
          modifiedMs: 1,
          format: "Synthetic",
          durationSeconds: 1,
          tags: {
            title: path,
            album: "Cancelled",
            artist: "Fixture Artist",
            albumArtist: "Fixture Artist",
            trackNumber: 1,
            discNumber: 1,
            year: "2026",
          },
          nativeTags: [],
        };
      },
    };
    const controller = new AbortController();
    let delivered = 0;
    const running = new LocalMetadataJobRunner(reader, 1).processAll(
      ["/fixture/cancelled.mp3"],
      () => {
        delivered++;
      },
      () => undefined,
      controller.signal,
    );
    controller.abort();
    finishRead?.();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(delivered).toBe(0);
  });
});
