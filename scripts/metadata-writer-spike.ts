import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { loadTrack, saveTrack } from "@akabeko/music-metadata-editor";
import { parseFile } from "music-metadata";
import { TagLib } from "taglib-wasm";

async function main(): Promise<void> {
  const sources = process.argv.slice(2);
  if (sources.length === 0)
    throw new Error("Pass one or more audio fixture paths.");

  const temp = await mkdtemp(join(tmpdir(), "outgroove-writer-spike-"));
  const taglib = await TagLib.initialize();

  try {
    for (const source of sources) {
      const akabekoOutput = join(temp, `akabeko-${basename(source)}`);
      const taglibOutput = join(temp, `taglib-${basename(source)}`);
      const loaded = await loadTrack(source);
      await saveTrack(
        { ...loaded, tag: { ...loaded.tag, album: "Spike Album" } },
        { source, outputPath: akabekoOutput },
      );
      await taglib.copyWithTags(source, taglibOutput, { album: "Spike Album" });
      const [before, akabeko, taglibResult] = await Promise.all([
        parseFile(source, { duration: true }),
        parseFile(akabekoOutput, { duration: true }),
        parseFile(taglibOutput, { duration: true }),
      ]);
      const summarize = (metadata: Awaited<ReturnType<typeof parseFile>>) => ({
        album: metadata.common.album,
        duration: metadata.format.duration,
        privateTags: Object.values(metadata.native)
          .flatMap((tags) => tags)
          .filter((tag) =>
            tag.id.toLocaleUpperCase("en-US").includes("OUTGROOVE"),
          )
          .map((tag) => ({ id: tag.id, value: String(tag.value) })),
      });
      console.log(
        JSON.stringify({
          source,
          before: summarize(before),
          akabeko: summarize(akabeko),
          taglib: summarize(taglibResult),
          outputs: { akabekoOutput, taglibOutput },
        }),
      );
    }
  } finally {
    if (process.env.KEEP_SPIKE !== "1")
      await rm(temp, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
