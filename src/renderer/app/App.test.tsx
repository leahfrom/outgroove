// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OutgrooveApi, ScanJobDto } from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import { App } from "./App";

const album: CatalogAlbum = {
  id: "4438e3e0-a489-4be4-b75c-1fb0d62c435a",
  title: "Fixture Album",
  albumArtist: "Fixture Artist",
  tracks: [
    {
      id: "d3a52a1d-f00b-46d8-ac01-e848675a2139",
      path: "/fixture/track.mp3",
      size: 100,
      modifiedMs: 1,
      format: "MPEG",
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
      nativeTags: [{ id: "ID3v2:TALB", value: "Fixture Album" }],
      scanError: null,
    },
  ],
};

function api(applyVerified: boolean): OutgrooveApi {
  const track = album.tracks[0];
  if (!track) throw new Error("Test track missing");
  return {
    chooseLibraryFolder: vi.fn(),
    listLibraryRoots: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    scanLibrary: vi.fn(),
    cancelScan: vi.fn(),
    getLatestScanJob: vi.fn(() => Promise.resolve({ ok: true, value: null })),
    createDatabaseBackup: vi.fn(),
    chooseDatabaseRestore: vi.fn(),
    applyDatabaseRestore: vi.fn(),
    queryLibrary: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: {
          albums: [album],
          artists: [],
          tracks: [],
          scanErrors: [],
          totalItems: 1,
          offset: 0,
          limit: 20,
        },
      }),
    ),
    previewAlbumTitleEdit: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: {
          operationId: "853a8e28-560a-4261-b152-1fe31c26dc42",
          confirmationToken: "confirmation-token-long-enough",
          files: [
            {
              fileId: track.id,
              path: track.path,
              before: "Fixture Album",
              after: "Renamed Album",
              warnings: [],
            },
          ],
        },
      }),
    ),
    applyAlbumTitleEdit: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: {
          operationId: "853a8e28-560a-4261-b152-1fe31c26dc42",
          results: [
            {
              fileId: track.id,
              path: track.path,
              verified: applyVerified,
              error: applyVerified ? null : "verification failed",
            },
          ],
        },
      }),
    ),
    listAlbumEditHistory: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    previewAlbumTitleUndo: vi.fn(),
    applyAlbumTitleUndo: vi.fn(),
    previewTrackTagEdit: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: {
          operationId: "4f2f7939-d847-47e0-a08e-ae47ac0727b2",
          confirmationToken: "track-confirmation-token-long-enough",
          fileId: track.id,
          path: track.path,
          changes: [
            { field: "title", before: "Track", after: "Renamed Track" },
            {
              field: "artist",
              before: "Fixture Artist",
              after: "Different Artist",
            },
          ],
          warnings: [],
        },
      }),
    ),
    applyTrackTagEdit: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: {
          operationId: "4f2f7939-d847-47e0-a08e-ae47ac0727b2",
          results: [
            {
              fileId: track.id,
              path: track.path,
              verified: applyVerified,
              error: applyVerified ? null : "stale preview",
            },
          ],
        },
      }),
    ),
    previewTrackTagUndo: vi.fn(),
    applyTrackTagUndo: vi.fn(),
    previewTrackBatchEdit: vi.fn(),
    applyTrackBatchEdit: vi.fn(),
    previewTrackBatchUndo: vi.fn(),
    applyTrackBatchUndo: vi.fn(),
    previewTrackNumberSequence: vi.fn(),
    applyTrackNumberSequence: vi.fn(),
    chooseSyncTargetAndCreateProfile: vi.fn(),
    planSync: vi.fn(),
    applySync: vi.fn(),
    onJobProgress: vi.fn(() => () => undefined),
    onScanJobUpdated: vi.fn(() => () => undefined),
  } as OutgrooveApi;
}

describe("tag edit UI safety states", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows per-file before/after preview before exposing explicit confirmation", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(true),
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });
    await user.type(screen.getByLabelText("Proposed title"), "Renamed Album");
    await user.click(
      screen.getByRole("button", { name: "Preview per-file changes" }),
    );
    expect(await screen.findByRole("table")).toHaveTextContent("Fixture Album");
    expect(screen.getByRole("table")).toHaveTextContent("Renamed Album");
    expect(
      screen.getByRole("button", { name: "Confirm and write 1 files" }),
    ).toBeEnabled();
  });

  it("previews selected track fields before confirmation and reports verified apply", async () => {
    const mockApi = api(true);
    const previewSpy = vi.spyOn(mockApi, "previewTrackTagEdit");
    const applySpy = vi.spyOn(mockApi, "applyTrackTagEdit");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });
    await user.click(
      screen.getByRole("button", { name: "Edit track metadata" }),
    );
    await user.clear(screen.getByLabelText("Track title"));
    await user.type(screen.getByLabelText("Track title"), "Renamed Track");
    await user.clear(screen.getByLabelText("Track artist"));
    await user.type(screen.getByLabelText("Track artist"), "Different Artist");
    expect(
      screen.queryByRole("button", { name: "Confirm and write track" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Preview track changes" }),
    );
    const preview = await screen.findByLabelText("Track metadata confirmation");
    expect(within(preview).getByText("Renamed Track")).toBeInTheDocument();
    expect(within(preview).getByText("Different Artist")).toBeInTheDocument();
    await user.click(
      within(preview).getByRole("button", {
        name: "Confirm and write track",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Track metadata write was re-read and verified.",
      ),
    );
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(previewSpy.mock.calls[0]?.[0]).toMatchObject({
      fileId: album.tracks[0]?.id,
      changes: {
        title: "Renamed Track",
        artist: "Different Artist",
      },
    });
    expect(applySpy).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed track edit preview visible with its stale-write error", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(false),
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });
    await user.click(
      screen.getByRole("button", { name: "Edit track metadata" }),
    );
    await user.clear(screen.getByLabelText("Track title"));
    await user.type(screen.getByLabelText("Track title"), "Renamed Track");
    await user.click(
      screen.getByRole("button", { name: "Preview track changes" }),
    );
    const preview = await screen.findByLabelText("Track metadata confirmation");
    await user.click(
      within(preview).getByRole("button", {
        name: "Confirm and write track",
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Track metadata was not changed: stale preview",
      ),
    );
    expect(
      screen.getByLabelText("Track metadata confirmation"),
    ).toBeInTheDocument();
  });

  it("requires explicit batch fields, previews each file, and reports partial failure", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const secondTrack: CatalogAlbum["tracks"][number] = {
      ...firstTrack,
      id: "c878d5df-f462-45ec-a4b1-84623fd525b3",
      path: "/fixture/second.flac",
      format: "FLAC",
      tags: { ...firstTrack.tags, title: "Second Track", trackNumber: 2 },
    };
    const batchAlbum = { ...album, tracks: [...album.tracks, secondTrack] };
    const mockApi = api(true);
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [batchAlbum],
        artists: [],
        tracks: [],
        scanErrors: [],
        totalItems: 1,
        offset: 0,
        limit: 20,
      },
    });
    const preview = vi.spyOn(mockApi, "previewTrackBatchEdit");
    preview.mockResolvedValue({
      ok: true,
      value: {
        operationId: "216c5a1d-84c7-42d5-9191-6f0ea83b50bb",
        confirmationToken: "batch-confirmation-token-long-enough",
        files: batchAlbum.tracks.map((track) => ({
          fileId: track.id,
          path: track.path,
          changes: [
            {
              field: "artist" as const,
              before: "Fixture Artist",
              after: "Batch Artist",
            },
          ],
          warnings: [],
          willWrite: true,
        })),
      },
    });
    vi.spyOn(mockApi, "applyTrackBatchEdit").mockResolvedValue({
      ok: true,
      value: {
        operationId: "216c5a1d-84c7-42d5-9191-6f0ea83b50bb",
        results: [
          {
            fileId: firstTrack.id,
            path: firstTrack.path,
            verified: true,
            error: null,
          },
          {
            fileId: secondTrack.id,
            path: secondTrack.path,
            verified: false,
            error: "stale preview",
          },
        ],
      },
    });
    vi.spyOn(mockApi, "listAlbumEditHistory").mockResolvedValue({
      ok: true,
      value: [
        {
          operationId: "216c5a1d-84c7-42d5-9191-6f0ea83b50bb",
          kind: "track-tags-batch-edit",
          sourceOperationId: null,
          proposedTitle: "Batch metadata: artist",
          state: "completed",
          createdAt: "2026-07-21T00:00:00.000Z",
          completedAt: "2026-07-21T00:01:00.000Z",
          verifiedFiles: 2,
          failedFiles: 0,
        },
      ],
    });
    const previewUndo = vi.spyOn(mockApi, "previewTrackBatchUndo");
    previewUndo.mockResolvedValue({
      ok: true,
      value: {
        operationId: "94f1e501-f5c4-456e-91ae-8d03b65fd795",
        confirmationToken: "batch-undo-confirmation-token-long-enough",
        files: batchAlbum.tracks.map((track, index) => ({
          fileId: track.id,
          path: track.path,
          changes: [
            {
              field: "artist" as const,
              before: "Batch Artist",
              after: "Fixture Artist",
            },
          ],
          warnings:
            index === 0
              ? [
                  "A field changed after this batch edit; undo will not overwrite it.",
                ]
              : [],
          willWrite: true,
        })),
      },
    });
    vi.spyOn(mockApi, "applyTrackBatchUndo").mockResolvedValue({
      ok: true,
      value: {
        operationId: "94f1e501-f5c4-456e-91ae-8d03b65fd795",
        results: [
          {
            fileId: firstTrack.id,
            path: firstTrack.path,
            verified: false,
            error: "stale batch field",
          },
          {
            fileId: secondTrack.id,
            path: secondTrack.path,
            verified: true,
            error: null,
          },
        ],
      },
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });
    await user.click(screen.getByRole("button", { name: "Select all tracks" }));
    const previewButton = screen.getByRole("button", {
      name: "Preview selected tracks",
    });
    expect(previewButton).toBeDisabled();
    await user.click(
      screen.getByRole("checkbox", { name: "Change track artist" }),
    );
    await user.type(
      screen.getByLabelText("Batch track artist value"),
      "Batch Artist",
    );
    expect(previewButton).toBeEnabled();
    await user.click(previewButton);
    const confirmation = await screen.findByLabelText("Batch confirmation");
    expect(
      within(confirmation).getByText("/fixture/track.mp3"),
    ).toBeInTheDocument();
    expect(
      within(confirmation).getByText("/fixture/second.flac"),
    ).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith({
      fileIds: batchAlbum.tracks.map((track) => track.id),
      changes: { artist: "Batch Artist" },
    });
    await user.click(
      within(confirmation).getByRole("button", {
        name: "Confirm and write selected tracks",
      }),
    );
    expect(await screen.findByText(/stale preview/u)).toBeInTheDocument();
    expect(
      screen.getByText(/1 writes verified; 1 failed/u),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Preview batch undo" }),
    );
    const undoConfirmation = await screen.findByLabelText(
      "Batch metadata undo confirmation",
    );
    expect(within(undoConfirmation).getByRole("alert")).toHaveTextContent(
      "changed after this batch edit",
    );
    const confirmUndo = within(undoConfirmation).getByRole("button", {
      name: "Confirm safe batch undo writes",
    });
    expect(confirmUndo).toBeEnabled();
    await user.click(confirmUndo);
    expect(await screen.findByText(/stale batch field/u)).toBeInTheDocument();
    expect(
      screen.getByText(/1 undo writes verified; 1 refused/u),
    ).toBeInTheDocument();
    expect(previewUndo).toHaveBeenCalledWith({
      operationId: "216c5a1d-84c7-42d5-9191-6f0ea83b50bb",
    });
  });

  it("previews track numbers in the explicit reordered selection", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const secondTrack: CatalogAlbum["tracks"][number] = {
      ...firstTrack,
      id: "c878d5df-f462-45ec-a4b1-84623fd525b3",
      path: "/fixture/second.flac",
      format: "FLAC",
      tags: { ...firstTrack.tags, title: "Second Track", trackNumber: 2 },
    };
    const sequenceAlbum = { ...album, tracks: [firstTrack, secondTrack] };
    const mockApi = api(true);
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [sequenceAlbum],
        artists: [],
        tracks: [],
        scanErrors: [],
        totalItems: 1,
        offset: 0,
        limit: 20,
      },
    });
    const preview = vi.spyOn(mockApi, "previewTrackNumberSequence");
    preview.mockResolvedValue({
      ok: true,
      value: {
        operationId: "d827fc36-9d73-4149-914b-ef7a3915692c",
        confirmationToken: "sequence-confirmation-token-long-enough",
        files: [
          {
            fileId: secondTrack.id,
            path: secondTrack.path,
            changes: [
              { field: "trackNumber", before: 2, after: 7 },
              { field: "discNumber", before: 1, after: 3 },
            ],
            warnings: [],
            willWrite: true,
          },
          {
            fileId: firstTrack.id,
            path: firstTrack.path,
            changes: [
              { field: "trackNumber", before: 1, after: 8 },
              { field: "discNumber", before: 1, after: 3 },
            ],
            warnings: [],
            willWrite: true,
          },
        ],
      },
    });
    vi.spyOn(mockApi, "applyTrackNumberSequence").mockResolvedValue({
      ok: true,
      value: {
        operationId: "d827fc36-9d73-4149-914b-ef7a3915692c",
        results: [secondTrack, firstTrack].map((track) => ({
          fileId: track.id,
          path: track.path,
          verified: true,
          error: null,
        })),
      },
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });
    await user.click(screen.getByRole("button", { name: "Select all tracks" }));
    await user.click(
      screen.getByRole("button", { name: "Move Second Track up" }),
    );
    const start = screen.getByLabelText("Starting track number");
    await user.clear(start);
    await user.type(start, "7");
    await user.click(
      screen.getByRole("checkbox", {
        name: "Set one disc number for this sequence",
      }),
    );
    const discNumber = screen.getByLabelText("Sequence disc number");
    await user.clear(discNumber);
    await user.type(discNumber, "3");
    await user.click(
      screen.getByRole("button", { name: "Preview track-number sequence" }),
    );
    expect(preview).toHaveBeenCalledWith({
      fileIds: [secondTrack.id, firstTrack.id],
      startNumber: 7,
      discNumber: 3,
    });
    const confirmation = await screen.findByLabelText(
      "Track number sequence confirmation",
    );
    expect(within(confirmation).getByText(/2 → 7/u)).toBeInTheDocument();
    expect(within(confirmation).getByText(/1 → 8/u)).toBeInTheDocument();
    expect(within(confirmation).getAllByText(/1 → 3/u)).toHaveLength(2);
    await user.click(
      within(confirmation).getByRole("button", {
        name: "Confirm track-number sequence",
      }),
    );
    expect(
      await screen.findByText("Re-read and verified 2 track-number writes."),
    ).toBeInTheDocument();
  });

  it("shows affected files and routes a keyboard action into sequencing without previewing", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const duplicateA: CatalogAlbum["tracks"][number] = {
      ...firstTrack,
      id: "c878d5df-f462-45ec-a4b1-84623fd525b3",
      path: "/fixture/duplicate-a.flac",
      tags: { ...firstTrack.tags, title: "Duplicate A", trackNumber: 2 },
    };
    const duplicateB: CatalogAlbum["tracks"][number] = {
      ...firstTrack,
      id: "b9b669f0-5996-4365-b2ec-9f1348bedaf5",
      path: "/fixture/duplicate-b.mp3",
      tags: { ...firstTrack.tags, title: "Duplicate B", trackNumber: 2 },
    };
    const diagnosticAlbum = {
      ...album,
      tracks: [firstTrack, duplicateB, duplicateA],
    };
    const mockApi = api(true);
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [diagnosticAlbum],
        artists: [],
        tracks: [],
        scanErrors: [],
        totalItems: 1,
        offset: 0,
        limit: 20,
      },
    });
    const previewSequence = vi.spyOn(mockApi, "previewTrackNumberSequence");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);

    const diagnostics = await screen.findByLabelText("Album data quality");
    const duplicateFinding = within(diagnostics)
      .getByRole("heading", { name: "Duplicate number on disc 1" })
      .closest("article");
    if (!duplicateFinding) throw new Error("Duplicate finding missing");
    expect(duplicateFinding).toHaveTextContent("/fixture/duplicate-a.flac");
    expect(duplicateFinding).toHaveTextContent("/fixture/duplicate-b.mp3");
    expect(duplicateFinding).toHaveTextContent("Status: Needs attention");
    const route = within(duplicateFinding).getByRole("button", {
      name: "Select affected tracks for sequencing",
    });
    route.focus();
    await user.keyboard("[Enter]");

    expect(
      screen.getByRole("checkbox", {
        name: "Select Duplicate A for batch edit",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Select Duplicate B for batch edit",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select Track for batch edit" }),
    ).not.toBeChecked();
    expect(screen.getByLabelText("Track number sequencing")).toHaveFocus();
    expect(previewSequence).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("Track number sequence confirmation"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "no preview or write has started",
    );
  });

  it("routes inconsistent catalog values to an empty batch proposal", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const secondTrack: CatalogAlbum["tracks"][number] = {
      ...firstTrack,
      id: "c878d5df-f462-45ec-a4b1-84623fd525b3",
      path: "/fixture/second.flac",
      tags: {
        ...firstTrack.tags,
        title: "Second",
        trackNumber: 2,
        albumArtist: "Different Album Artist",
        year: "2026-07",
      },
    };
    const diagnosticAlbum = { ...album, tracks: [firstTrack, secondTrack] };
    const mockApi = api(true);
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [diagnosticAlbum],
        artists: [],
        tracks: [],
        scanErrors: [],
        totalItems: 1,
        offset: 0,
        limit: 20,
      },
    });
    const previewBatch = vi.spyOn(mockApi, "previewTrackBatchEdit");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);

    const diagnostics = await screen.findByLabelText("Album data quality");
    expect(
      within(diagnostics).getByRole("heading", {
        name: "Inconsistent release dates",
      }),
    ).toBeVisible();
    await user.click(
      within(diagnostics).getByRole("button", {
        name: "Select affected tracks for album artist review",
      }),
    );

    expect(screen.getByLabelText("Batch metadata editor")).toHaveFocus();
    expect(
      screen.getByRole("checkbox", { name: "Change album artist" }),
    ).toBeChecked();
    expect(screen.getByLabelText("Batch album artist value")).toHaveValue("");
    expect(
      screen.getAllByRole("checkbox", { name: /for batch edit/u }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checked: true }),
        expect.objectContaining({ checked: true }),
      ]),
    );
    expect(previewBatch).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("Batch confirmation"),
    ).not.toBeInTheDocument();
  });

  it("summarizes flagged albums on the bounded page and opens their findings", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const flaggedAlbum: CatalogAlbum = {
      id: "8c196850-bca9-48b7-ae7f-dc760fbf8f2b",
      title: "Flagged Album",
      albumArtist: "Fixture Artist",
      tracks: [
        {
          ...firstTrack,
          id: "dbb54a30-a8ce-45e1-9354-d6ae9a432afc",
          path: "/fixture/flagged-a.flac",
          tags: {
            ...firstTrack.tags,
            album: "Flagged Album",
            title: "Flagged A",
            trackNumber: 2,
          },
        },
        {
          ...firstTrack,
          id: "e97b14d0-60fa-4b01-b2a7-33dfa51bc2c3",
          path: "/fixture/flagged-b.flac",
          tags: {
            ...firstTrack.tags,
            album: "Flagged Album",
            title: "Flagged B",
            trackNumber: 2,
          },
        },
      ],
    };
    const mockApi = api(true);
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [album, flaggedAlbum],
        artists: [],
        tracks: [],
        scanErrors: [],
        totalItems: 2,
        offset: 0,
        limit: 20,
      },
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);

    const albumList = await screen.findByLabelText("Albums");
    expect(
      within(albumList).getByText(
        "Albums needing review on this page: 1 of 2.",
      ),
    ).toBeVisible();
    expect(
      within(albumList).getByText("Status: No data-quality findings"),
    ).toBeVisible();
    expect(
      within(albumList).getByText(
        "Status: 1 data-quality finding — needs attention",
      ),
    ).toBeVisible();

    await user.click(
      within(albumList).getByRole("button", { name: /Flagged Album/u }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Duplicate number on disc 1",
      }),
    ).toBeVisible();
    const details = screen.getByLabelText("Album data quality");
    expect(within(details).getByText("/fixture/flagged-a.flac")).toBeVisible();
    expect(within(details).getByText("/fixture/flagged-b.flac")).toBeVisible();
  });

  it("reports verification failure without claiming success", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(false),
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });
    await user.type(screen.getByLabelText("Proposed title"), "Renamed Album");
    await user.click(
      screen.getByRole("button", { name: "Preview per-file changes" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Confirm and write 1 files" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "1 writes failed verification",
    );
    expect(screen.getByRole("status")).not.toHaveTextContent("Verified 1");
  });

  it("shows history and requires a per-file undo preview before confirmation", async () => {
    const mockApi = api(true);
    const listAlbumEditHistory = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: [
          {
            operationId: "75d39ca7-fc00-41b7-a132-2024b912573f",
            kind: "album-title-edit" as const,
            sourceOperationId: null,
            proposedTitle: "Renamed Album",
            state: "completed" as const,
            createdAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-01T00:01:00.000Z",
            verifiedFiles: 1,
            failedFiles: 0,
          },
        ],
      }),
    );
    const previewAlbumTitleUndo = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          operationId: "fba25f9c-51ad-41c7-a838-4dcdf20a587a",
          confirmationToken: "undo-confirmation-token-long-enough",
          files: [
            {
              fileId: album.tracks[0]?.id ?? "",
              path: "/fixture/track.mp3",
              before: "Renamed Album",
              after: "Fixture Album",
              warnings: [],
            },
          ],
        },
      }),
    );
    const applyAlbumTitleUndo = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          operationId: "fba25f9c-51ad-41c7-a838-4dcdf20a587a",
          results: [
            {
              fileId: album.tracks[0]?.id ?? "",
              path: "/fixture/track.mp3",
              verified: true,
              error: null,
            },
          ],
        },
      }),
    );
    Object.assign(mockApi, {
      listAlbumEditHistory,
      previewAlbumTitleUndo,
      applyAlbumTitleUndo,
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    const history = await screen.findByLabelText("Metadata edit history");
    expect(
      await within(history).findByText("Changed title to “Renamed Album”"),
    ).toBeVisible();
    await user.click(
      within(history).getByRole("button", { name: "Preview undo" }),
    );
    const preview = await screen.findByLabelText("Tag undo confirmation");
    expect(preview).toHaveTextContent("Renamed Album");
    expect(preview).toHaveTextContent("Fixture Album");
    expect(
      within(preview).getByRole("button", {
        name: "Confirm and undo 1 files",
      }),
    ).toBeEnabled();
    expect(previewAlbumTitleUndo).toHaveBeenCalledWith({
      operationId: "75d39ca7-fc00-41b7-a132-2024b912573f",
    });
    await user.click(
      within(preview).getByRole("button", {
        name: "Confirm and undo 1 files",
      }),
    );
    expect(applyAlbumTitleUndo).toHaveBeenCalledWith({
      operationId: "fba25f9c-51ad-41c7-a838-4dcdf20a587a",
      confirmationToken: "undo-confirmation-token-long-enough",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Verified undo for 1 files",
    );
  });

  it("previews and confirms field-scoped track metadata undo from history", async () => {
    const mockApi = api(true);
    const listAlbumEditHistory = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: [
          {
            operationId: "65c67a16-cd0d-445d-b2b9-5377e804b84c",
            kind: "track-tags-edit" as const,
            sourceOperationId: null,
            proposedTitle: "Track metadata: artist, year",
            state: "completed" as const,
            createdAt: "2026-07-22T00:00:00.000Z",
            completedAt: "2026-07-22T00:00:01.000Z",
            verifiedFiles: 1,
            failedFiles: 0,
          },
        ],
      }),
    );
    const previewTrackTagUndo = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          operationId: "13308fb8-81b4-4cf0-b437-9602468873e3",
          confirmationToken: "track-undo-confirmation-token-long-enough",
          fileId: album.tracks[0]?.id ?? "",
          path: "/fixture/track.mp3",
          changes: [
            {
              field: "artist" as const,
              before: "Different Artist",
              after: "Fixture Artist",
            },
            { field: "year" as const, before: "2030", after: "2026" },
          ],
          warnings: [],
        },
      }),
    );
    const applyTrackTagUndo = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          operationId: "13308fb8-81b4-4cf0-b437-9602468873e3",
          results: [
            {
              fileId: album.tracks[0]?.id ?? "",
              path: "/fixture/track.mp3",
              verified: true,
              error: null,
            },
          ],
        },
      }),
    );
    Object.assign(mockApi, {
      listAlbumEditHistory,
      previewTrackTagUndo,
      applyTrackTagUndo,
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    const history = await screen.findByLabelText("Metadata edit history");
    await user.click(
      await within(history).findByRole("button", {
        name: "Preview track undo",
      }),
    );
    const preview = await screen.findByLabelText(
      "Track metadata undo confirmation",
    );
    expect(preview).toHaveTextContent("Different Artist");
    expect(preview).toHaveTextContent("Fixture Artist");
    expect(preview).toHaveTextContent("2030");
    expect(preview).toHaveTextContent("2026");
    await user.click(
      within(preview).getByRole("button", {
        name: "Confirm and undo track fields",
      }),
    );
    expect(previewTrackTagUndo).toHaveBeenCalledWith({
      operationId: "65c67a16-cd0d-445d-b2b9-5377e804b84c",
    });
    expect(applyTrackTagUndo).toHaveBeenCalledWith({
      operationId: "13308fb8-81b4-4cf0-b437-9602468873e3",
      confirmationToken: "track-undo-confirmation-token-long-enough",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Track metadata undo was re-read and verified.",
    );
  });

  it("disables track undo confirmation when the preview reports a conflict", async () => {
    const mockApi = api(true);
    Object.assign(mockApi, {
      listAlbumEditHistory: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: [
            {
              operationId: "65c67a16-cd0d-445d-b2b9-5377e804b84c",
              kind: "track-tags-edit" as const,
              sourceOperationId: null,
              proposedTitle: "Track metadata: artist",
              state: "completed" as const,
              createdAt: "2026-07-22T00:00:00.000Z",
              completedAt: "2026-07-22T00:00:01.000Z",
              verifiedFiles: 1,
              failedFiles: 0,
            },
          ],
        }),
      ),
      previewTrackTagUndo: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: {
            operationId: "13308fb8-81b4-4cf0-b437-9602468873e3",
            confirmationToken: "track-undo-confirmation-token-long-enough",
            fileId: album.tracks[0]?.id ?? "",
            path: "/fixture/track.mp3",
            changes: [
              {
                field: "artist" as const,
                before: "External Artist",
                after: "Fixture Artist",
              },
            ],
            warnings: [
              "A field changed after this edit; undo will not overwrite it.",
            ],
          },
        }),
      ),
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    const history = await screen.findByLabelText("Metadata edit history");
    await user.click(
      await within(history).findByRole("button", {
        name: "Preview track undo",
      }),
    );
    const preview = await screen.findByLabelText(
      "Track metadata undo confirmation",
    );
    expect(within(preview).getByRole("alert")).toHaveTextContent(
      "undo will not overwrite it",
    );
    expect(
      within(preview).getByRole("button", {
        name: "Confirm and undo track fields",
      }),
    ).toBeDisabled();
  });

  it("disables undo confirmation when an intervening edit creates a conflict", async () => {
    const mockApi = api(true);
    Object.assign(mockApi, {
      listAlbumEditHistory: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: [
            {
              operationId: "75d39ca7-fc00-41b7-a132-2024b912573f",
              kind: "album-title-edit" as const,
              sourceOperationId: null,
              proposedTitle: "Renamed Album",
              state: "completed" as const,
              createdAt: "2026-01-01T00:00:00.000Z",
              completedAt: "2026-01-01T00:01:00.000Z",
              verifiedFiles: 1,
              failedFiles: 0,
            },
          ],
        }),
      ),
      previewAlbumTitleUndo: vi.fn(() =>
        Promise.resolve({
          ok: true as const,
          value: {
            operationId: "fba25f9c-51ad-41c7-a838-4dcdf20a587a",
            confirmationToken: "undo-confirmation-token-long-enough",
            files: [
              {
                fileId: album.tracks[0]?.id ?? "",
                path: "/fixture/track.mp3",
                before: "Manual Title",
                after: "Fixture Album",
                warnings: [
                  "The album title changed after this edit; undo will not overwrite it.",
                ],
              },
            ],
          },
        }),
      ),
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Preview undo" }),
    );
    const preview = await screen.findByLabelText("Tag undo confirmation");
    expect(preview).toHaveTextContent("will not overwrite it");
    expect(
      within(preview).getByRole("button", {
        name: "Confirm and undo 1 files",
      }),
    ).toBeDisabled();
  });

  it("restores an interrupted scan and offers an explicit retry", async () => {
    const mockApi = api(true);
    const listLibraryRoots = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        {
          id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
          path: "/fixture",
          lastScanAt: null,
        },
      ],
    });
    const getLatestScanJob = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
        rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
        state: "interrupted",
        completed: 4,
        total: 10,
        detail: "Scan interrupted",
        result: null,
        error: "Outgroove closed before this scan finished.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
        finishedAt: "2026-01-01T00:01:00.000Z",
      },
    });
    Object.assign(mockApi, { listLibraryRoots, getLatestScanJob });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    render(<App />);
    expect(await screen.findByText("Library scan: interrupted")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry scan" })).toBeEnabled();
  });

  it("exposes cancellation only for an active scan", async () => {
    const mockApi = api(true);
    const runningJob: ScanJobDto = {
      id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
      rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
      state: "running",
      completed: 1,
      total: 3,
      detail: "track.mp3",
      result: null,
      error: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      finishedAt: null,
    };
    const getLatestScanJob = vi.fn().mockResolvedValue({
      ok: true,
      value: runningJob,
    });
    const cancelScan = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ...runningJob,
        state: "cancelling",
        detail: "Cancelling safely…",
      },
    });
    Object.assign(mockApi, { getLatestScanJob, cancelScan });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Cancel scan" }),
    );
    expect(
      screen.getByRole("progressbar", { name: "Reading audio metadata" }),
    ).toHaveAttribute("value", "1");
    expect(cancelScan).toHaveBeenCalledWith({
      jobId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
    });
    expect(
      await screen.findByRole("button", { name: "Cancelling…" }),
    ).toBeDisabled();
  });

  it("shows indeterminate discovery counts before metadata total is known", async () => {
    const mockApi = api(true);
    const getLatestScanJob = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
        rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
        state: "running",
        completed: 17,
        total: 0,
        detail: "Discovering: 17 audio files found, 2 folder problems.",
        result: null,
        error: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:01.000Z",
        finishedAt: null,
      } satisfies ScanJobDto,
    });
    Object.assign(mockApi, { getLatestScanJob });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    render(<App />);
    expect(
      await screen.findByText(
        "Discovering: 17 audio files found, 2 folder problems.",
      ),
    ).toBeVisible();
    const progress = screen.getByRole("progressbar", {
      name: "Discovering audio files",
    });
    expect(progress).not.toHaveAttribute("value");
    expect(screen.getByRole("button", { name: "Cancel scan" })).toBeEnabled();
  });

  it("submits bounded search intent and switches to item-level scan problems", async () => {
    const mockApi = api(true);
    const queryLibrary = vi.fn((request: { view: string }) =>
      Promise.resolve({
        ok: true as const,
        value:
          request.view === "scan-errors"
            ? {
                albums: [],
                artists: [],
                tracks: [],
                scanErrors: [
                  {
                    kind: "file" as const,
                    path: "/fixture/corrupt.mp3",
                    message: "Invalid MPEG",
                  },
                  {
                    kind: "directory" as const,
                    path: "/fixture/blocked",
                    message: "Permission denied",
                  },
                ],
                totalItems: 2,
                offset: 0,
                limit: 20,
              }
            : {
                albums: [album],
                artists: [],
                tracks: [],
                scanErrors: [],
                totalItems: 1,
                offset: 0,
                limit: 20,
              },
      }),
    );
    Object.assign(mockApi, { queryLibrary });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await user.type(
      screen.getByRole("searchbox", { name: "Search Library" }),
      "Needle",
    );
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenCalledWith({
        query: "Needle",
        view: "albums",
        offset: 0,
        limit: 20,
      }),
    );
    await user.selectOptions(screen.getByLabelText("View"), "scan-errors");
    expect(await screen.findByText("/fixture/corrupt.mp3")).toBeVisible();
    expect(screen.getByText("Audio file could not be read")).toBeVisible();
    expect(screen.getByText("Invalid MPEG")).toBeVisible();
    expect(screen.getByText("Folder could not be scanned")).toBeVisible();
    expect(screen.getByText("/fixture/blocked")).toBeVisible();
  });

  it("browses album artists and opens an exact removable album filter", async () => {
    const mockApi = api(true);
    const queryLibrary = vi
      .spyOn(mockApi, "queryLibrary")
      .mockImplementation((request) =>
        Promise.resolve({
          ok: true,
          value: {
            albums: request.view === "albums" ? [album] : [],
            artists:
              request.view === "artists"
                ? [
                    {
                      name: "Fixture Artist",
                      albumCount: 2,
                      trackCount: 7,
                    },
                  ]
                : [],
            tracks: [],
            scanErrors: [],
            totalItems: request.view === "artists" ? 21 : 1,
            offset: request.offset,
            limit: request.limit,
          },
        }),
      );
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });

    await user.selectOptions(screen.getByLabelText("View"), "artists");
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "artists",
        offset: 0,
        limit: 20,
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Album artists" }),
    ).toBeVisible();
    expect(screen.getByText("Status: 2 albums · 7 tracks")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "artists",
        offset: 20,
        limit: 20,
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Browse albums by Fixture Artist" }),
    );
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "albums",
        offset: 0,
        limit: 20,
        albumArtist: "Fixture Artist",
      }),
    );
    expect(screen.getByText("1 album by “Fixture Artist”")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Show all album artists" }),
    );
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "albums",
        offset: 0,
        limit: 20,
      }),
    );
  });

  it("browses tracks with file context and opens the existing preview-only editor", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const mockApi = api(true);
    const previewTrackTagEdit = vi.spyOn(mockApi, "previewTrackTagEdit");
    const queryLibrary = vi
      .spyOn(mockApi, "queryLibrary")
      .mockImplementation((request) =>
        Promise.resolve({
          ok: true,
          value: {
            albums: request.view === "albums" ? [album] : [],
            artists: [],
            tracks:
              request.view === "tracks"
                ? [
                    {
                      id: firstTrack.id,
                      albumId: album.id,
                      title: firstTrack.tags.title,
                      artist: firstTrack.tags.artist,
                      albumTitle: album.title,
                      albumArtist: album.albumArtist,
                      trackNumber: firstTrack.tags.trackNumber,
                      discNumber: firstTrack.tags.discNumber,
                      format: firstTrack.format,
                      durationSeconds: firstTrack.durationSeconds,
                      path: firstTrack.path,
                    },
                  ]
                : [],
            scanErrors: [],
            totalItems: 1,
            offset: request.offset,
            limit: request.limit,
          },
        }),
      );
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });

    await user.selectOptions(screen.getByLabelText("View"), "tracks");
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "tracks",
        offset: 0,
        limit: 20,
      }),
    );
    const table = await screen.findByRole("table");
    expect(within(table).getByText(firstTrack.path)).toBeVisible();
    expect(within(table).getByText(album.title)).toBeVisible();

    await user.click(
      within(table).getByRole("button", {
        name: `Open ${firstTrack.tags.title} in Workbench`,
      }),
    );
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "albums",
        offset: 0,
        limit: 20,
        albumId: album.id,
      }),
    );
    expect(await screen.findByLabelText("Track metadata editor")).toHaveFocus();
    expect(screen.getByLabelText("Track title")).toHaveValue(
      firstTrack.tags.title,
    );
    expect(previewTrackTagEdit).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Show all albums" }),
    ).toBeVisible();
  });

  it("queries the worker-backed data-quality view and shows its progress", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const flaggedAlbum: CatalogAlbum = {
      ...album,
      id: "8c196850-bca9-48b7-ae7f-dc760fbf8f2b",
      title: "Flagged Album",
      tracks: [
        {
          ...firstTrack,
          id: "dbb54a30-a8ce-45e1-9354-d6ae9a432afc",
          path: "/fixture/flagged.flac",
          tags: {
            ...firstTrack.tags,
            album: "Flagged Album",
            title: "Unknown title",
          },
        },
      ],
    };
    const mockApi = api(true);
    const queryLibrary = vi
      .spyOn(mockApi, "queryLibrary")
      .mockImplementation((request) =>
        Promise.resolve({
          ok: true,
          value: {
            albums: request.view === "data-quality" ? [flaggedAlbum] : [album],
            artists: [],
            tracks: [],
            scanErrors: [],
            totalItems: 1,
            offset: request.offset,
            limit: 20,
          },
        }),
      );
    vi.spyOn(mockApi, "onJobProgress").mockImplementation((listener) => {
      listener({
        job: "library-quality",
        completed: 5,
        total: 10,
        detail: "Checked 5 of 10 albums.",
      });
      return () => undefined;
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByLabelText("library-quality progress"),
    ).toBeVisible();
    expect(screen.getByText("5/10: Checked 5 of 10 albums.")).toBeVisible();
    await user.selectOptions(screen.getByLabelText("View"), "data-quality");
    const issueType = screen.getByLabelText("Issue type");
    expect(issueType).toBeVisible();
    expect(issueType).toHaveValue("all");
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "data-quality",
        offset: 0,
        limit: 20,
        qualityFilter: "all",
      }),
    );
    expect(await screen.findByText("1 album needing review")).toBeVisible();
    expect(
      screen.getByText("Albums needing review on this page: 1 of 1."),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Missing track titles" }),
    ).toBeVisible();

    await user.selectOptions(issueType, "missing-tags");
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "data-quality",
        offset: 0,
        limit: 20,
        qualityFilter: "missing-tags",
      }),
    );
    expect(
      screen.getByText("1 album needing review with missing/placeholder tags"),
    ).toBeVisible();
  });

  it("ignores a superseded data-quality result after returning to Albums", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const freshAlbum: CatalogAlbum = {
      ...album,
      id: "700f2cf0-8c79-4db2-8788-39745eb51bee",
      title: "Fresh Albums View",
      tracks: [
        {
          ...firstTrack,
          id: "c9792048-cf37-4994-b936-feba233552f9",
          tags: { ...firstTrack.tags, album: "Fresh Albums View" },
        },
      ],
    };
    let resolveQuality:
      | ((result: Awaited<ReturnType<OutgrooveApi["queryLibrary"]>>) => void)
      | undefined;
    const qualityResult = new Promise<
      Awaited<ReturnType<OutgrooveApi["queryLibrary"]>>
    >((resolve) => {
      resolveQuality = resolve;
    });
    const mockApi = api(true);
    let albumQueries = 0;
    const queryLibrary = vi
      .spyOn(mockApi, "queryLibrary")
      .mockImplementation((request) => {
        if (request.view === "data-quality") return qualityResult;
        albumQueries++;
        return Promise.resolve({
          ok: true,
          value: {
            albums: albumQueries === 1 ? [album] : [freshAlbum],
            artists: [],
            tracks: [],
            scanErrors: [],
            totalItems: 1,
            offset: request.offset,
            limit: 20,
          },
        });
      });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });

    await user.selectOptions(screen.getByLabelText("View"), "data-quality");
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenCalledWith({
        query: "",
        view: "data-quality",
        offset: 0,
        limit: 20,
        qualityFilter: "all",
      }),
    );
    await user.selectOptions(screen.getByLabelText("View"), "albums");
    expect(
      await screen.findByRole("heading", { name: "Fresh Albums View" }),
    ).toBeVisible();
    act(() => {
      resolveQuality?.({
        ok: true,
        value: {
          albums: [],
          artists: [],
          tracks: [],
          scanErrors: [],
          totalItems: 0,
          offset: 0,
          limit: 20,
        },
      });
    });
    expect(
      screen.getByRole("heading", { name: "Fresh Albums View" }),
    ).toBeVisible();
    expect(screen.queryByText("No albums need review")).not.toBeInTheDocument();
  });

  it("requests the next bounded album page from main", async () => {
    const mockApi = api(true);
    const queryLibrary = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          albums: [album],
          artists: [],
          tracks: [],
          scanErrors: [],
          totalItems: 21,
          offset: 0,
          limit: 20,
        },
      }),
    );
    Object.assign(mockApi, { queryLibrary });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenCalledWith({
        query: "",
        view: "albums",
        offset: 20,
        limit: 20,
      }),
    );
  });

  it("updates quality summaries per page without claiming a library-wide count", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const flaggedAlbum: CatalogAlbum = {
      ...album,
      id: "8c196850-bca9-48b7-ae7f-dc760fbf8f2b",
      title: "Page Two Album",
      tracks: [
        {
          ...firstTrack,
          id: "dbb54a30-a8ce-45e1-9354-d6ae9a432afc",
          path: "/fixture/page-two.flac",
          tags: {
            ...firstTrack.tags,
            album: "Page Two Album",
            title: "Unknown title",
          },
        },
      ],
    };
    const mockApi = api(true);
    const queryLibrary = vi
      .spyOn(mockApi, "queryLibrary")
      .mockImplementation((request) =>
        Promise.resolve({
          ok: true,
          value: {
            albums: request.offset === 0 ? [album] : [flaggedAlbum],
            artists: [],
            tracks: [],
            scanErrors: [],
            totalItems: 21,
            offset: request.offset,
            limit: 20,
          },
        }),
      );
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByText("Albums needing review on this page: 0 of 1."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(
      await screen.findByText("Albums needing review on this page: 1 of 1."),
    ).toBeVisible();
    expect(
      screen.queryByText(/review on this page: 1 of 21/u),
    ).not.toBeInTheDocument();
    expect(queryLibrary).toHaveBeenLastCalledWith({
      query: "",
      view: "albums",
      offset: 20,
      limit: 20,
    });
  });

  it("shows a database restore preview before explicit confirmation", async () => {
    const mockApi = api(true);
    const chooseDatabaseRestore = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          operationId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
          confirmationToken: "database-confirmation-token-long-enough",
          sourceName: "outgroove-backup.sqlite3",
          schemaVersion: 12,
          summary: {
            libraryRoots: 2,
            albums: 30,
            tracks: 300,
            syncProfiles: 1,
          },
        },
      }),
    );
    const applyDatabaseRestore = vi.fn(() =>
      Promise.resolve({
        ok: true as const,
        value: {
          rollbackBackupPath: "/fixture/automatic-rollback.sqlite3",
          restarting: true as const,
        },
      }),
    );
    Object.assign(mockApi, { chooseDatabaseRestore, applyDatabaseRestore });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Restore from backup" }),
    );
    const preview = await screen.findByLabelText(
      "Database restore confirmation",
    );
    expect(preview).toHaveTextContent("outgroove-backup.sqlite3");
    expect(preview).toHaveTextContent("300");
    await user.click(
      screen.getByRole("button", { name: "Confirm restore and restart" }),
    );
    expect(applyDatabaseRestore).toHaveBeenCalledWith({
      operationId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
      confirmationToken: "database-confirmation-token-long-enough",
    });
  });

  it("shows backup export failure without claiming success", async () => {
    const mockApi = api(true);
    const createDatabaseBackup = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        error: { code: "INTERNAL_ERROR", message: "Backup disk is full" },
      }),
    );
    Object.assign(mockApi, { createDatabaseBackup });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "Create database backup" }),
    );
    expect(await screen.findByText("Backup disk is full")).toBeVisible();
    expect(
      screen.queryByText(/backup verified and saved/iu),
    ).not.toBeInTheDocument();
  });
});
