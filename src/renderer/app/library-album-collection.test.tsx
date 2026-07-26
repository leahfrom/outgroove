// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import { LibraryAlbumCollection } from "./library-album-collection";

function album(
  id: string,
  title: string,
  releaseDates: readonly (string | null)[],
): CatalogAlbum {
  return {
    id,
    title,
    albumArtist: "Fixture Artist",
    tracks: releaseDates.map((year, index) => ({
      id: `${id}-${index}`,
      path: `/fixture/${id}-${index}.flac`,
      size: 100,
      modifiedMs: 1,
      format: "FLAC",
      durationSeconds: 10,
      tags: {
        title: `Track ${index + 1}`,
        album: title,
        artist: "Fixture Artist",
        albumArtist: "Fixture Artist",
        trackNumber: index + 1,
        discNumber: 1,
        year,
      },
      nativeTags: [],
      scanError: null,
    })),
  };
}

describe("LibraryAlbumCollection", () => {
  it("shows resilient cover placeholders and honest release-date states", () => {
    render(
      <LibraryAlbumCollection
        albums={[
          album("consistent", "Known Album", ["2024-03", "2024-03"]),
          album("mixed", "Mixed Album", ["2023", "2024"]),
          album("missing", "Missing Album", [null]),
        ]}
        diagnosticsByAlbum={new Map()}
        onOpenAlbum={vi.fn()}
        registerAlbumTrigger={vi.fn()}
      />,
    );

    const collection = screen.getByRole("list", { name: "Albums" });
    expect(within(collection).getAllByRole("button")).toHaveLength(3);
    expect(within(collection).getByText("2024-03")).toBeVisible();
    expect(within(collection).getByText("Mixed release dates")).toBeVisible();
    expect(within(collection).getByText("Release date not set")).toBeVisible();
    expect(
      collection.querySelectorAll(".album-artwork-placeholder"),
    ).toHaveLength(3);
  });

  it("opens an album with keyboard activation", async () => {
    const selected = album("selected", "Keyboard Album", ["2024"]);
    const onOpenAlbum = vi.fn();
    const user = userEvent.setup();
    render(
      <LibraryAlbumCollection
        albums={[selected]}
        diagnosticsByAlbum={new Map()}
        onOpenAlbum={onOpenAlbum}
        registerAlbumTrigger={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Keyboard Album/u });
    trigger.focus();
    await user.keyboard("{Enter}");

    expect(onOpenAlbum).toHaveBeenCalledWith(selected);
  });
});
