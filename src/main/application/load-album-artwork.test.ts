import { describe, expect, it, vi } from "vitest";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import type { CatalogDatabase } from "../adapters/database/catalog-database";
import { LoadAlbumArtwork } from "./load-album-artwork";

const fixturePath = `${process.cwd()}/fixtures/audio/preservation/preservation.mp3`;

function album(id: string): CatalogAlbum {
  return {
    id,
    title: "Fixture Album",
    albumArtist: "Fixture Artist",
    tracks: [
      {
        id: `${id}-track`,
        path: fixturePath,
        size: 1,
        modifiedMs: 2,
        format: "MP3",
        durationSeconds: 1,
        tags: {
          title: "Track",
          album: "Fixture Album",
          artist: "Fixture Artist",
          albumArtist: "Fixture Artist",
          trackNumber: 1,
          discNumber: 1,
          year: "2026",
        },
        nativeTags: [],
        scanError: null,
      },
    ],
  };
}

describe("LoadAlbumArtwork", () => {
  it("resolves catalog album identities and caches only bounded thumbnails", async () => {
    const selected = album("6fdf7677-0e73-4f9a-85fd-6612ef381bdf");
    const getAlbum = vi.fn((id: string) =>
      id === selected.id ? selected : undefined,
    );
    const database = { getAlbum } as unknown as CatalogDatabase;
    const encode = vi.fn(() => "data:image/png;base64,thumbnail");
    const encoder = { encode };
    const loader = new LoadAlbumArtwork(database, encoder);

    await expect(loader.load([selected.id])).resolves.toEqual([
      {
        albumId: selected.id,
        status: "available",
        dataUrl: "data:image/png;base64,thumbnail",
      },
    ]);
    await loader.load([selected.id]);

    expect(getAlbum).toHaveBeenCalledWith(selected.id);
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("returns a path-free missing result for an unknown album", async () => {
    const database = {
      getAlbum: vi.fn(() => undefined),
    } as unknown as CatalogDatabase;
    const loader = new LoadAlbumArtwork(database, { encode: vi.fn() });
    const albumId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";

    await expect(loader.load([albumId])).resolves.toEqual([
      { albumId, status: "missing" },
    ]);
  });
});
