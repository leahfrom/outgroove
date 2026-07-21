import { parentPort } from "node:worker_threads";

import { MusicMetadataReader } from "../main/adapters/metadata/metadata-reader";

if (!parentPort)
  throw new Error("Metadata worker must run in a worker thread.");
const port = parentPort;
const reader = new MusicMetadataReader();

port.on("message", (message: { id: string; path: string }) => {
  void reader.read(message.path).then(
    (file) => port.postMessage({ id: message.id, ok: true, file }),
    (error: unknown) =>
      port.postMessage({
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
  );
});
