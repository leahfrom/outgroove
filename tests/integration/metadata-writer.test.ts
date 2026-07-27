import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { createHash } from "node:crypto";

import { parseFile } from "music-metadata";
import { loadTrack, PictureKind } from "@akabeko/music-metadata-editor";
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

describe.each(["01-first.mp3", "02-second.flac"])(
  "safe multi-field metadata round trip: %s",
  (fixture) => {
    it("changes only requested common fields while preserving private tags and audio", async () => {
      const directory = await mkdtemp(join(tmpdir(), "outgroove-fields-"));
      temporary.push(directory);
      const path = join(directory, basename(fixture));
      await copyFile(
        join(process.cwd(), "fixtures", "audio", "album", fixture),
        path,
      );
      const reader = new MusicMetadataReader();
      const before = await reader.read(path);
      const payloadBefore = await audioPayloadHash(path);
      const result = await new SafeMetadataWriter(reader).writeTags(path, {
        title: "Renamed track",
        artist: "New track artist",
        albumArtist: "New album artist",
        trackNumber: 7,
        discNumber: 2,
        year: "2031-04",
      });
      const after = await reader.read(path);
      expect(after.tags).toEqual({
        ...before.tags,
        title: "Renamed track",
        artist: "New track artist",
        albumArtist: "New album artist",
        trackNumber: 7,
        discNumber: 2,
        year: "2031-04",
      });
      expect(
        after.nativeTags.some(
          (tag) =>
            tag.id.includes("OUTGROOVE_PRIVATE") &&
            tag.value.includes("preserve-me"),
        ),
      ).toBe(true);
      expect(result.payloadHashBefore).toBe(payloadBefore);
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

it("leaves the source untouched when temporary metadata verification fails", async () => {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-tags-verify-"));
  temporary.push(directory);
  const path = join(directory, "verification-failure.mp3");
  await copyFile(
    join(
      process.cwd(),
      "fixtures",
      "audio",
      "preservation",
      "preservation.mp3",
    ),
    path,
  );
  const before = await readFile(path);
  const realReader = new MusicMetadataReader();
  const mismatchingReader = {
    async read(candidatePath: string) {
      const file = await realReader.read(candidatePath);
      return { ...file, tags: { ...file.tags, album: "Wrong Album" } };
    },
  };
  await expect(
    new SafeMetadataWriter(mismatchingReader).writeAlbumTitle(
      path,
      "Expected Album",
    ),
  ).rejects.toThrow("Temporary write verification failed");
  expect(await readFile(path)).toEqual(before);
  expect(await readdir(directory)).toEqual(["verification-failure.mp3"]);
});

it("streams a large MP3 payload while excluding leading and trailing tags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-hash-"));
  temporary.push(directory);
  const path = join(directory, "large.mp3");
  const payload = Buffer.alloc(5 * 1024 * 1024, 0x5a);
  const id3 = Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 1, 2, 3, 4]);
  const id3v1 = Buffer.concat([Buffer.from("TAG"), Buffer.alloc(125, 7)]);
  await writeFile(path, Buffer.concat([id3, payload, id3v1]));
  expect(await audioPayloadHash(path)).toBe(
    createHash("sha256").update(payload).digest("hex"),
  );
});

describe.each(["preservation.mp3", "preservation.flac"])(
  "format-specific preservation corpus: %s",
  (fixture) => {
    it("preserves artwork, Unicode, numbering, comments, identifiers, private fields, and audio", async () => {
      const directory = await mkdtemp(join(tmpdir(), "outgroove-preserve-"));
      temporary.push(directory);
      const source = join(
        process.cwd(),
        "fixtures",
        "audio",
        "preservation",
        fixture,
      );
      const path = join(directory, fixture);
      await copyFile(source, path);
      const before = await preservationFingerprint(path);
      const payloadBefore = await audioPayloadHash(path);
      const result = await new SafeMetadataWriter(
        new MusicMetadataReader(),
      ).writeAlbumTitle(path, "Changed Album Only");
      const after = await preservationFingerprint(path);
      expect(after.album).toBe("Changed Album Only");
      expect({ ...after, album: before.album }).toEqual(before);
      expect(result.payloadHashBefore).toBe(payloadBefore);
      expect(result.payloadHashAfter).toBe(payloadBefore);
    });
  },
);

describe.each(["preservation.mp3", "preservation.flac"])(
  "safe embedded artwork round trip: %s",
  (fixture) => {
    it("replaces the complete picture set while preserving tags, private fields, and audio", async () => {
      const directory = await mkdtemp(join(tmpdir(), "outgroove-artwork-"));
      temporary.push(directory);
      const path = join(directory, fixture);
      await copyFile(
        join(process.cwd(), "fixtures", "audio", "preservation", fixture),
        path,
      );
      const before = await preservationFingerprint(path);
      const loaded = await loadTrack(path);
      const original = loaded.pictures[0];
      if (!original) throw new Error("Preservation artwork fixture missing");
      const pictures = [
        {
          ...original,
          kind: PictureKind.CoverBack,
          description: "Preserved back cover",
        },
        {
          ...original,
          kind: PictureKind.CoverFront,
          description: "New front cover",
        },
      ];
      const payloadBefore = await audioPayloadHash(path);
      const result = await new SafeMetadataWriter(
        new MusicMetadataReader(),
      ).writePictures(path, pictures);
      const after = await preservationFingerprint(path);

      expect(after.pictures).toHaveLength(2);
      expect(after.pictures.map((picture) => picture.description)).toEqual([
        "Preserved back cover",
        "New front cover",
      ]);
      expect({ ...after, pictures: before.pictures }).toEqual(before);
      expect(result.payloadHashBefore).toBe(payloadBefore);
      expect(result.payloadHashAfter).toBe(payloadBefore);
    });
  },
);

it("restores the source if final artwork verification cannot complete", async () => {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-artwork-fail-"));
  temporary.push(directory);
  const path = join(directory, "artwork-failure.flac");
  await copyFile(
    join(
      process.cwd(),
      "fixtures",
      "audio",
      "preservation",
      "preservation.flac",
    ),
    path,
  );
  const before = await readFile(path);
  const loaded = await loadTrack(path);
  const reader = {
    read() {
      return Promise.reject(new Error("simulated final reader failure"));
    },
  };
  await expect(
    new SafeMetadataWriter(reader).writePictures(path, loaded.pictures),
  ).rejects.toThrow("simulated final reader failure");
  expect(await readFile(path)).toEqual(before);
  expect(await readdir(directory)).toEqual(["artwork-failure.flac"]);
});

async function preservationFingerprint(path: string) {
  const metadata = await parseFile(path, { duration: true });
  const nativeText = Object.values(metadata.native)
    .flat()
    .filter((tag) =>
      /OUTGROOVE_PRIVATE|MUSICBRAINZ_TRACKID|COMMENT|DESCRIPTION/iu.test(
        tag.id,
      ),
    )
    .map((tag) => `${tag.id}:${String(tag.value)}`)
    .sort();
  const pictures = (metadata.common.picture ?? []).map((picture) => ({
    format: picture.format,
    type: picture.type,
    description: picture.description,
    hash: createHash("sha256").update(picture.data).digest("hex"),
  }));
  return {
    album: metadata.common.album,
    artist: metadata.common.artist,
    albumArtist: metadata.common.albumartist,
    track: metadata.common.track,
    disk: metadata.common.disk,
    date: metadata.common.date,
    year: metadata.common.year,
    nativeText,
    pictures,
  };
}
