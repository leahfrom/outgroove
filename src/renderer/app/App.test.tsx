// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OutgrooveApi,
  SavedLibraryFilterDto,
  ScanJobDto,
} from "../../shared/contracts/api";
import type { CatalogAlbum } from "../../shared/domain/catalog";
import { App } from "./App";

async function openPrimaryView(
  user: ReturnType<typeof userEvent.setup>,
  name: "Library" | "Sync" | "Activity" | "Settings",
): Promise<void> {
  const navigation = screen.getByRole("navigation", {
    name: "Primary navigation",
  });
  await user.click(
    within(navigation).getByRole("button", { name: new RegExp(`^${name}`) }),
  );
}

async function openLibraryAlbum(
  user: ReturnType<typeof userEvent.setup>,
  albumName = "Fixture Album",
): Promise<void> {
  const albums = await screen.findByRole("list", { name: "Albums" });
  const albumButton = within(albums).getByRole("button", {
    name: new RegExp(`^${albumName}`, "u"),
  });
  albumButton.focus();
  await user.keyboard("{Enter}");
  const heading = await screen.findByRole("heading", {
    level: 2,
    name: albumName,
  });
  expect(heading).toBeVisible();
  expect(heading).toHaveFocus();
}

async function chooseAlbumAction(
  user: ReturnType<typeof userEvent.setup>,
  name:
    | "Edit album metadata"
    | "Edit track order"
    | "History & undo"
    | `Add ${string} to Sync`,
): Promise<HTMLElement> {
  const trigger = screen.getByRole("button", { name: "Album actions" });
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name }));
  return trigger;
}

async function openLibraryTools(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  const summary = await screen.findByText("Library tools");
  const disclosure = summary.closest("details");
  if (!disclosure) throw new Error("Library tools disclosure missing");
  if (!disclosure.hasAttribute("open")) await user.click(summary);
  return disclosure;
}

async function openSyncSetupSection(
  user: ReturnType<typeof userEvent.setup>,
  name: "Selection draft" | "Saved profiles",
): Promise<void> {
  const navigation = screen.getByRole("navigation", {
    name: "Albums and profiles setup",
  });
  await user.click(
    within(navigation).getByRole("button", {
      name: new RegExp(`^${name}`),
    }),
  );
}

async function openSyncProfileManagement(
  user: ReturnType<typeof userEvent.setup>,
  profileName: string,
): Promise<void> {
  await user.click(screen.getByText(`Manage ${profileName}`));
}

async function openLibraryAlbumTool(
  user: ReturnType<typeof userEvent.setup>,
  name: "Album title" | "Shared fields" | "Track order",
): Promise<void> {
  await openPrimaryView(user, "Library");
  if (!screen.queryByRole("button", { name: "Album actions" }))
    await openLibraryAlbum(user);
  if (name === "Track order") {
    await chooseAlbumAction(user, "Edit track order");
    return;
  }
  await chooseAlbumAction(user, "Edit album metadata");
  if (name === "Shared fields")
    await user.click(screen.getByRole("button", { name: /^Shared fields/u }));
}

async function openAlbumHistory(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  const historyButton = screen.getByRole("button", {
    name: /^History & undo/u,
  });
  historyButton.focus();
  await user.keyboard("{Enter}");
  expect(historyButton).toHaveAttribute("aria-current", "page");
  return screen.findByLabelText("Metadata edit history");
}

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
      codec: "MPEG 1 Layer 3",
      bitrate: 128_000,
      sampleRate: 44_100,
      bitDepth: null,
      channels: 1,
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

const secondAlbum: CatalogAlbum = {
  ...album,
  id: "adb9be31-d450-45f9-99de-c9c6143988ad",
  title: "Second Album",
  albumArtist: "Other Artist",
  tracks: album.tracks.map((track) => ({
    ...track,
    id: "1f5053fe-7aab-4ca8-861b-4ed97bc69f91",
    path: "/fixture/second.mp3",
    tags: {
      ...track.tags,
      title: "Other Track",
      album: "Second Album",
      artist: "Other Artist",
      albumArtist: "Other Artist",
    },
  })),
};

function api(applyVerified: boolean): OutgrooveApi {
  const track = album.tracks[0];
  if (!track) throw new Error("Test track missing");
  return {
    chooseLibraryFolder: vi.fn(),
    listLibraryRoots: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    previewLibraryRootRemoval: vi.fn(),
    applyLibraryRootRemoval: vi.fn(),
    scanLibrary: vi.fn(),
    cancelScan: vi.fn(),
    getLatestScanJob: vi.fn(() => Promise.resolve({ ok: true, value: null })),
    createDatabaseBackup: vi.fn(),
    chooseDatabaseRestore: vi.fn(),
    applyDatabaseRestore: vi.fn(),
    listSavedLibraryFilters: vi.fn(() =>
      Promise.resolve({ ok: true, value: [] }),
    ),
    createSavedLibraryFilter: vi.fn(),
    updateSavedLibraryFilter: vi.fn(),
    deleteSavedLibraryFilter: vi.fn(),
    queryLibrary: vi.fn(() =>
      Promise.resolve({
        ok: true,
        value: {
          albums: [album],
          artists: [],
          formats: [],
          folders: [],
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
    listSyncProfiles: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    updateSyncProfileAlbums: vi.fn(),
    renameSyncProfile: vi.fn(),
    chooseSyncProfileTarget: vi.fn(),
    applySyncProfileTarget: vi.fn(),
    listSyncHistory: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    planSync: vi.fn(),
    applySync: vi.fn(),
    cancelSync: vi.fn(),
    listSyncRecoveries: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
    previewSyncRecovery: vi.fn(),
    applySyncRecovery: vi.fn(),
    onJobProgress: vi.fn(() => () => undefined),
    onScanJobUpdated: vi.fn(() => () => undefined),
  } as OutgrooveApi;
}

describe("tag edit UI safety states", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses keyboard-operable primary navigation with one current view", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(true),
    });
    const user = userEvent.setup();
    render(<App />);
    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(
      within(navigation).queryByRole("button", { name: /^Workbench/u }),
    ).not.toBeInTheDocument();
    expect(within(navigation).getAllByRole("button")).toHaveLength(4);
    expect(
      within(navigation).getByRole("button", { name: /^Library/u }),
    ).toHaveAttribute("aria-current", "page");

    const activity = within(navigation).getByRole("button", {
      name: /^Activity/u,
    });
    activity.focus();
    await user.keyboard("{Enter}");

    expect(activity).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("heading", { level: 1, name: "Activity" }),
    ).toBeVisible();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
  });

  it("preserves Library search and view state across navigation", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(true),
    });
    const user = userEvent.setup();
    render(<App />);
    const search = await screen.findByRole("searchbox", {
      name: "Search Library",
    });
    await user.type(search, "Fixture");
    await user.selectOptions(screen.getByLabelText("View"), "tracks");

    await openPrimaryView(user, "Settings");
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    await openPrimaryView(user, "Library");

    expect(
      screen.getByRole("searchbox", { name: "Search Library" }),
    ).toHaveValue("Fixture");
    expect(screen.getByLabelText("View")).toHaveValue("tracks");
  });

  it("keeps the established Library compact until tools are requested", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(true),
    });
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("list", { name: "Albums" })).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "Browse your Library" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("search")).toBeVisible();
    const summaryLabel = screen.getByText("Library tools");
    const summary = summaryLabel.closest("summary");
    const disclosure = summaryLabel.closest("details");
    if (!summary) throw new Error("Library tools summary missing");
    if (!disclosure) throw new Error("Library tools disclosure missing");
    const savedFilters = screen
      .getByText("Saved Library filters")
      .closest("section");
    if (!savedFilters) throw new Error("Saved filters section missing");
    expect(disclosure).not.toHaveAttribute("open");
    expect(savedFilters).not.toBeVisible();

    await user.click(summary);
    expect(disclosure).toHaveAttribute("open");
    expect(savedFilters).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Choose Library folder" }),
    ).toBeVisible();
  });

  it("shows labelled global feedback only after an event and dismisses it from the keyboard", async () => {
    const mockApi = api(true);
    vi.spyOn(mockApi, "chooseLibraryFolder").mockResolvedValue({
      ok: true,
      value: null,
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await openPrimaryView(user, "Settings");
    await user.click(
      screen.getByRole("button", { name: "Add Library folder" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "UpdateFolder selection cancelled.",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    const dismiss = screen.getByRole("button", {
      name: "Dismiss notification",
    });
    dismiss.focus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("separates first folder selection from the keyboard-started scan and preserves it across navigation", async () => {
    const mockApi = api(true);
    const root = {
      id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
      path: "/fixture/a very long first library folder/音乐",
      lastScanAt: null,
    };
    const chooseLibraryFolder = vi.fn().mockResolvedValue({
      ok: true,
      value: root,
    });
    const scanLibrary = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
        rootId: root.id,
        state: "queued",
        completed: 0,
        total: 0,
        detail: "Queued",
        result: null,
        error: null,
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z",
        finishedAt: null,
      } satisfies ScanJobDto,
    });
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [],
        artists: [],
        formats: [],
        folders: [],
        tracks: [],
        scanErrors: [],
        totalItems: 0,
        offset: 0,
        limit: 20,
      },
    });
    Object.assign(mockApi, { chooseLibraryFolder, scanLibrary });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Start with your music folder",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("search")).not.toBeInTheDocument();
    expect(
      screen.getByRole("list", { name: "Library guarantees" }),
    ).toHaveTextContent("Read-only scanning");
    expect(
      screen.getByText(/does not change, rename, or move audio/i),
    ).toBeVisible();

    const choose = screen.getByRole("button", {
      name: "Choose first Library folder",
    });
    choose.focus();
    await user.keyboard("{Enter}");

    expect(await screen.findByText(root.path)).toBeVisible();
    expect(scanLibrary).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "CompletedLibrary folder added.",
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(
      screen.getByRole("heading", { name: "Review your first scan" }),
    ).toBeVisible();

    await openPrimaryView(user, "Settings");
    await openPrimaryView(user, "Library");
    expect(screen.getByText(root.path)).toBeVisible();

    const start = screen.getByRole("button", { name: "Start first scan" });
    start.focus();
    await user.keyboard("{Enter}");

    expect(scanLibrary).toHaveBeenCalledWith({ rootId: root.id });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Activity" }),
    ).toBeVisible();
    const scanActivity = screen.getByLabelText("Library scan activity");
    expect(
      within(scanActivity).getByRole("heading", {
        level: 3,
        name: "Library scan",
      }),
    ).toBeVisible();
    expect(within(scanActivity).getByText("Preparing")).toBeVisible();
  });

  it("keeps first-run folder-picker and scan failures recoverable", async () => {
    const mockApi = api(true);
    const root = {
      id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
      path: "C:\\Fixture Music\\Unavailable",
      lastScanAt: null,
    };
    const chooseLibraryFolder = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: null })
      .mockResolvedValue({ ok: true, value: root });
    const scanLibrary = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "OPERATION_FAILED",
        message: "The selected folder is no longer available.",
        recoverable: true,
      },
    });
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [],
        artists: [],
        formats: [],
        folders: [],
        tracks: [],
        scanErrors: [],
        totalItems: 0,
        offset: 0,
        limit: 20,
      },
    });
    Object.assign(mockApi, { chooseLibraryFolder, scanLibrary });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(
      await screen.findByRole("button", {
        name: "Choose first Library folder",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Folder selection cancelled.",
    );
    expect(scanLibrary).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Choose first Library folder" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Start first scan" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The selected folder is no longer available.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Needs attentionThe selected folder is no longer available.",
    );
    expect(screen.getByRole("status")).toHaveAttribute(
      "aria-live",
      "assertive",
    );
    expect(
      screen.getByRole("button", { name: "Start first scan" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("heading", { level: 1, name: "Library" }),
    ).toBeVisible();
  });

  it("routes a completed first scan from Activity back to the populated Library", async () => {
    const mockApi = api(true);
    const rootId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    vi.spyOn(mockApi, "listLibraryRoots").mockResolvedValue({
      ok: true,
      value: [{ id: rootId, path: "/fixture", lastScanAt: null }],
    });
    vi.spyOn(mockApi, "getLatestScanJob").mockResolvedValue({
      ok: true,
      value: {
        id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
        rootId,
        state: "completed",
        completed: 1,
        total: 1,
        detail: "Scan complete",
        result: { parsed: 1, unchanged: 0, errors: 0 },
        error: null,
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:01:00.000Z",
        finishedAt: "2026-07-23T00:01:00.000Z",
      } satisfies ScanJobDto,
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);

    await openPrimaryView(user, "Activity");
    const browse = await screen.findByRole("button", {
      name: "Browse Library",
    });
    browse.focus();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("heading", { name: "Fixture Album" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: /^Library/u })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps active operation progress visible and contextualizes it in Activity", async () => {
    const mockApi = api(true);
    let emitProgress: Parameters<OutgrooveApi["onJobProgress"]>[0] | undefined;
    const onJobProgress = vi.fn(
      (listener: Parameters<OutgrooveApi["onJobProgress"]>[0]) => {
        emitProgress = listener;
        return () => undefined;
      },
    );
    Object.assign(mockApi, { onJobProgress });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(onJobProgress).toHaveBeenCalled());

    act(() => {
      emitProgress?.({
        job: "sync",
        completed: 1,
        total: 3,
        detail: "Verifying Fixture Album",
      });
    });
    expect(screen.getByLabelText("sync progress")).toHaveTextContent(
      "1/3: Verifying Fixture Album",
    );

    await openPrimaryView(user, "Activity");
    expect(screen.queryByLabelText("sync progress")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "DAP sync" })).toBeVisible();
    expect(screen.getByText("Verifying Fixture Album")).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "DAP sync progress" }),
    ).toHaveAttribute("value", "1");

    await openPrimaryView(user, "Settings");
    expect(screen.getByLabelText("sync progress")).toHaveTextContent(
      "1/3: Verifying Fixture Album",
    );
  });

  it("preserves an unconfirmed contextual album preview across navigation", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(true),
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });
    await openLibraryAlbumTool(user, "Album title");
    await user.type(screen.getByLabelText("Proposed title"), "Renamed Album");
    await user.click(
      screen.getByRole("button", { name: "Review per-file changes" }),
    );
    expect(await screen.findByLabelText("Tag edit confirmation")).toBeVisible();

    await openAlbumHistory(user);
    expect(
      screen.queryByLabelText("Tag edit confirmation"),
    ).not.toBeInTheDocument();
    const editButton = screen.getByRole("button", { name: /^Album title/u });
    editButton.focus();
    await user.keyboard("{Enter}");
    expect(editButton).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Tag edit confirmation")).toBeVisible();

    await openPrimaryView(user, "Settings");
    expect(
      screen.queryByLabelText("Tag edit confirmation"),
    ).not.toBeInTheDocument();
    await openPrimaryView(user, "Library");

    expect(screen.getByLabelText("Tag edit confirmation")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Confirm and write 1 file" }),
    ).toBeEnabled();
  });

  it("keeps album-title drafts and previews in the contextual Library editor", async () => {
    const mockApi = api(true);
    const applyEdit = vi.spyOn(mockApi, "applyAlbumTitleEdit");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openLibraryAlbum(user);

    const albumActions = await chooseAlbumAction(user, "Edit album metadata");
    const dialog = screen.getByRole("dialog", {
      name: "Edit Fixture Album",
    });
    expect(dialog).toHaveFocus();
    expect(
      within(dialog).getByRole("button", { name: /^Album title/u }),
    ).toHaveAttribute("aria-current", "page");

    await user.type(
      within(dialog).getByLabelText("Proposed title"),
      "Renamed Album",
    );
    expect(applyEdit).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", {
        name: "Review per-file changes",
      }),
    );
    expect(
      await within(dialog).findByLabelText("Tag edit confirmation"),
    ).toBeVisible();
    expect(applyEdit).not.toHaveBeenCalled();

    await user.click(
      within(dialog).getByRole("button", { name: /^Shared fields/u }),
    );
    expect(
      within(dialog).queryByLabelText("Tag edit confirmation"),
    ).not.toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: /^Album title/u }),
    );
    expect(
      within(dialog).getByLabelText("Tag edit confirmation"),
    ).toBeVisible();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(albumActions).toHaveFocus();
    await chooseAlbumAction(user, "Edit album metadata");
    expect(
      within(
        screen.getByRole("dialog", { name: "Edit Fixture Album" }),
      ).getByLabelText("Tag edit confirmation"),
    ).toBeVisible();
    expect(applyEdit).not.toHaveBeenCalled();
  });

  it("previews shared album metadata contextually without applying it", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const secondTrack: CatalogAlbum["tracks"][number] = {
      ...firstTrack,
      id: "c878d5df-f462-45ec-a4b1-84623fd525b3",
      path: "/fixture/second.flac",
      tags: { ...firstTrack.tags, title: "Second Track", trackNumber: 2 },
    };
    const editableAlbum = { ...album, tracks: [firstTrack, secondTrack] };
    const mockApi = api(true);
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [editableAlbum],
        artists: [],
        formats: [],
        folders: [],
        tracks: [],
        scanErrors: [],
        totalItems: 1,
        offset: 0,
        limit: 20,
      },
    });
    const previewBatch = vi.spyOn(mockApi, "previewTrackBatchEdit");
    previewBatch.mockResolvedValue({
      ok: true,
      value: {
        operationId: "216c5a1d-84c7-42d5-9191-6f0ea83b50bb",
        confirmationToken: "batch-confirmation-token-long-enough",
        files: editableAlbum.tracks.map((track) => ({
          fileId: track.id,
          path: track.path,
          changes: [
            {
              field: "albumArtist",
              before: track.tags.albumArtist,
              after: "Reviewed Artist",
            },
          ],
          warnings: [],
          willWrite: true,
        })),
      },
    });
    const applyBatch = vi.spyOn(mockApi, "applyTrackBatchEdit");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openLibraryAlbum(user);
    await chooseAlbumAction(user, "Edit album metadata");
    const dialog = screen.getByRole("dialog", {
      name: "Edit Fixture Album",
    });
    await user.click(
      within(dialog).getByRole("button", { name: /^Shared fields/u }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Select all tracks" }),
    );
    expect(within(dialog).getByLabelText("Selected tracks")).toHaveTextContent(
      "2 of 2 tracks selected",
    );
    await user.click(
      within(dialog).getByRole("checkbox", {
        name: "Change album artist",
      }),
    );
    await user.type(
      within(dialog).getByLabelText("Batch album artist value"),
      "Reviewed Artist",
    );
    expect(applyBatch).not.toHaveBeenCalled();
    const review = within(dialog).getByRole("button", {
      name: "Preview selected tracks",
    });
    expect(review).toBeEnabled();
    await user.click(review);
    await waitFor(() =>
      expect(previewBatch).toHaveBeenCalledWith({
        fileIds: editableAlbum.tracks.map((track) => track.id),
        changes: { albumArtist: "Reviewed Artist" },
      }),
    );
    expect(
      await within(dialog).findByLabelText("Batch confirmation"),
    ).toBeVisible();
    expect(applyBatch).not.toHaveBeenCalled();
  });

  it("opens track order and edit history as separate album actions", async () => {
    const mockApi = api(true);
    const listHistory = vi.spyOn(mockApi, "listAlbumEditHistory");
    const previewSequence = vi.spyOn(mockApi, "previewTrackNumberSequence");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openLibraryAlbum(user);

    const albumActions = await chooseAlbumAction(user, "Edit track order");
    let dialog = screen.getByRole("dialog", { name: "Edit Fixture Album" });
    expect(
      within(dialog).getByRole("button", { name: /^Track order/u }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(dialog).getByLabelText("Track number sequencing"),
    ).toBeVisible();
    expect(previewSequence).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(albumActions).toHaveFocus();

    await chooseAlbumAction(user, "History & undo");
    dialog = screen.getByRole("dialog", { name: "Edit Fixture Album" });
    expect(
      within(dialog).getByRole("button", { name: /^History & undo/u }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(dialog).getByLabelText("Metadata edit history"),
    ).toBeVisible();
    await waitFor(() =>
      expect(listHistory).toHaveBeenCalledWith({ albumId: album.id }),
    );
    await user.keyboard("{Escape}");
    expect(albumActions).toHaveFocus();
  });

  it("opens read-only technical details separately from track editing", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(true),
    });
    const user = userEvent.setup();
    render(<App />);
    await openLibraryAlbum(user);
    const more = screen.getByRole("button", {
      name: "More actions for Track",
    });
    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name: "More info" }));
    const dialog = screen.getByRole("dialog", {
      name: "More information about Track",
    });
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByText("128 kbps")).toBeVisible();
    expect(within(dialog).getByText("44.1 kHz")).toBeVisible();
    expect(within(dialog).getByText("Mono (1 channel)")).toBeVisible();
    expect(
      within(dialog).getByText("File size").nextElementSibling,
    ).toHaveTextContent("100 B");
    expect(
      within(dialog).getByText("Bit depth").nextElementSibling,
    ).toHaveTextContent("Unknown");
    expect(
      within(dialog).queryByRole("button", { name: /edit|review|confirm/u }),
    ).not.toBeInTheDocument();

    const nativeLabel = within(dialog).getByText("Native tags");
    const native = nativeLabel.closest("details");
    if (!native) throw new Error("Native metadata disclosure missing");
    expect(native).not.toHaveAttribute("open");
    await user.click(nativeLabel);
    expect(native).toHaveAttribute("open");
    expect(
      within(native).getByRole("region", { name: "Native track tags" }),
    ).toHaveTextContent("ID3v2:TALB");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

  it("opens an album with the keyboard and restores its Library focus", async () => {
    const mockApi = api(true);
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [album, secondAlbum],
        artists: [],
        formats: [],
        folders: [],
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
    const albums = await screen.findByRole("list", { name: "Albums" });
    const second = within(albums).getByRole("button", {
      name: /^Second Album/u,
    });

    expect(
      screen.queryByRole("button", { name: "Edit track metadata" }),
    ).not.toBeInTheDocument();

    second.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", { level: 2, name: "Second Album" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("list", { name: "Albums" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Edit track metadata" }),
    ).not.toBeInTheDocument();

    await openPrimaryView(user, "Settings");
    await openPrimaryView(user, "Library");
    expect(
      screen.getByRole("heading", { level: 2, name: "Second Album" }),
    ).toBeVisible();

    const back = screen.getByRole("button", { name: "Back to albums" });
    back.focus();
    await user.keyboard("{Enter}");
    const restoredAlbums = await screen.findByRole("list", { name: "Albums" });
    expect(
      within(restoredAlbums).getByRole("button", {
        name: /^Second Album/u,
      }),
    ).toHaveFocus();
  });

  it("shows per-file before/after preview before exposing explicit confirmation", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(true),
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });
    await openLibraryAlbumTool(user, "Album title");
    await user.type(screen.getByLabelText("Proposed title"), "Renamed Album");
    await user.click(
      screen.getByRole("button", { name: "Review per-file changes" }),
    );
    const confirmation = await screen.findByLabelText("Tag edit confirmation");
    expect(confirmation).toHaveTextContent("Fixture Album");
    expect(confirmation).toHaveTextContent("Renamed Album");
    expect(
      screen.getByRole("button", { name: "Confirm and write 1 file" }),
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
    await openLibraryAlbum(user);
    await user.click(
      screen.getByRole("button", { name: "Edit metadata for Track" }),
    );
    await user.clear(screen.getByLabelText("Track title"));
    await user.type(screen.getByLabelText("Track title"), "Renamed Track");
    await user.clear(screen.getByLabelText("Track artist"));
    await user.type(screen.getByLabelText("Track artist"), "Different Artist");
    expect(
      screen.queryByRole("button", { name: "Confirm and write track" }),
    ).not.toBeInTheDocument();
    const reviewButton = screen.getByRole("button", {
      name: "Review 2 changes",
    });
    reviewButton.focus();
    await user.keyboard("{Enter}");
    const preview = await screen.findByLabelText("Track metadata confirmation");
    expect(within(preview).getByText("Renamed Track")).toBeInTheDocument();
    expect(within(preview).getByText("Different Artist")).toBeInTheDocument();
    const confirmButton = within(preview).getByRole("button", {
      name: "Confirm and write track",
    });
    expect(confirmButton).toHaveFocus();
    await user.keyboard("{Enter}");
    const outcome = await screen.findByLabelText("Track metadata result");
    expect(outcome).toHaveTextContent(
      "Track metadata write re-read and verified",
    );
    expect(outcome).toHaveFocus();
    expect(screen.getByLabelText("Track metadata editor")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Track metadata confirmation"),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getAllByRole("status")
        .some((status) =>
          status.textContent.includes(
            "Track metadata write was re-read and verified.",
          ),
        ),
    ).toBe(true);
    await waitFor(() => expect(applySpy).toHaveBeenCalledTimes(1));
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(previewSpy.mock.calls[0]?.[0]).toMatchObject({
      fileId: album.tracks[0]?.id,
      changes: {
        title: "Renamed Track",
        artist: "Different Artist",
      },
    });
  });

  it("keeps a failed Library track edit preview visible with its stale-write error", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(false),
    });
    const user = userEvent.setup();
    render(<App />);
    await openLibraryAlbum(user);
    await user.click(
      screen.getByRole("button", { name: "Edit metadata for Track" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Edit metadata for Track" }),
    ).toHaveFocus();
    await user.clear(screen.getByLabelText("Track title"));
    await user.type(screen.getByLabelText("Track title"), "Renamed Track");
    await user.click(screen.getByRole("button", { name: "Review 1 change" }));
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
    expect(screen.getByLabelText("Track metadata result")).toHaveTextContent(
      "0 verified; 1 need attention",
    );
    expect(screen.getByLabelText("Track metadata result")).toHaveTextContent(
      "stale preview",
    );
  });

  it("keeps a Library track draft and preview across navigation and closing", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(true),
    });
    const user = userEvent.setup();
    render(<App />);
    await openLibraryAlbum(user);
    const activation = screen.getByRole("button", {
      name: "Edit metadata for Track",
    });
    await user.click(activation);
    await user.clear(screen.getByLabelText("Track title"));
    await user.type(screen.getByLabelText("Track title"), "Draft title");
    await user.click(screen.getByRole("button", { name: "Review 1 change" }));
    expect(
      await screen.findByLabelText("Track metadata confirmation"),
    ).toBeVisible();

    await openPrimaryView(user, "Activity");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await openPrimaryView(user, "Library");
    expect(
      screen.getByRole("dialog", { name: "Edit metadata for Track" }),
    ).toHaveFocus();
    expect(screen.getByLabelText("Track title")).toHaveValue("Draft title");
    expect(screen.getByLabelText("Track metadata confirmation")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close editor" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const restoredActivation = screen.getByRole("button", {
      name: "Edit metadata for Track",
    });
    expect(restoredActivation).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.type(screen.getByLabelText("Track title"), " revised");
    expect(
      screen.queryByLabelText("Track metadata confirmation"),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(restoredActivation).toHaveFocus();
  });

  it("preserves a track draft across navigation and invalidates a stale preview when the draft changes", async () => {
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: api(true),
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });
    await openLibraryAlbum(user);
    await user.click(
      screen.getByRole("button", { name: "Edit metadata for Track" }),
    );
    await user.clear(screen.getByLabelText("Track title"));
    await user.type(screen.getByLabelText("Track title"), "Draft title");

    await openPrimaryView(user, "Activity");
    await openPrimaryView(user, "Library");
    expect(screen.getByLabelText("Track title")).toHaveValue("Draft title");

    await user.click(screen.getByRole("button", { name: "Review 1 change" }));
    expect(
      await screen.findByLabelText("Track metadata confirmation"),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Track title"), " revised");
    expect(screen.getByLabelText("Track title")).toHaveValue(
      "Draft title revised",
    );
    expect(
      screen.queryByLabelText("Track metadata confirmation"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Confirm and write track" }),
    ).not.toBeInTheDocument();
  });

  it("preserves contextual album track selection and routes an inspected track without previewing", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const secondTrack: CatalogAlbum["tracks"][number] = {
      ...firstTrack,
      id: "c878d5df-f462-45ec-a4b1-84623fd525b3",
      path: "/fixture/second.flac",
      format: "FLAC",
      tags: { ...firstTrack.tags, title: "Second Track", trackNumber: 2 },
    };
    const contextAlbum = { ...album, tracks: [firstTrack, secondTrack] };
    const mockApi = api(true);
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [contextAlbum],
        artists: [],
        formats: [],
        folders: [],
        tracks: [],
        scanErrors: [],
        totalItems: 1,
        offset: 0,
        limit: 20,
      },
    });
    const previewTrack = vi.spyOn(mockApi, "previewTrackTagEdit");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Fixture Album" });
    await openLibraryAlbumTool(user, "Shared fields");

    const chooserSummary = screen.getByText("Choose or inspect tracks");
    const chooser = chooserSummary.closest("details");
    if (!chooser) throw new Error("Track chooser missing");
    expect(chooser).toHaveAttribute("open");
    await user.click(
      screen.getByRole("checkbox", {
        name: "Select Track for shared-field editing",
      }),
    );
    expect(screen.getByLabelText("Selected tracks")).toHaveTextContent(
      "1 of 2 tracks selected",
    );
    await user.click(chooserSummary);
    expect(chooser).not.toHaveAttribute("open");

    await openPrimaryView(user, "Activity");
    await openPrimaryView(user, "Library");
    expect(screen.getByLabelText("Selected tracks")).toHaveTextContent(
      "1 of 2 tracks selected",
    );
    const restoredChooserSummary = screen.getByText("Choose or inspect tracks");
    const restoredChooser = restoredChooserSummary.closest("details");
    if (!restoredChooser) throw new Error("Restored track chooser missing");
    expect(restoredChooser).not.toHaveAttribute("open");
    expect(
      screen.getByRole("list", { name: "Selected track names" }),
    ).toHaveTextContent("Track");

    await user.click(restoredChooserSummary);
    const editSecond = within(
      screen.getByRole("dialog", { name: "Edit Fixture Album" }),
    ).getByRole("button", {
      name: "Edit metadata for Second Track",
    });
    editSecond.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Track metadata editor")).toBeVisible();
    expect(screen.getByLabelText("Track title")).toHaveValue("Second Track");
    expect(previewTrack).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("Track metadata confirmation"),
    ).not.toBeInTheDocument();
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
        formats: [],
        folders: [],
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
    await openLibraryAlbumTool(user, "Shared fields");
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
      within(confirmation).getByText("Step 2 · Confirmation"),
    ).toBeVisible();
    expect(
      within(confirmation).getByRole("button", {
        name: "Confirm and write selected tracks",
      }),
    ).toHaveFocus();
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
    await user.type(
      screen.getByLabelText("Batch track artist value"),
      " revised",
    );
    expect(
      screen.queryByLabelText("Batch confirmation"),
    ).not.toBeInTheDocument();
    await user.click(previewButton);
    expect(preview).toHaveBeenLastCalledWith({
      fileIds: batchAlbum.tracks.map((track) => track.id),
      changes: { artist: "Batch Artist revised" },
    });
    expect(
      screen.queryByLabelText("Track number sequencing"),
    ).not.toBeInTheDocument();
    const trackOrder = screen.getByRole("button", {
      name: /^Track order/u,
    });
    trackOrder.focus();
    await user.keyboard("{Enter}");
    expect(trackOrder).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Track number sequencing")).toBeVisible();
    expect(screen.getByLabelText("Selected tracks")).toHaveTextContent(
      "2 of 2 tracks selected",
    );
    expect(
      screen.queryByLabelText("Batch metadata editor"),
    ).not.toBeInTheDocument();
    const sharedFields = screen.getByRole("button", {
      name: /^Shared fields/u,
    });
    sharedFields.focus();
    await user.keyboard("{Enter}");
    expect(sharedFields).toHaveAttribute("aria-current", "page");
    const restoredConfirmation = screen.getByLabelText("Batch confirmation");
    expect(restoredConfirmation).toBeVisible();
    await user.click(
      within(restoredConfirmation).getByRole("button", {
        name: "Confirm and write selected tracks",
      }),
    );
    expect(await screen.findByText(/stale preview/u)).toBeInTheDocument();
    expect(
      screen.getByText(/1 writes verified; 1 failed/u),
    ).toBeInTheDocument();
    const batchResult = screen.getByRole("alert", {
      name: "Batch metadata result",
    });
    expect(batchResult).toHaveFocus();
    expect(batchResult).toHaveTextContent("1 verified; 1 need attention");
    expect(batchResult).toHaveTextContent(
      "A failed item is never reported as verified",
    );
    await user.click(
      screen.getByRole("button", {
        name: /^Album title/u,
      }),
    );
    await openAlbumHistory(user);
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
        formats: [],
        folders: [],
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
    await openLibraryAlbumTool(user, "Track order");
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
    const secondTrackComparison = screen.getByLabelText(
      "Sequence comparison for Second Track",
    );
    expect(secondTrackComparison).toHaveTextContent("Track 2 · Disc 1");
    expect(secondTrackComparison).toHaveTextContent("Track 7 · Disc 3");
    expect(within(secondTrackComparison).getByText("Changed")).toBeVisible();
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
    const confirmSequence = within(confirmation).getByRole("button", {
      name: "Confirm track-number sequence",
    });
    expect(confirmSequence).toHaveFocus();
    expect(within(confirmation).getByText(/2 → 7/u)).toBeInTheDocument();
    expect(within(confirmation).getByText(/1 → 8/u)).toBeInTheDocument();
    expect(within(confirmation).getAllByText(/1 → 3/u)).toHaveLength(2);
    await user.click(confirmSequence);
    expect(
      await screen.findByText("Re-read and verified 2 track-number writes."),
    ).toBeInTheDocument();
    const sequenceResult = screen.getByRole("status", {
      name: "Track number sequence result",
    });
    expect(sequenceResult).toHaveFocus();
    expect(sequenceResult).toHaveTextContent(
      "Track-number sequence re-read and verified",
    );
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
        formats: [],
        folders: [],
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

    await openLibraryAlbum(user);
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
        name: "Select Duplicate A for track ordering",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", {
        name: "Select Duplicate B for track ordering",
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Select Track for track ordering" }),
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
        formats: [],
        folders: [],
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

    await openLibraryAlbum(user);
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
      screen.getAllByRole("checkbox", { name: /for shared-field editing/u }),
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
        formats: [],
        folders: [],
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

    const albumList = await screen.findByRole("list", { name: "Albums" });
    expect(
      screen.getByText("1 of 2 albums on this page need review."),
    ).toBeVisible();
    expect(
      within(albumList).getByText("1 finding · Needs attention"),
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
    await openLibraryAlbumTool(user, "Album title");
    await user.type(screen.getByLabelText("Proposed title"), "Renamed Album");
    await user.click(
      screen.getByRole("button", { name: "Review per-file changes" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Confirm and write 1 file" }),
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
    await screen.findByRole("heading", { name: "Fixture Album" });
    await openLibraryAlbumTool(user, "Album title");
    const history = await openAlbumHistory(user);
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
        name: "Confirm and undo 1 file",
      }),
    ).toBeEnabled();
    expect(previewAlbumTitleUndo).toHaveBeenCalledWith({
      operationId: "75d39ca7-fc00-41b7-a132-2024b912573f",
    });
    await user.click(
      within(preview).getByRole("button", {
        name: "Confirm and undo 1 file",
      }),
    );
    expect(applyAlbumTitleUndo).toHaveBeenCalledWith({
      operationId: "fba25f9c-51ad-41c7-a838-4dcdf20a587a",
      confirmationToken: "undo-confirmation-token-long-enough",
    });
    expect(
      await screen.findByLabelText("Album title undo result"),
    ).toHaveTextContent("Album-title undo re-read and verified");
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
    await screen.findByRole("heading", { name: "Fixture Album" });
    await openLibraryAlbumTool(user, "Album title");
    const history = await openAlbumHistory(user);
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
    expect(
      await screen.findByLabelText("Track metadata undo result"),
    ).toHaveTextContent("Track metadata undo re-read and verified");
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
    await screen.findByRole("heading", { name: "Fixture Album" });
    await openLibraryAlbumTool(user, "Album title");
    const history = await openAlbumHistory(user);
    await user.click(
      await within(history).findByRole("button", {
        name: "Preview track undo",
      }),
    );
    const preview = await screen.findByLabelText(
      "Track metadata undo confirmation",
    );
    expect(
      within(preview).getByText(/undo will not overwrite it/u),
    ).toBeVisible();
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
    await screen.findByRole("heading", { name: "Fixture Album" });
    await openLibraryAlbumTool(user, "Album title");
    await openAlbumHistory(user);
    await user.click(
      await screen.findByRole("button", { name: "Preview undo" }),
    );
    const preview = await screen.findByLabelText("Tag undo confirmation");
    expect(preview).toHaveTextContent("will not overwrite it");
    expect(
      within(preview).getByRole("button", {
        name: "Confirm and undo 1 file",
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
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Activity");
    expect(
      await screen.findByRole("heading", { level: 2, name: "Interrupted" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry scan" })).toBeEnabled();
  });

  it("routes completed scan problems from Activity into the exact Library view", async () => {
    const mockApi = api(true);
    const getLatestScanJob = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
        rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
        state: "completed",
        completed: 3,
        total: 3,
        detail: "Scan complete",
        result: { parsed: 2, unchanged: 0, errors: 1 },
        error: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:01:00.000Z",
        finishedAt: "2026-01-01T00:01:00.000Z",
      } satisfies ScanJobDto,
    });
    Object.assign(mockApi, { getLatestScanJob });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Activity");

    const review = await screen.findByRole("button", {
      name: "Review 1 scan problem",
    });
    expect(screen.getByText("Parsed").nextSibling).toHaveTextContent("2");
    expect(screen.getByText("Problems").nextSibling).toHaveTextContent("1");
    review.focus();
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("heading", { name: "Scan problems" }),
    ).toBeVisible();
    expect(screen.getByLabelText("View")).toHaveValue("scan-errors");
  });

  it("shows watched folders and routes a named keyboard action into the existing scan", async () => {
    const mockApi = api(true);
    const firstRootId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const secondRootId = "98748ad4-e155-4320-b949-1433dd377762";
    const listLibraryRoots = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        {
          id: firstRootId,
          path: "/fixture/never-scanned",
          lastScanAt: null,
        },
        {
          id: secondRootId,
          path: "/fixture/scanned",
          lastScanAt: "2026-07-20T12:00:00.000Z",
        },
      ],
    });
    const scanLibrary = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
        rootId: secondRootId,
        state: "queued",
        completed: 0,
        total: 0,
        detail: "Queued",
        result: null,
        error: null,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        finishedAt: null,
      } satisfies ScanJobDto,
    });
    Object.assign(mockApi, { listLibraryRoots, scanLibrary });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Settings");

    const roots = await screen.findByRole("region", {
      name: "Watched Library folders",
    });
    expect(within(roots).getByText("/fixture/never-scanned")).toBeVisible();
    expect(within(roots).getByText("Never scanned")).toBeVisible();
    expect(within(roots).getByText("/fixture/scanned")).toBeVisible();
    expect(within(roots).getByText("Scanned")).toBeVisible();
    expect(within(roots).getByText(/Last completed/)).toBeVisible();

    const secondScan = within(roots).getByRole("button", {
      name: "Scan folder /fixture/scanned",
    });
    secondScan.focus();
    await user.keyboard("{Enter}");
    expect(scanLibrary).toHaveBeenCalledWith({ rootId: secondRootId });
    expect(await within(roots).findByText("Current scan target")).toBeVisible();
    expect(
      within(roots).getByRole("button", {
        name: "Scan folder /fixture/never-scanned",
      }),
    ).toBeDisabled();
    expect(
      within(roots).getByRole("button", {
        name: "Stop watching /fixture/never-scanned",
      }),
    ).toBeDisabled();
  });

  it("refreshes the watched-folder status after a completed scan", async () => {
    const mockApi = api(true);
    const rootId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const scannedAt = "2026-07-22T12:34:00.000Z";
    const listLibraryRoots = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        value: [{ id: rootId, path: "/fixture", lastScanAt: null }],
      })
      .mockResolvedValue({
        ok: true,
        value: [{ id: rootId, path: "/fixture", lastScanAt: scannedAt }],
      });
    let emitScanJob: ((job: ScanJobDto) => void) | undefined;
    const onScanJobUpdated = vi.fn((listener: (job: ScanJobDto) => void) => {
      emitScanJob = listener;
      return () => undefined;
    });
    Object.assign(mockApi, { listLibraryRoots, onScanJobUpdated });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Settings");
    expect(await screen.findByText("Never scanned")).toBeVisible();

    act(() => {
      emitScanJob?.({
        id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
        rootId,
        state: "completed",
        completed: 1,
        total: 1,
        detail: "Scan complete",
        result: { parsed: 1, unchanged: 0, errors: 0 },
        error: null,
        createdAt: "2026-07-22T12:33:00.000Z",
        updatedAt: scannedAt,
        finishedAt: scannedAt,
      });
    });

    expect(await screen.findByText("Scanned")).toBeVisible();
    expect(screen.getByText(/Last completed/)).toHaveTextContent(
      new Date(scannedAt).toLocaleString(),
    );
    expect(listLibraryRoots).toHaveBeenCalledTimes(2);
  });

  it("previews and keyboard-confirms stopping a watched folder without claiming file deletion", async () => {
    const mockApi = api(true);
    const rootId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const root = { id: rootId, path: "/fixture", lastScanAt: null };
    const listLibraryRoots = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: [root] })
      .mockResolvedValue({ ok: true, value: [] });
    const previewLibraryRootRemoval = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        operationId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
        confirmationToken: "root-removal-confirmation-token",
        rootId,
        path: "/fixture",
        visibleTracks: 12,
        albumsHidden: 2,
        scanProblemsHidden: 1,
      },
    });
    const applyLibraryRootRemoval = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        rootId,
        visibleTracksHidden: 12,
        albumsHidden: 2,
        scanProblemsHidden: 1,
        audioFilesDeleted: 0,
      },
    });
    Object.assign(mockApi, {
      listLibraryRoots,
      previewLibraryRootRemoval,
      applyLibraryRootRemoval,
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Settings");

    const stop = await screen.findByRole("button", {
      name: "Stop watching /fixture",
    });
    stop.focus();
    await user.keyboard("{Enter}");
    const preview = await screen.findByLabelText(
      "Library folder removal preview",
    );
    expect(
      within(preview).getByRole("heading", {
        name: "Stop watching this folder?",
      }),
    ).toHaveFocus();
    expect(preview).toHaveTextContent("/fixture");
    expect(within(preview).getByText("Visible tracks hidden")).toBeVisible();
    expect(within(preview).getByText("12")).toBeVisible();
    expect(within(preview).getByText("Albums no longer visible")).toBeVisible();
    expect(within(preview).getByText("2")).toBeVisible();
    expect(within(preview).getByText("Scan problems hidden")).toBeVisible();
    expect(within(preview).getByText("1")).toBeVisible();
    expect(preview).toHaveTextContent("No audio or DAP files will be deleted");
    expect(applyLibraryRootRemoval).not.toHaveBeenCalled();

    const confirm = within(preview).getByRole("button", {
      name: "Confirm stop watching",
    });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(applyLibraryRootRemoval).toHaveBeenCalledWith({
      operationId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
      confirmationToken: "root-removal-confirmation-token",
    });
    expect(
      await screen.findByRole("heading", { name: "No Library folders yet" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "12 visible tracks hidden; no audio files deleted",
    );
  });

  it("keeps a root-removal preview open after a recoverable apply failure", async () => {
    const mockApi = api(true);
    const rootId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    vi.spyOn(mockApi, "listLibraryRoots").mockResolvedValue({
      ok: true,
      value: [{ id: rootId, path: "/fixture", lastScanAt: null }],
    });
    vi.spyOn(mockApi, "previewLibraryRootRemoval").mockResolvedValue({
      ok: true,
      value: {
        operationId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
        confirmationToken: "root-removal-confirmation-token",
        rootId,
        path: "/fixture",
        visibleTracks: 1,
        albumsHidden: 1,
        scanProblemsHidden: 0,
      },
    });
    vi.spyOn(mockApi, "applyLibraryRootRemoval").mockResolvedValue({
      ok: false,
      error: {
        code: "OPERATION_FAILED",
        message: "The Library folder changed after preview.",
        recoverable: true,
      },
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Settings");
    await user.click(
      await screen.findByRole("button", { name: "Stop watching /fixture" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Confirm stop watching" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "The Library folder changed after preview.",
    );
    expect(
      screen.getByLabelText("Library folder removal preview"),
    ).toBeVisible();
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
    await openPrimaryView(user, "Activity");
    const cancel = await screen.findByRole("button", { name: "Cancel scan" });
    cancel.focus();
    await user.keyboard("{Enter}");
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
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Activity");
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
                formats: [],
                folders: [],
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
                formats: [],
                folders: [],
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
      await screen.findByRole("searchbox", { name: "Search Library" }),
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
            formats: [],
            folders: [],
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

  it("browses formats and opens an exact removable track filter", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const mockApi = api(true);
    const queryLibrary = vi
      .spyOn(mockApi, "queryLibrary")
      .mockImplementation((request) =>
        Promise.resolve({
          ok: true,
          value: {
            albums: request.view === "albums" ? [album] : [],
            artists: [],
            formats:
              request.view === "formats"
                ? [{ name: "FLAC", trackCount: 7 }]
                : [],
            folders: [],
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
                      codec: firstTrack.codec ?? null,
                      bitrate: firstTrack.bitrate ?? null,
                      sampleRate: firstTrack.sampleRate ?? null,
                      bitDepth: firstTrack.bitDepth ?? null,
                      channels: firstTrack.channels ?? null,
                      size: firstTrack.size,
                      path: firstTrack.path,
                    },
                  ]
                : [],
            scanErrors: [],
            totalItems: request.view === "formats" ? 21 : 1,
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

    await user.selectOptions(screen.getByLabelText("View"), "formats");
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "formats",
        offset: 0,
        limit: 20,
      }),
    );
    expect(await screen.findByText("Status: 7 tracks")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "formats",
        offset: 20,
        limit: 20,
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Browse FLAC tracks" }),
    );
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "tracks",
        offset: 0,
        limit: 20,
        format: "FLAC",
      }),
    );
    expect(screen.getByText("1 track in “FLAC” format")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Show all formats" }));
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "tracks",
        offset: 0,
        limit: 20,
      }),
    );
  });

  it("saves, keyboard-opens, and deletes local Library filters", async () => {
    const mockApi = api(true);
    const missingId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const createdId = "86fb71a8-9faf-49f9-ad60-39e5bb28c02d";
    let saved: SavedLibraryFilterDto[] = [
      {
        id: missingId,
        name: "Missing genres",
        definition: {
          query: "",
          view: "tracks",
          genre: { name: "No genre tag", missing: true },
        },
        createdAt: "2026-07-22T00:00:00.000Z",
      },
    ];
    vi.spyOn(mockApi, "listSavedLibraryFilters").mockImplementation(() =>
      Promise.resolve({ ok: true, value: saved }),
    );
    const create = vi
      .spyOn(mockApi, "createSavedLibraryFilter")
      .mockImplementation((request) => {
        const created = {
          id: createdId,
          name: request.name,
          definition: request.definition,
          createdAt: "2026-07-22T00:01:00.000Z",
        };
        saved = [...saved, created];
        return Promise.resolve({ ok: true, value: created });
      });
    const update = vi
      .spyOn(mockApi, "updateSavedLibraryFilter")
      .mockImplementation((request) => {
        const current = saved.find((filter) => filter.id === request.id);
        if (!current) throw new Error("Saved filter fixture missing");
        const updated = {
          ...current,
          name: request.name,
          definition: request.definition,
        };
        saved = saved.map((filter) =>
          filter.id === request.id ? updated : filter,
        );
        return Promise.resolve({ ok: true, value: updated });
      });
    const remove = vi
      .spyOn(mockApi, "deleteSavedLibraryFilter")
      .mockImplementation(({ id }) => {
        saved = saved.filter((filter) => filter.id !== id);
        return Promise.resolve({ ok: true, value: { id } });
      });
    const queryLibrary = vi.spyOn(mockApi, "queryLibrary");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);

    await openLibraryTools(user);
    const open = await screen.findByRole("button", {
      name: "Open Missing genres",
    });
    open.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "tracks",
        offset: 0,
        limit: 20,
        missingGenre: true,
      }),
    );
    expect(
      screen.getByText("Opened saved Library filter “Missing genres”."),
    ).toBeVisible();

    const rename = screen.getByLabelText("Name for Missing genres");
    await user.clear(rename);
    await user.type(rename, "Needs genres{Enter}");
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        id: missingId,
        name: "Needs genres",
        definition: {
          query: "",
          view: "tracks",
          genre: { name: "No genre tag", missing: true },
        },
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Open Needs genres" }),
    ).toBeVisible();

    await user.selectOptions(screen.getByLabelText("View"), "formats");
    await user.type(screen.getByLabelText("Search Library"), "FLAC");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByLabelText("Filter name"), "Codec view");
    await user.click(
      screen.getByRole("button", { name: "Save current filter" }),
    );
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        name: "Codec view",
        definition: { query: "FLAC", view: "formats" },
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Open Codec view" }),
    ).toBeVisible();

    await user.clear(screen.getByLabelText("Search Library"));
    await user.type(screen.getByLabelText("Search Library"), "lossless");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(
      screen.getByRole("button", {
        name: "Update Needs genres to current filter",
      }),
    );
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith({
        id: missingId,
        name: "Needs genres",
        definition: { query: "lossless", view: "formats" },
      }),
    );
    expect(
      screen.getByText("Updated saved Library filter “Needs genres”."),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Delete Codec view" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ id: createdId }));
    expect(
      screen.queryByRole("button", { name: "Open Codec view" }),
    ).not.toBeInTheDocument();
  });

  it("keeps a saved-filter name editable after a recoverable create failure", async () => {
    const mockApi = api(true);
    vi.spyOn(mockApi, "createSavedLibraryFilter").mockResolvedValue({
      ok: false,
      error: {
        code: "OPERATION_FAILED",
        message: "A saved Library filter named “Existing” already exists.",
        recoverable: true,
      },
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openLibraryTools(user);
    const name = await screen.findByLabelText("Filter name");
    await user.type(name, "Existing");
    await user.click(
      screen.getByRole("button", { name: "Save current filter" }),
    );
    expect(
      await screen.findByText(
        "A saved Library filter named “Existing” already exists.",
      ),
    ).toBeVisible();
    expect(name).toHaveValue("Existing");
    expect(
      screen.getByRole("button", { name: "Save current filter" }),
    ).toBeEnabled();
  });

  it("keeps a saved-filter rename editable after a recoverable update failure", async () => {
    const mockApi = api(true);
    const saved: SavedLibraryFilterDto = {
      id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
      name: "Existing",
      definition: { query: "", view: "albums" },
      createdAt: "2026-07-22T00:00:00.000Z",
    };
    vi.spyOn(mockApi, "listSavedLibraryFilters").mockResolvedValue({
      ok: true,
      value: [saved],
    });
    vi.spyOn(mockApi, "updateSavedLibraryFilter").mockResolvedValue({
      ok: false,
      error: {
        code: "OPERATION_FAILED",
        message: "A saved Library filter named “Taken” already exists.",
        recoverable: true,
      },
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openLibraryTools(user);
    const name = await screen.findByLabelText("Name for Existing");
    await user.clear(name);
    await user.type(name, "Taken{Enter}");
    expect(
      await screen.findByText(
        "A saved Library filter named “Taken” already exists.",
      ),
    ).toBeVisible();
    expect(name).toHaveValue("Taken");
    expect(
      screen.getByRole("button", { name: "Rename Existing" }),
    ).toBeEnabled();
  });

  it("browses genre findings and routes keyboard actions to exact track filters", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const mockApi = api(true);
    const queryLibrary = vi
      .spyOn(mockApi, "queryLibrary")
      .mockImplementation((request) =>
        Promise.resolve({
          ok: true,
          value: {
            albums: request.view === "albums" ? [album] : [],
            artists: [],
            genres:
              request.view === "genres"
                ? [
                    { name: "Ambient", trackCount: 2, missing: false },
                    { name: "No genre tag", trackCount: 1, missing: true },
                  ]
                : [],
            formats: [],
            folders: [],
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
                      codec: firstTrack.codec ?? null,
                      bitrate: firstTrack.bitrate ?? null,
                      sampleRate: firstTrack.sampleRate ?? null,
                      bitDepth: firstTrack.bitDepth ?? null,
                      channels: firstTrack.channels ?? null,
                      size: firstTrack.size,
                      path: firstTrack.path,
                    },
                  ]
                : [],
            scanErrors: [],
            totalItems: request.view === "genres" ? 2 : 1,
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

    await user.selectOptions(screen.getByLabelText("View"), "genres");
    expect(await screen.findByText("Status: 2 tracks")).toBeVisible();
    expect(screen.getByText("Status: 1 track")).toBeVisible();
    const ambientAction = screen.getByRole("button", {
      name: "Browse Ambient tracks",
    });
    ambientAction.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "tracks",
        offset: 0,
        limit: 20,
        genre: "Ambient",
      }),
    );
    expect(screen.getByText(firstTrack.path)).toBeVisible();
    expect(screen.getByText("1 track with genre “Ambient”")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Show all genres" }));
    await user.selectOptions(screen.getByLabelText("View"), "genres");
    await user.click(
      await screen.findByRole("button", {
        name: "Browse tracks with no genre tag",
      }),
    );
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "tracks",
        offset: 0,
        limit: 20,
        missingGenre: true,
      }),
    );
  });

  it("browses folders and opens an exact removable track filter", async () => {
    const firstTrack = album.tracks[0];
    if (!firstTrack) throw new Error("Test track missing");
    const folderPath = "/fixture";
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
            formats: [],
            folders:
              request.view === "folders"
                ? [
                    {
                      id: folderPath,
                      path: folderPath,
                      albumCount: 2,
                      trackCount: 7,
                    },
                  ]
                : [],
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
                      codec: firstTrack.codec ?? null,
                      bitrate: firstTrack.bitrate ?? null,
                      sampleRate: firstTrack.sampleRate ?? null,
                      bitDepth: firstTrack.bitDepth ?? null,
                      channels: firstTrack.channels ?? null,
                      size: firstTrack.size,
                      path: firstTrack.path,
                    },
                  ]
                : [],
            scanErrors: [],
            totalItems: request.view === "folders" ? 21 : 1,
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

    await user.selectOptions(screen.getByLabelText("View"), "folders");
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "folders",
        offset: 0,
        limit: 20,
      }),
    );
    expect(await screen.findByText(folderPath)).toBeVisible();
    expect(screen.getByText("Status: 2 albums · 7 tracks")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "folders",
        offset: 20,
        limit: 20,
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: `Browse tracks in ${folderPath}`,
      }),
    );
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "tracks",
        offset: 0,
        limit: 20,
        folderId: folderPath,
      }),
    );
    expect(screen.getByText(`1 track in folder “${folderPath}”`)).toBeVisible();
    expect(screen.getByText(firstTrack.path)).toBeVisible();
    expect(previewTrackTagEdit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Show all folders" }));
    await waitFor(() =>
      expect(queryLibrary).toHaveBeenLastCalledWith({
        query: "",
        view: "tracks",
        offset: 0,
        limit: 20,
      }),
    );
  });

  it("browses tracks with file context and opens the Library preview-only editor", async () => {
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
            formats: [],
            folders: [],
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
                      codec: firstTrack.codec ?? null,
                      bitrate: firstTrack.bitrate ?? null,
                      sampleRate: firstTrack.sampleRate ?? null,
                      bitDepth: firstTrack.bitDepth ?? null,
                      channels: firstTrack.channels ?? null,
                      size: firstTrack.size,
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
        name: `Edit ${firstTrack.tags.title}`,
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
    expect(
      await screen.findByRole("dialog", {
        name: `Edit metadata for ${firstTrack.tags.title}`,
      }),
    ).toHaveFocus();
    expect(screen.getByLabelText("Track metadata editor")).toBeVisible();
    expect(screen.getByLabelText("Track title")).toHaveValue(
      firstTrack.tags.title,
    );
    expect(previewTrackTagEdit).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Close editor", hidden: false }),
    );
    await user.click(screen.getByRole("button", { name: "Back to albums" }));
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
            formats: [],
            folders: [],
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
      screen.getByText("1 of 1 albums on this page need review."),
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
    await openLibraryAlbum(user, "Flagged Album");
    expect(
      screen.getByRole("heading", { name: "Missing track titles" }),
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
            formats: [],
            folders: [],
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
          formats: [],
          folders: [],
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
          formats: [],
          folders: [],
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
            formats: [],
            folders: [],
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
      await screen.findByText("No data-quality findings on this page."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(
      await screen.findByText("1 of 1 albums on this page need review."),
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

  it("selects multiple albums with the keyboard and requires a sync preview before copying", async () => {
    const mockApi = api(true);
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [album, secondAlbum],
        artists: [],
        formats: [],
        folders: [],
        tracks: [],
        scanErrors: [],
        totalItems: 2,
        offset: 0,
        limit: 20,
      },
    });
    const profileId = "86fb71a8-9faf-49f9-ad60-39e5bb28c02d";
    const chooseSyncTargetAndCreateProfile = vi
      .spyOn(mockApi, "chooseSyncTargetAndCreateProfile")
      .mockResolvedValue({
        ok: true,
        value: {
          id: profileId,
          name: "Outgroove 2-album DAP",
          targetPath: "/fixture/dap",
          albumIds: [album.id, secondAlbum.id],
        },
      });
    const listSyncHistory = vi
      .spyOn(mockApi, "listSyncHistory")
      .mockResolvedValue({ ok: true, value: [] });
    const plan = {
      id: "853a8e28-560a-4261-b152-1fe31c26dc42",
      profileId,
      targetPath: "/fixture/dap",
      confirmationToken: "sync-confirmation-token-long-enough",
      copies: [album, secondAlbum].map((item) => ({
        sourceFileId: item.tracks[0]?.id ?? item.id,
        sourcePath: item.tracks[0]?.path ?? `/fixture/${item.id}.mp3`,
        relativeDestination: `${item.albumArtist}/${item.title}/01-01 Track.mp3`,
        size: 100,
        signature: "100:1",
      })),
      unchanged: [],
      conflicts: [],
      errors: [],
      requiredBytes: 200,
    };
    vi.spyOn(mockApi, "planSync").mockResolvedValue({ ok: true, value: plan });
    const applySync = vi.spyOn(mockApi, "applySync").mockResolvedValue({
      ok: true,
      value: {
        outcome: "completed",
        copied: 2,
        rolledBack: 0,
        unchanged: 0,
        playlistPath: "/fixture/dap/Outgroove.m3u8",
        manifestPath: "/fixture/dap/.outgroove/manifest.json",
        errors: [],
      },
    });
    const cancelSync = vi.spyOn(mockApi, "cancelSync").mockResolvedValue({
      ok: true,
      value: { planId: plan.id, accepted: true, state: "cancelling" },
    });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openLibraryAlbum(user);
    await chooseAlbumAction(user, "Add Fixture Album to Sync");
    await openPrimaryView(user, "Library");
    await user.click(screen.getByRole("button", { name: "Back to albums" }));
    await openLibraryAlbum(user, "Second Album");
    await chooseAlbumAction(user, "Add Second Album to Sync");
    const selection = screen.getByRole("list", {
      name: "Albums selected for DAP sync",
    });
    expect(selection).toHaveTextContent("Fixture Album");
    expect(selection).toHaveTextContent("Fixture Artist");
    expect(selection).toHaveTextContent("Second Album");
    expect(selection).toHaveTextContent("Other Artist");
    expect(
      screen.getByRole("button", { name: "Preview & apply" }),
    ).toBeDisabled();
    await openPrimaryView(user, "Activity");
    await openPrimaryView(user, "Sync");
    expect(
      screen.getByRole("button", {
        name: "Selection draft, 2 of 100 albums",
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("list", { name: "Albums selected for DAP sync" }),
    ).toHaveTextContent("Second Album");

    const chooseTarget = screen.getByRole("button", {
      name: "Choose DAP target",
    });
    chooseTarget.focus();
    await user.keyboard("{Enter}");
    expect(chooseSyncTargetAndCreateProfile).toHaveBeenCalledWith({
      name: "Outgroove 2-album DAP",
      albumIds: [album.id, secondAlbum.id],
    });
    expect(
      screen.getByRole("button", { name: "Preview & apply" }),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByText("Successful sync history")).toBeVisible();
    await user.click(screen.getByText("Successful sync history"));
    expect(
      screen.getByText("No successful sync runs have been recorded yet."),
    ).toBeVisible();
    expect(applySync).not.toHaveBeenCalled();

    const previewButton = await screen.findByRole("button", {
      name: "Preview sync plan",
    });
    previewButton.focus();
    await user.keyboard("{Enter}");
    const preview = await screen.findByLabelText("Sync confirmation");
    expect(preview).toHaveTextContent("Fixture Album");
    expect(preview).toHaveTextContent("Second Album");
    expect(
      within(preview).getByRole("heading", { name: "Current sync plan" }),
    ).toHaveFocus();
    expect(applySync).not.toHaveBeenCalled();
    const confirm = within(preview).getByRole("button", {
      name: "Confirm and apply copy plan",
    });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(applySync).toHaveBeenCalledWith({
      planId: plan.id,
      confirmationToken: plan.confirmationToken,
    });
    await waitFor(() => expect(listSyncHistory).toHaveBeenCalledTimes(2));
    expect(listSyncHistory).toHaveBeenNthCalledWith(1, { profileId });
    expect(listSyncHistory).toHaveBeenNthCalledWith(2, { profileId });

    let resolveCancelledApply: (
      result: Awaited<ReturnType<OutgrooveApi["applySync"]>>,
    ) => void = () => undefined;
    applySync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCancelledApply = resolve;
        }),
    );
    const retryConfirm = within(
      screen.getByLabelText("Sync confirmation"),
    ).getByRole("button", { name: "Confirm and apply copy plan" });
    await waitFor(() => expect(retryConfirm).toBeEnabled());
    retryConfirm.focus();
    await user.keyboard("{Enter}");
    const cancel = await screen.findByRole("button", {
      name: "Cancel active sync",
    });
    cancel.focus();
    await user.keyboard("{Enter}");
    expect(cancelSync).toHaveBeenCalledWith({ planId: plan.id });
    expect(cancel).toBeDisabled();
    expect(screen.getByText("Status: Cancelling safely")).toBeVisible();
    resolveCancelledApply({
      ok: true,
      value: {
        outcome: "cancelled",
        copied: 1,
        rolledBack: 1,
        unchanged: 0,
        playlistPath: "/fixture/dap/Outgroove.m3u8",
        manifestPath: "/fixture/dap/.outgroove/manifest.json",
        errors: [],
      },
    });
    expect(
      await screen.findByText(/Sync cancelled safely after 1 completed copy/u),
    ).toHaveTextContent("No new manifest was committed");
    expect(listSyncHistory).toHaveBeenCalledTimes(2);
    expect(retryConfirm).toBeEnabled();
  });

  it("shows restart-safe sync recovery actions and confirms them with the keyboard", async () => {
    const mockApi = api(true);
    const runId = "a0be4702-0050-4fca-b6df-cbba6529b5f9";
    const profileId = "86fb71a8-9faf-49f9-ad60-39e5bb28c02d";
    const confirmationToken = "sync-recovery-confirmation-token-long-enough";
    const listSyncRecoveries = vi
      .spyOn(mockApi, "listSyncRecoveries")
      .mockResolvedValueOnce({
        ok: true,
        value: [
          {
            runId,
            profileId,
            profileName: "Road DAP",
            targetPath: "/fixture/dap",
            interruptedAt: "2026-07-22T10:00:00.000Z",
            phase: "copying",
            mode: "rollback",
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        value: [
          {
            runId,
            profileId,
            profileName: "Road DAP",
            targetPath: "/fixture/dap",
            interruptedAt: "2026-07-22T10:00:00.000Z",
            phase: "copying",
            mode: "rollback",
          },
        ],
      })
      .mockResolvedValue({ ok: true, value: [] });
    const previewSyncRecovery = vi
      .spyOn(mockApi, "previewSyncRecovery")
      .mockResolvedValue({
        ok: true,
        value: {
          runId,
          profileId,
          profileName: "Road DAP",
          targetPath: "/fixture/dap",
          interruptedAt: "2026-07-22T10:00:00.000Z",
          phase: "copying",
          mode: "rollback",
          actions: [
            {
              path: "/fixture/dap/Artist/Album/01 Track.flac",
              action: "remove",
              explanation: "Remove the uncommitted Outgroove copy.",
            },
          ],
          warnings: [],
          canRecover: true,
          confirmationToken,
        },
      });
    const applySyncRecovery = vi
      .spyOn(mockApi, "applySyncRecovery")
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "SYNC_RECOVERY_STALE",
          message: "The recovery preview changed. Review it again.",
          recoverable: true,
        },
      })
      .mockResolvedValue({
        ok: true,
        value: { runId, recovered: 1, errors: [], complete: true },
      });
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Sync");

    const recoveryAlert = screen.getByRole("alert");
    expect(recoveryAlert).toHaveTextContent(
      "Database restore remains blocked until pending recovery is completed.",
    );
    const openRecovery = within(recoveryAlert).getByRole("button", {
      name: "Review recovery",
    });
    openRecovery.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("button", { name: "Recovery, 1 pending" }),
    ).toHaveAttribute("aria-current", "step");
    const recoveries = await screen.findByRole("list", {
      name: "Interrupted sync recoveries",
    });
    const review = within(recoveries).getByRole("button", {
      name: "Review recovery for Road DAP",
    });
    review.focus();
    await user.keyboard("{Enter}");
    expect(previewSyncRecovery).toHaveBeenCalledWith({ runId });
    const recoveryPreview = screen.getByLabelText(
      "Recovery confirmation for Road DAP",
    );
    expect(
      within(recoveryPreview).getByRole("heading", {
        name: "Recovery plan for Road DAP",
      }),
    ).toHaveFocus();
    expect(recoveryPreview).toHaveTextContent(
      "/fixture/dap/Artist/Album/01 Track.flac",
    );
    const confirm = within(recoveryPreview).getByRole("button", {
      name: "Confirm recovery for Road DAP",
    });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(applySyncRecovery).toHaveBeenCalledWith({
      runId,
      confirmationToken,
    });
    const failure = await screen.findByLabelText(
      "Recovery result for Road DAP",
    );
    expect(failure).toHaveTextContent(
      "The recovery preview changed. Review it again.",
    );
    expect(
      within(failure).getByRole("heading", {
        name: "Recovery could not be applied",
      }),
    ).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Review recovery for Road DAP" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Review recovery for Road DAP" }),
    );
    const retryPreview = screen.getByLabelText(
      "Recovery confirmation for Road DAP",
    );
    const retryConfirm = within(retryPreview).getByRole("button", {
      name: "Confirm recovery for Road DAP",
    });
    retryConfirm.focus();
    await user.keyboard("{Enter}");
    expect(applySyncRecovery).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByRole("heading", { name: "Recovery complete" }),
    ).toHaveFocus();
    expect(
      screen.getByLabelText("Recovery result for Road DAP"),
    ).toHaveTextContent("1 reviewed change was restored or removed");
    await waitFor(() => expect(listSyncRecoveries).toHaveBeenCalledTimes(3));
  });

  it("reopens a saved DAP profile with the keyboard into the preview-only workflow", async () => {
    const mockApi = api(true);
    const profileId = "86fb71a8-9faf-49f9-ad60-39e5bb28c02d";
    vi.spyOn(mockApi, "listSyncProfiles").mockResolvedValue({
      ok: true,
      value: [
        {
          id: profileId,
          name: "Road DAP",
          targetPath: "/fixture/dap",
          albumIds: [album.id, secondAlbum.id],
          albums: [
            {
              id: album.id,
              title: album.title,
              albumArtist: album.albumArtist,
            },
            {
              id: secondAlbum.id,
              title: secondAlbum.title,
              albumArtist: secondAlbum.albumArtist,
            },
          ],
          createdAt: "2026-07-22T10:00:00.000Z",
        },
      ],
    });
    const listSyncHistory = vi
      .spyOn(mockApi, "listSyncHistory")
      .mockResolvedValue({
        ok: true,
        value: [
          {
            id: "b1a3e2cd-2d58-4b53-a414-07d34b7da3a7",
            profileId,
            targetPath: "/fixture/dap",
            completedAt: "2026-07-22T10:00:00.000Z",
            entryCount: 2,
          },
          {
            id: "986176c9-9e80-460c-a2a0-ab7dcc3e7834",
            profileId,
            targetPath: "/fixture/older-dap",
            completedAt: "2026-07-21T09:00:00.000Z",
            entryCount: 1,
          },
        ],
      });
    const planSync = vi.spyOn(mockApi, "planSync").mockResolvedValue({
      ok: true,
      value: {
        id: "853a8e28-560a-4261-b152-1fe31c26dc42",
        profileId,
        targetPath: "/fixture/dap",
        confirmationToken: "sync-confirmation-token-long-enough",
        copies: [
          {
            sourceFileId: album.tracks[0]?.id ?? album.id,
            sourcePath: album.tracks[0]?.path ?? "/fixture/track.mp3",
            relativeDestination: "Fixture Artist/Fixture Album/01-01 Track.mp3",
            size: 100,
            signature: "100:1",
          },
        ],
        unchanged: [],
        conflicts: [],
        errors: [],
        requiredBytes: 100,
      },
    });
    const chooseTarget = vi.spyOn(mockApi, "chooseSyncTargetAndCreateProfile");
    const applySync = vi.spyOn(mockApi, "applySync");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Sync");
    await openSyncSetupSection(user, "Saved profiles");

    const profiles = await screen.findByRole("list", {
      name: "Saved DAP profiles",
    });
    expect(profiles).toHaveTextContent("/fixture/dap");
    expect(profiles).toHaveTextContent("Fixture Album");
    expect(profiles).toHaveTextContent("Fixture Artist");
    expect(profiles).toHaveTextContent("Second Album");
    expect(profiles).toHaveTextContent("Other Artist");
    const open = within(profiles).getByRole("button", {
      name: "Open DAP profile Road DAP",
    });
    open.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("button", { name: "Preview & apply" }),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByLabelText("Active DAP profile")).toHaveTextContent(
      "Road DAP",
    );
    expect(listSyncHistory).toHaveBeenCalledWith({ profileId });
    const historySummary = screen
      .getByText("Successful sync history")
      .closest("summary");
    if (!historySummary) throw new Error("Sync history disclosure missing");
    historySummary.focus();
    expect(historySummary).toHaveFocus();
    await user.click(historySummary);
    const history = await screen.findByRole("list", {
      name: "Successful sync history for Road DAP",
    });
    expect(history).toHaveTextContent("2 files");
    expect(history).toHaveTextContent("1 file");
    expect(history).toHaveTextContent("/fixture/dap");
    expect(history).toHaveTextContent("/fixture/older-dap");
    expect(
      within(history).getByText(
        (_content, element) =>
          element?.matches('time[datetime="2026-07-22T10:00:00.000Z"]') ??
          false,
      ),
    ).toBeVisible();
    expect(chooseTarget).not.toHaveBeenCalled();
    expect(planSync).not.toHaveBeenCalled();
    expect(applySync).not.toHaveBeenCalled();

    const preview = screen.getByRole("button", {
      name: "Preview sync plan",
    });
    preview.focus();
    await user.keyboard("{Enter}");
    expect(planSync).toHaveBeenCalledWith({ profileId });
    expect(await screen.findByLabelText("Sync confirmation")).toHaveTextContent(
      "Fixture Album",
    );
    expect(applySync).not.toHaveBeenCalled();

    await openPrimaryView(user, "Activity");
    await openPrimaryView(user, "Sync");
    expect(
      screen.getByRole("button", { name: "Preview & apply" }),
    ).toHaveAttribute("aria-current", "step");
    expect(screen.getByLabelText("Sync confirmation")).toHaveTextContent(
      "Fixture Album",
    );
  });

  it("renames a saved DAP profile with the keyboard without changing its current preview", async () => {
    const mockApi = api(true);
    const profileId = "86fb71a8-9faf-49f9-ad60-39e5bb28c02d";
    const initialProfile = {
      id: profileId,
      name: "Road DAP",
      targetPath: "/fixture/dap",
      albumIds: [album.id],
      albums: [
        {
          id: album.id,
          title: album.title,
          albumArtist: album.albumArtist,
        },
      ],
      createdAt: "2026-07-22T10:00:00.000Z",
    };
    const renamedProfile = { ...initialProfile, name: "Pocket DAP" };
    vi.spyOn(mockApi, "listSyncProfiles")
      .mockResolvedValueOnce({ ok: true, value: [initialProfile] })
      .mockResolvedValue({ ok: true, value: [renamedProfile] });
    const renameSyncProfile = vi
      .spyOn(mockApi, "renameSyncProfile")
      .mockResolvedValue({ ok: true, value: renamedProfile });
    const planSync = vi.spyOn(mockApi, "planSync").mockResolvedValue({
      ok: true,
      value: {
        id: "853a8e28-560a-4261-b152-1fe31c26dc42",
        profileId,
        targetPath: "/fixture/dap",
        confirmationToken: "sync-confirmation-token-long-enough",
        copies: [],
        unchanged: [],
        conflicts: [],
        errors: [],
        requiredBytes: 0,
      },
    });
    const chooseTarget = vi.spyOn(mockApi, "chooseSyncTargetAndCreateProfile");
    const updateAlbums = vi.spyOn(mockApi, "updateSyncProfileAlbums");
    const applySync = vi.spyOn(mockApi, "applySync");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Sync");
    await openSyncSetupSection(user, "Saved profiles");

    await user.click(
      await screen.findByRole("button", {
        name: "Open DAP profile Road DAP",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Preview sync plan" }));
    await screen.findByLabelText("Sync confirmation");
    await user.click(screen.getByRole("button", { name: "Manage Road DAP" }));
    await openSyncProfileManagement(user, "Road DAP");
    const rename = screen.getByRole("button", {
      name: "Rename DAP profile Road DAP",
    });
    rename.focus();
    await user.keyboard("{Enter}");
    const input = screen.getByRole("textbox", {
      name: "New name for Road DAP",
    });
    expect(input).toHaveFocus();
    await user.clear(input);
    await user.type(input, "Pocket DAP{Enter}");

    await waitFor(() =>
      expect(renameSyncProfile).toHaveBeenCalledWith({
        id: profileId,
        name: "Pocket DAP",
      }),
    );
    expect(chooseTarget).not.toHaveBeenCalled();
    expect(updateAlbums).not.toHaveBeenCalled();
    expect(applySync).not.toHaveBeenCalled();
    const profiles = screen.getByRole("list", { name: "Saved DAP profiles" });
    expect(profiles).toHaveTextContent("Pocket DAP");
    expect(profiles).toHaveTextContent("/fixture/dap");
    await user.click(screen.getByRole("button", { name: "Preview & apply" }));
    expect(screen.getByLabelText("Sync confirmation")).toBeVisible();
    expect(screen.getByLabelText("Active DAP profile")).toHaveTextContent(
      "Pocket DAP",
    );
    expect(planSync).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Albums & profiles" }));
    await openSyncProfileManagement(user, "Pocket DAP");
    await user.click(
      screen.getByRole("button", {
        name: "Rename DAP profile Pocket DAP",
      }),
    );
    await user.clear(
      screen.getByRole("textbox", { name: "New name for Pocket DAP" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "New name for Pocket DAP" }),
      "Discarded name",
    );
    const cancel = screen.getByRole("button", {
      name: "Cancel DAP profile rename",
    });
    cancel.focus();
    await user.keyboard("{Enter}");
    expect(renameSyncProfile).toHaveBeenCalledTimes(1);
    expect(profiles).toHaveTextContent("Pocket DAP");
    expect(profiles).not.toHaveTextContent("Discarded name");
  });

  it("previews and keyboard-confirms changing a saved DAP target without touching files", async () => {
    const mockApi = api(true);
    const profileId = "86fb71a8-9faf-49f9-ad60-39e5bb28c02d";
    const initialProfile = {
      id: profileId,
      name: "Road DAP",
      targetPath: "/fixture/old-dap",
      albumIds: [album.id],
      albums: [
        {
          id: album.id,
          title: album.title,
          albumArtist: album.albumArtist,
        },
      ],
      createdAt: "2026-07-22T10:00:00.000Z",
    };
    const retargetedProfile = {
      ...initialProfile,
      targetPath: "/fixture/new-dap",
    };
    vi.spyOn(mockApi, "listSyncProfiles")
      .mockResolvedValueOnce({ ok: true, value: [initialProfile] })
      .mockResolvedValue({ ok: true, value: [retargetedProfile] });
    const chooseTarget = vi
      .spyOn(mockApi, "chooseSyncProfileTarget")
      .mockResolvedValue({
        ok: true,
        value: {
          operationId: "853a8e28-560a-4261-b152-1fe31c26dc42",
          confirmationToken: "sync-target-confirmation-token-long-enough",
          profileId,
          profileName: "Road DAP",
          currentTargetPath: "/fixture/old-dap",
          proposedTargetPath: "/fixture/new-dap",
        },
      });
    const applyTarget = vi
      .spyOn(mockApi, "applySyncProfileTarget")
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "SYNC_TARGET_UNAVAILABLE",
          message: "The selected DAP target is unavailable.",
          recoverable: true,
        },
      })
      .mockResolvedValue({ ok: true, value: retargetedProfile });
    const planSync = vi.spyOn(mockApi, "planSync");
    const applySync = vi.spyOn(mockApi, "applySync");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Sync");
    await openSyncSetupSection(user, "Saved profiles");
    await openSyncProfileManagement(user, "Road DAP");

    const change = await screen.findByRole("button", {
      name: "Change DAP target for Road DAP",
    });
    change.focus();
    await user.keyboard("{Enter}");
    expect(chooseTarget).toHaveBeenCalledWith({ profileId });
    const preview = await screen.findByLabelText("DAP target confirmation");
    expect(
      within(preview).getByRole("heading", {
        name: "Review target for Road DAP",
      }),
    ).toHaveFocus();
    expect(within(preview).getByText("/fixture/old-dap")).toBeVisible();
    expect(within(preview).getByText("/fixture/new-dap")).toBeVisible();
    expect(preview).toHaveTextContent(
      "No source audio or target files are read, copied, replaced, or deleted.",
    );
    expect(applyTarget).not.toHaveBeenCalled();

    const confirm = within(preview).getByRole("button", {
      name: "Confirm DAP target change",
    });
    confirm.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(applyTarget).toHaveBeenCalledWith({
        operationId: "853a8e28-560a-4261-b152-1fe31c26dc42",
        confirmationToken: "sync-target-confirmation-token-long-enough",
      }),
    );
    expect(
      await screen.findByText("The selected DAP target is unavailable."),
    ).toBeVisible();
    expect(preview).toBeVisible();

    confirm.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(applyTarget).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText("DAP target confirmation")).toBeNull();
    expect(screen.getByLabelText("Active DAP profile")).toHaveTextContent(
      "/fixture/new-dap",
    );
    expect(planSync).not.toHaveBeenCalled();
    expect(applySync).not.toHaveBeenCalled();
  });

  it("revises a saved profile selection without reselecting its target and requires a fresh preview", async () => {
    const mockApi = api(true);
    vi.spyOn(mockApi, "queryLibrary").mockResolvedValue({
      ok: true,
      value: {
        albums: [album, secondAlbum],
        artists: [],
        formats: [],
        folders: [],
        tracks: [],
        scanErrors: [],
        totalItems: 2,
        offset: 0,
        limit: 20,
      },
    });
    const profileId = "86fb71a8-9faf-49f9-ad60-39e5bb28c02d";
    const initialProfile = {
      id: profileId,
      name: "Road DAP",
      targetPath: "/fixture/dap",
      albumIds: [album.id],
      albums: [
        {
          id: album.id,
          title: album.title,
          albumArtist: album.albumArtist,
        },
      ],
      createdAt: "2026-07-22T10:00:00.000Z",
    };
    const updatedProfile = {
      ...initialProfile,
      albumIds: [album.id, secondAlbum.id],
      albums: [
        ...initialProfile.albums,
        {
          id: secondAlbum.id,
          title: secondAlbum.title,
          albumArtist: secondAlbum.albumArtist,
        },
      ],
    };
    vi.spyOn(mockApi, "listSyncProfiles")
      .mockResolvedValueOnce({ ok: true, value: [initialProfile] })
      .mockResolvedValue({ ok: true, value: [updatedProfile] });
    const updateSyncProfileAlbums = vi
      .spyOn(mockApi, "updateSyncProfileAlbums")
      .mockResolvedValue({ ok: true, value: updatedProfile });
    vi.spyOn(mockApi, "planSync").mockResolvedValue({
      ok: true,
      value: {
        id: "853a8e28-560a-4261-b152-1fe31c26dc42",
        profileId,
        targetPath: "/fixture/dap",
        confirmationToken: "sync-confirmation-token-long-enough",
        copies: [],
        unchanged: [],
        conflicts: [],
        errors: [],
        requiredBytes: 0,
      },
    });
    const chooseTarget = vi.spyOn(mockApi, "chooseSyncTargetAndCreateProfile");
    const applySync = vi.spyOn(mockApi, "applySync");
    Object.defineProperty(window, "outgroove", {
      configurable: true,
      value: mockApi,
    });
    const user = userEvent.setup();
    render(<App />);
    await openPrimaryView(user, "Sync");
    await openSyncSetupSection(user, "Saved profiles");

    const open = await screen.findByRole("button", {
      name: "Open DAP profile Road DAP",
    });
    await user.click(open);
    await user.click(screen.getByRole("button", { name: "Preview sync plan" }));
    expect(await screen.findByLabelText("Sync confirmation")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Manage Road DAP" }));
    await openSyncProfileManagement(user, "Road DAP");
    const edit = screen.getByRole("button", {
      name: "Edit albums in DAP profile Road DAP",
    });
    edit.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.queryByLabelText("Sync confirmation"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Profile draft")).toHaveTextContent(
      "Unsaved selection for Road DAP",
    );

    await openPrimaryView(user, "Library");
    await user.click(screen.getByRole("button", { name: /^Second Album/u }));
    await chooseAlbumAction(user, "Add Second Album to Sync");
    const save = screen.getByRole("button", {
      name: "Save album selection for Road DAP",
    });
    save.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(updateSyncProfileAlbums).toHaveBeenCalledWith({
        id: profileId,
        albumIds: [album.id, secondAlbum.id],
      }),
    );
    expect(chooseTarget).not.toHaveBeenCalled();
    expect(applySync).not.toHaveBeenCalled();
    expect(
      screen.queryByLabelText("Sync confirmation"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Preview sync plan" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Albums & profiles" }));
    await openSyncSetupSection(user, "Saved profiles");
    expect(
      screen.getByRole("list", { name: "Saved DAP profiles" }),
    ).toHaveTextContent("Second Album");

    await openSyncProfileManagement(user, "Road DAP");
    await user.click(
      screen.getByRole("button", {
        name: "Edit albums in DAP profile Road DAP",
      }),
    );
    await user.click(
      within(
        screen.getByRole("list", { name: "Albums selected for DAP sync" }),
      ).getByRole("button", { name: "Remove Second Album" }),
    );
    const cancel = screen.getByRole("button", {
      name: "Cancel album selection changes",
    });
    cancel.focus();
    await user.keyboard("{Enter}");
    expect(updateSyncProfileAlbums).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("list", { name: "Saved DAP profiles" }),
    ).toHaveTextContent("Second Album");
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
            savedLibraryFilters: 2,
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
    await openPrimaryView(user, "Settings");
    const databaseSection = screen.getByRole("button", {
      name: "Database safety",
    });
    databaseSection.focus();
    await user.keyboard("{Enter}");
    expect(databaseSection).toHaveAttribute("aria-current", "page");
    await user.click(
      await screen.findByRole("button", { name: "Restore from backup" }),
    );
    const preview = await screen.findByLabelText(
      "Database restore confirmation",
    );
    expect(
      within(preview).getByRole("heading", {
        name: "Replace the current Outgroove database?",
      }),
    ).toHaveFocus();
    expect(preview).toHaveTextContent("outgroove-backup.sqlite3");
    expect(preview).toHaveTextContent("300");
    expect(
      within(preview).getByText("Saved Library filters").nextElementSibling,
    ).toHaveTextContent("2");
    await user.click(screen.getByRole("button", { name: "Library folders" }));
    expect(
      screen.queryByLabelText("Database restore confirmation"),
    ).not.toBeInTheDocument();
    await openPrimaryView(user, "Activity");
    await openPrimaryView(user, "Settings");
    const pendingDatabaseSection = screen.getByRole("button", {
      name: "Database safety, confirmation pending",
    });
    pendingDatabaseSection.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByLabelText("Database restore confirmation"),
    ).toBeVisible();
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
    await openPrimaryView(user, "Settings");
    await user.click(screen.getByRole("button", { name: "Database safety" }));
    await user.click(
      await screen.findByRole("button", { name: "Create database backup" }),
    );
    expect(await screen.findByText("Backup disk is full")).toBeVisible();
    expect(
      screen.queryByText(/backup verified and saved/iu),
    ).not.toBeInTheDocument();
  });
});
