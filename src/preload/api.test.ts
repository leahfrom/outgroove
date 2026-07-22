import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({ ipcRenderer: electron }));

import { channels } from "../shared/contracts/channels";
import { api } from "./api";

describe("preload saved-filter allowlist", () => {
  beforeEach(() => electron.invoke.mockReset());

  it("maps each saved-filter method to one fixed IPC channel", async () => {
    electron.invoke.mockResolvedValue({ ok: true, value: [] });
    await api.listSavedLibraryFilters();
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.listSavedLibraryFilters,
      {},
    );

    const create = {
      name: "FLAC",
      definition: { query: "", view: "tracks", format: "FLAC" } as const,
    };
    await api.createSavedLibraryFilter(create);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.createSavedLibraryFilter,
      create,
    );

    const update = {
      id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
      name: "Lossless",
      definition: { query: "", view: "tracks", format: "FLAC" } as const,
    };
    await api.updateSavedLibraryFilter(update);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.updateSavedLibraryFilter,
      update,
    );

    const remove = { id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf" };
    await api.deleteSavedLibraryFilter(remove);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.deleteSavedLibraryFilter,
      remove,
    );
    expect(api).not.toHaveProperty("invoke");
    expect(api).not.toHaveProperty("ipcRenderer");
  });

  it("maps a multi-album DAP selection to the fixed profile channel", async () => {
    electron.invoke.mockResolvedValue({ ok: true, value: null });
    const request = {
      name: "Road DAP",
      albumIds: [
        "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
        "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
      ],
    };
    await api.chooseSyncTargetAndCreateProfile(request);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.createSyncProfile,
      request,
    );

    await api.listSyncProfiles();
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.listSyncProfiles,
      {},
    );

    const update = {
      id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
      albumIds: request.albumIds,
    };
    await api.updateSyncProfileAlbums(update);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.updateSyncProfileAlbums,
      update,
    );

    const rename = { id: update.id, name: "Pocket DAP" };
    await api.renameSyncProfile(rename);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.renameSyncProfile,
      rename,
    );

    const history = { profileId: update.id };
    await api.listSyncHistory(history);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.listSyncHistory,
      history,
    );

    const cancellation = { planId: update.id };
    await api.cancelSync(cancellation);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.cancelSync,
      cancellation,
    );
  });
});
