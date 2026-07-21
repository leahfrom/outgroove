import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import type {
  LibraryDiscoveryWorkerRequest,
  LibraryDiscoveryWorkerResponse,
} from "../../../shared/contracts/library-discovery-worker";
import {
  type DiscoveryWorker,
  WorkerLibraryFileSystem,
} from "./library-filesystem";

class FakeDiscoveryWorker extends EventEmitter implements DiscoveryWorker {
  readonly acknowledgements: number[] = [];
  terminated = false;

  constructor(private readonly start: (worker: FakeDiscoveryWorker) => void) {
    super();
  }

  postMessage(message: LibraryDiscoveryWorkerRequest): void {
    if (message.type === "start") this.start(this);
    else {
      this.acknowledgements.push(message.batchId);
      queueMicrotask(() => this.respond({ type: "complete" }));
    }
  }

  respond(message: LibraryDiscoveryWorkerResponse): void {
    this.emit("message", message);
  }

  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(0);
  }
}

describe("worker-backed library discovery", () => {
  it("acknowledges a bounded batch only after its items are consumed", async () => {
    const worker = new FakeDiscoveryWorker((instance) =>
      queueMicrotask(() =>
        instance.respond({
          type: "batch",
          batchId: 7,
          items: [
            {
              kind: "file",
              path: "/fixture/track.mp3",
              size: 10,
              modifiedMs: 20,
            },
          ],
        }),
      ),
    );
    const fileSystem = new WorkerLibraryFileSystem(
      "/fixture/library-discovery-worker.js",
      () => worker,
    );
    const iterator = fileSystem.discover("/fixture")[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        kind: "file",
        path: "/fixture/track.mp3",
        size: 10,
        modifiedMs: 20,
      },
    });
    expect(worker.acknowledgements).toEqual([]);
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(worker.acknowledgements).toEqual([7]);
    expect(worker.terminated).toBe(true);
  });

  it("terminates pending discovery immediately when cancelled", async () => {
    const worker = new FakeDiscoveryWorker(() => undefined);
    const fileSystem = new WorkerLibraryFileSystem(
      "/fixture/library-discovery-worker.js",
      () => worker,
    );
    const controller = new AbortController();
    const discovery = fileSystem.discover("/fixture", controller.signal);
    const iterator = discovery[Symbol.asyncIterator]();
    const pending = iterator.next();
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminated).toBe(true);
  });

  it("surfaces worker crashes instead of finalizing an empty scan", async () => {
    const worker = new FakeDiscoveryWorker((instance) =>
      queueMicrotask(() => instance.emit("error", new Error("worker crash"))),
    );
    const fileSystem = new WorkerLibraryFileSystem(
      "/fixture/library-discovery-worker.js",
      () => worker,
    );

    const discovery = fileSystem.discover("/fixture");
    const first = discovery[Symbol.asyncIterator]().next();
    await expect(first).rejects.toThrow("worker crash");
    expect(worker.terminated).toBe(true);
  });
});
