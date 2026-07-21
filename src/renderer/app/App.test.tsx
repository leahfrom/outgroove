// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
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
    listAlbums: vi.fn(() => Promise.resolve({ ok: true, value: [album] })),
    listScanErrors: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
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
    expect(cancelScan).toHaveBeenCalledWith({
      jobId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
    });
    expect(
      await screen.findByRole("button", { name: "Cancelling…" }),
    ).toBeDisabled();
  });
});
