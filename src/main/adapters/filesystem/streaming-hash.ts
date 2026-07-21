import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function streamingFileHash(
  path: string,
  range?: { start: number; endExclusive: number },
): Promise<string> {
  const hash = createHash("sha256");
  if (range && range.endExclusive <= range.start) return hash.digest("hex");
  const stream = createReadStream(path, {
    start: range?.start,
    end: range ? range.endExclusive - 1 : undefined,
  });
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
