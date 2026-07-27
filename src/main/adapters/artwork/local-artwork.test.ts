import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readLocalArtwork } from "./local-artwork";

const temporaryDirectories: string[] = [];
const fixture = (name: string): string =>
  join(process.cwd(), "fixtures", "audio", name);

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "outgroove-artwork-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("local artwork extraction", () => {
  it.each(["preservation/preservation.mp3", "preservation/preservation.flac"])(
    "reads a bounded embedded cover from %s",
    async (name) => {
      const result = await readLocalArtwork(fixture(name));

      expect(result.status).toBe("available");
      if (result.status === "available")
        expect(Buffer.from(result.data).subarray(0, 8).toString("hex")).toBe(
          "89504e470d0a1a0a",
        );
    },
  );

  it("uses a same-folder cover without returning its path", async () => {
    const directory = await temporaryDirectory();
    const track = join(directory, "track.mp3");
    await writeFile(track, await readFile(fixture("album/01-first.mp3")));
    const embedded = await readLocalArtwork(
      fixture("preservation/preservation.mp3"),
    );
    if (embedded.status !== "available")
      throw new Error("Embedded fixture artwork missing.");
    await writeFile(join(directory, "cover.png"), embedded.data);

    const result = await readLocalArtwork(track);

    expect(result).toEqual({
      status: "available",
      data: embedded.data,
      source: "folder",
    });
    expect(result).not.toHaveProperty("path");
  });

  it("rejects oversized and linked folder artwork locally", async () => {
    const directory = await temporaryDirectory();
    const track = join(directory, "track.mp3");
    await writeFile(track, await readFile(fixture("album/01-first.mp3")));
    await writeFile(
      join(directory, "cover.png"),
      Buffer.alloc(8 * 1024 * 1024 + 1),
    );
    await expect(readLocalArtwork(track)).resolves.toEqual({
      status: "invalid",
    });

    const outside = join(await temporaryDirectory(), "outside.png");
    await writeFile(outside, Buffer.from("not an image"));
    const linkedDirectory = await temporaryDirectory();
    const linkedTrack = join(linkedDirectory, "track.mp3");
    await writeFile(linkedTrack, await readFile(fixture("album/01-first.mp3")));
    try {
      await symlink(outside, join(linkedDirectory, "cover.png"));
      await expect(readLocalArtwork(linkedTrack)).resolves.toEqual({
        status: "missing",
      });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EPERM"
      ))
        throw error;
    }
  });

  it("keeps missing and malformed artwork isolated", async () => {
    await expect(
      readLocalArtwork(fixture("album/01-first.mp3")),
    ).resolves.toEqual({ status: "missing" });
    await expect(
      readLocalArtwork(fixture("corrupt/truncated-id3.mp3")),
    ).resolves.toEqual({ status: "invalid" });
  });
});
