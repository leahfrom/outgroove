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

  it("maps artwork identities to a fixed path-free IPC channel", async () => {
    electron.invoke.mockResolvedValue({ ok: true, value: [] });
    const request = {
      albumIds: ["6fdf7677-0e73-4f9a-85fd-6612ef381bdf"],
    };

    await api.loadAlbumArtwork(request);

    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.loadAlbumArtwork,
      request,
    );
    expect(api).not.toHaveProperty("readFile");
  });

  it("maps MusicBrainz lookup and cancellation to fixed album-ID-only channels", async () => {
    electron.invoke.mockResolvedValue({ ok: true, value: [] });
    const request = {
      albumId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
    };
    await api.findMusicBrainzAlbumCandidates(request);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.findMusicBrainzAlbumCandidates,
      request,
    );
    await api.cancelMusicBrainzAlbumCandidates(request);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.cancelMusicBrainzAlbumCandidates,
      request,
    );
    const release = {
      albumId: request.albumId,
      releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
    };
    await api.loadMusicBrainzReleaseTracks(release);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.loadMusicBrainzReleaseTracks,
      release,
    );
    const mapping = {
      ...release,
      edits: [
        {
          fileId: "73b6d616-0f52-4ef3-b71a-ffb42844e306",
          releaseTrackId: "11111111-1111-4111-8111-111111111111",
          changes: { title: "Mapped title" },
        },
      ],
    };
    await api.previewMusicBrainzTrackMapping(mapping);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.previewMusicBrainzTrackMapping,
      mapping,
    );
    expect(api).not.toHaveProperty("fetch");
    expect(api).not.toHaveProperty("searchProvider");
  });

  it("maps optional folder artwork through fixed preview and apply channels", async () => {
    electron.invoke.mockResolvedValue({ ok: true, value: null });
    const preview = {
      albumId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
    };
    await api.previewAlbumFolderArtwork(preview);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.previewAlbumFolderArtwork,
      preview,
    );

    const apply = {
      operationId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
      confirmationToken: "folder-confirmation-token-long-enough",
    };
    await api.applyAlbumFolderArtwork(apply);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.applyAlbumFolderArtwork,
      apply,
    );
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

    await api.chooseSyncProfileTarget({ profileId: update.id });
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.chooseSyncProfileTarget,
      { profileId: update.id },
    );

    const targetChange = {
      operationId: update.id,
      confirmationToken: "confirmation-token-long-enough",
    };
    await api.applySyncProfileTarget(targetChange);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.applySyncProfileTarget,
      targetChange,
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

    await api.listSyncRecoveries();
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.listSyncRecoveries,
      {},
    );
    const recoveryPreview = { runId: update.id };
    await api.previewSyncRecovery(recoveryPreview);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.previewSyncRecovery,
      recoveryPreview,
    );
    const recovery = {
      runId: update.id,
      confirmationToken: "sync-recovery-confirmation-token-long-enough",
    };
    await api.applySyncRecovery(recovery);
    expect(electron.invoke).toHaveBeenLastCalledWith(
      channels.applySyncRecovery,
      recovery,
    );
  });
});
