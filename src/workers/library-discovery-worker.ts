import { parentPort } from "node:worker_threads";

import { discoverLibraryFiles } from "../main/adapters/filesystem/library-discovery";
import type {
  LibraryDiscoveryItem,
  LibraryDiscoveryWorkerRequest,
} from "../shared/contracts/library-discovery-worker";

const BATCH_SIZE = 250;
if (!parentPort)
  throw new Error("Library discovery worker must run in a worker thread.");
const port = parentPort;
const acknowledgements = new Map<number, () => void>();

function waitForAcknowledgement(batchId: number): Promise<void> {
  return new Promise((resolve) => acknowledgements.set(batchId, resolve));
}

async function discover(root: string): Promise<void> {
  let batch: LibraryDiscoveryItem[] = [];
  let batchId = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const outgoing = batch;
    batch = [];
    const outgoingId = batchId++;
    port.postMessage({ type: "batch", batchId: outgoingId, items: outgoing });
    await waitForAcknowledgement(outgoingId);
  };
  for await (const item of discoverLibraryFiles(root)) {
    batch.push(item);
    if (batch.length === BATCH_SIZE) await flush();
  }
  await flush();
  port.postMessage({ type: "complete" });
}

port.on("message", (message: LibraryDiscoveryWorkerRequest) => {
  if (message.type === "ack") {
    acknowledgements.get(message.batchId)?.();
    acknowledgements.delete(message.batchId);
    return;
  }
  void discover(message.root).catch((error: unknown) =>
    port.postMessage({
      type: "fatal",
      error: error instanceof Error ? error.message : String(error),
    }),
  );
});
