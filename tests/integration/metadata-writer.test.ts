import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MusicMetadataReader } from "../../src/main/adapters/metadata/metadata-reader";
import {
  audioPayloadHash,
  SafeMetadataWriter,
} from "../../src/main/adapters/metadata/metadata-writer";

const temporary: string[] = [];
afterEach(async () =>
  Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  ),
);

describe.each(["01-first.mp3", "02-second.flac"])(
  "safe metadata round trip: %s",
  (fixture) => {
    it("writes, re-reads, preserves private tags, and leaves the audio payload unchanged", async () => {
      const directory = await mkdtemp(join(tmpdir(), "outgroove-tags-"));
      temporary.push(directory);
      const path = join(directory, basename(fixture));
      await copyFile(
        join(process.cwd(), "fixtures", "audio", "album", fixture),
        path,
      );
      const reader = new MusicMetadataReader();
      const writer = new SafeMetadataWriter(reader);
      const before = await reader.read(path);
      const payloadBefore = await audioPayloadHash(path);
      const result = await writer.writeAlbumTitle(path, "Verified Album");
      const after = await reader.read(path);
      expect(after.tags.album).toBe("Verified Album");
      expect(
        after.nativeTags.some(
          (tag) =>
            tag.id.includes("OUTGROOVE_PRIVATE") &&
            tag.value.includes("preserve-me"),
        ),
      ).toBe(true);
      expect(
        before.nativeTags.some((tag) => tag.id.includes("OUTGROOVE_PRIVATE")),
      ).toBe(true);
      expect(result.payloadHashAfter).toBe(payloadBefore);
    });
  },
);

it("rejects unsupported writes without changing the source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-tags-fail-"));
  temporary.push(directory);
  const path = join(directory, "read-only.ogg");
  await copyFile(
    join(process.cwd(), "fixtures", "audio", "album", "01-first.mp3"),
    path,
  );
  const before = await readFile(path);
  await expect(
    new SafeMetadataWriter(new MusicMetadataReader()).writeAlbumTitle(
      path,
      "Nope",
    ),
  ).rejects.toThrow("not supported");
  expect(await readFile(path)).toEqual(before);
});
