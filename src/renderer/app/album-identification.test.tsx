// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AlbumIdentificationResultDto } from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import { AlbumIdentification } from "./album-identification";

const album: CatalogAlbum = {
  id: "adb9be31-d450-45f9-99de-c9c6143988ad",
  title: "A very long Fixture Album title",
  albumArtist: "Fixture Artist",
  tracks: [],
};

const result: AlbumIdentificationResultDto = {
  albumId: album.id,
  sent: {
    albumTitle: album.title,
    albumArtist: album.albumArtist,
  },
  source: "network",
  fetchedAt: "2026-07-27T12:00:00.000Z",
  readOnly: true,
  candidates: [
    {
      releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
      releaseGroupId: "13a6d13b-f42a-49ba-8d54-893791d9f752",
      title: "A very long Fixture Album title",
      artistCredits: [
        {
          name: "Fixture Artist",
          joinPhrase: "",
          artistId: "7c08e5aa-3d6a-480f-8763-156120bc9bd9",
        },
      ],
      date: "2026-04-02",
      country: "DE",
      status: "Official",
      trackCount: 2,
      catalogNumbers: ["FIX-2026"],
      musicBrainzScore: 100,
      score: 85,
      confidence: "strong",
      matches: ["Album title matches", "Album artist matches"],
      conflicts: ["Track count differs (Library 0, MusicBrainz 2)"],
    },
  ],
};

describe("AlbumIdentification", () => {
  it("discloses the exact narrow request and requires an explicit search", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(
      <AlbumIdentification
        album={album}
        error={undefined}
        loading={false}
        result={undefined}
        onCancel={vi.fn()}
        onClose={vi.fn()}
        onCreateDraft={vi.fn()}
        onSearch={onSearch}
      />,
    );
    const dialog = screen.getByRole("dialog", {
      name: `Find MusicBrainz matches for ${album.title}`,
    });
    expect(dialog).toHaveTextContent(
      `sends only the album title “${album.title}” and album artist “Fixture Artist”`,
    );
    expect(dialog).toHaveTextContent(
      "never sends audio, artwork, file paths, native tags, or fingerprints",
    );
    expect(dialog).toHaveTextContent(
      "cannot preview, apply, or write metadata",
    );
    expect(onSearch).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "Search MusicBrainz" }),
    );
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it("shows confidence, evidence, conflicts, IDs, source, and unchanged state", () => {
    render(
      <AlbumIdentification
        album={album}
        error={undefined}
        loading={false}
        result={result}
        onCancel={vi.fn()}
        onClose={vi.fn()}
        onCreateDraft={vi.fn()}
        onSearch={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "1 candidate loaded from MusicBrainz. No Library metadata changed.",
    );
    const candidate = screen.getByRole("article");
    expect(candidate).toHaveTextContent("strong · 85/100");
    expect(candidate).toHaveTextContent("Album title matches");
    expect(candidate).toHaveTextContent(
      "Track count differs (Library 0, MusicBrainz 2)",
    );
    expect(candidate).toHaveTextContent("2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef");
    expect(
      screen.queryByRole("button", { name: /apply|write|accept/u }),
    ).not.toBeInTheDocument();
  });

  it("requires an explicit keyboard-reachable choice before creating a limited draft", async () => {
    const user = userEvent.setup();
    const onCreateDraft = vi.fn();
    const albumWithTrack: CatalogAlbum = {
      ...album,
      tracks: [
        {
          id: "d3a52a1d-f00b-46d8-ac01-e848675a2139",
          path: "/not-sent/track.flac",
          size: 1,
          modifiedMs: 1,
          format: "FLAC",
          durationSeconds: 1,
          tags: {
            title: "Track",
            album: album.title,
            artist: album.albumArtist,
            albumArtist: album.albumArtist,
            trackNumber: 1,
            discNumber: 1,
            year: "2025",
          },
          nativeTags: [],
          scanError: null,
        },
      ],
    };
    render(
      <AlbumIdentification
        album={albumWithTrack}
        error={undefined}
        loading={false}
        result={result}
        onCancel={vi.fn()}
        onClose={vi.fn()}
        onCreateDraft={onCreateDraft}
        onSearch={vi.fn()}
      />,
    );
    expect(onCreateDraft).not.toHaveBeenCalled();
    const button = screen.getByRole("button", {
      name: `Draft supported tags from ${result.candidates[0]?.title}, ${result.candidates[0]?.date}`,
    });
    button.focus();
    await user.keyboard("{Enter}");
    expect(onCreateDraft).toHaveBeenCalledWith(result.candidates[0]);
  });

  it("offers keyboard-reachable cancellation and reports recoverable failure", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const { rerender } = render(
      <AlbumIdentification
        album={album}
        error={undefined}
        loading
        result={undefined}
        onCancel={onCancel}
        onClose={vi.fn()}
        onCreateDraft={vi.fn()}
        onSearch={vi.fn()}
      />,
    );
    const cancel = screen.getByRole("button", { name: "Cancel search" });
    cancel.focus();
    await user.keyboard("{Enter}");
    expect(onCancel).toHaveBeenCalledOnce();

    rerender(
      <AlbumIdentification
        album={album}
        error="MusicBrainz is unavailable."
        loading={false}
        result={undefined}
        onCancel={onCancel}
        onClose={vi.fn()}
        onCreateDraft={vi.fn()}
        onSearch={vi.fn()}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Search failed: MusicBrainz is unavailable.",
    );
    expect(
      screen.getByRole("button", { name: "Search MusicBrainz" }),
    ).toBeEnabled();
  });
});
