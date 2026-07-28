import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(process.cwd(), "fixtures", "audio");
const preservation = join(root, "preservation");
const fingerprint = join(root, "fingerprint");
const corrupt = join(root, "corrupt");
mkdirSync(preservation, { recursive: true });
mkdirSync(fingerprint, { recursive: true });
mkdirSync(corrupt, { recursive: true });

const temporary = mkdtempSync(join(tmpdir(), "outgroove-fixtures-"));
const cover = join(temporary, "cover.ppm");
const pixels = Buffer.alloc(16 * 16 * 3);
for (let offset = 0; offset < pixels.length; offset += 3) {
  pixels[offset] = 0x24;
  pixels[offset + 1] = 0x5c;
  pixels[offset + 2] = 0x39;
}
writeFileSync(cover, Buffer.concat([Buffer.from("P6\n16 16\n255\n"), pixels]));

function ffmpeg(args: readonly string[]): void {
  execFileSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    {
      stdio: "inherit",
    },
  );
}

const commonMetadata = [
  "-metadata",
  "title=Preservation Track",
  "-metadata",
  "album=Preservation Album",
  "-metadata",
  "artist=Fixture Artist – 東京",
  "-metadata",
  "album_artist=Fixture Album Artist",
  "-metadata",
  "date=2026-07",
  "-metadata",
  "track=3/9",
  "-metadata",
  "disc=2/2",
  "-metadata",
  "comment=Keep this comment exactly",
  "-metadata",
  "OUTGROOVE_PRIVATE=preserve-me-too",
  "-metadata",
  "MUSICBRAINZ_TRACKID=12345678-1234-4234-8234-123456789abc",
];

try {
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=523.25:sample_rate=44100:duration=0.25",
    "-i",
    cover,
    "-map",
    "0:a",
    "-map",
    "1:v",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    "-c:v",
    "png",
    "-disposition:v",
    "attached_pic",
    "-id3v2_version",
    "3",
    ...commonMetadata,
    join(preservation, "preservation.mp3"),
  ]);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=659.25:sample_rate=44100:duration=0.25",
    "-i",
    cover,
    "-map",
    "0:a",
    "-map",
    "1:v",
    "-c:a",
    "flac",
    "-c:v",
    "png",
    "-disposition:v",
    "attached_pic",
    ...commonMetadata,
    join(preservation, "preservation.flac"),
  ]);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=783.99:sample_rate=44100:duration=12",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    "-metadata",
    "title=Fingerprint Fixture",
    join(fingerprint, "fingerprint.mp3"),
  ]);
  ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=783.99:sample_rate=44100:duration=12",
    "-c:a",
    "flac",
    "-metadata",
    "title=Fingerprint Fixture",
    join(fingerprint, "fingerprint.flac"),
  ]);

  writeFileSync(
    join(corrupt, "truncated-id3.mp3"),
    Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f, 1, 2]),
  );
  writeFileSync(
    join(corrupt, "truncated-metadata.flac"),
    Buffer.from([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 1, 0, 1, 2, 3]),
  );
  writeFileSync(
    join(corrupt, "unsupported.ogg"),
    "This is not an Ogg container. It is a CC0 malformed fixture.\n",
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
