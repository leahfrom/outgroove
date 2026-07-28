import { describe, expect, it, vi } from "vitest";

import {
  acoustIdTrackConfirmRequestSchema,
  acoustIdTrackPreviewRequestSchema,
  addFavoriteArtistRequestSchema,
  albumArtworkRequestSchema,
  albumIdentificationRequestSchema,
  coverArtArchiveArtworkEditPreviewRequestSchema,
  coverArtArchiveRequestSchema,
  albumFolderArtworkPreviewRequestSchema,
  albumEditHistoryRequestSchema,
  albumEditUndoPreviewRequestSchema,
  databaseRestoreApplyRequestSchema,
  createSavedLibraryFilterRequestSchema,
  deleteSavedLibraryFilterRequestSchema,
  emptyRequestSchema,
  favoriteArtistListRequestSchema,
  favoriteArtistSearchRequestSchema,
  radarItemDismissRequestSchema,
  radarItemOpenRequestSchema,
  radarItemSeenRequestSchema,
  radarBackgroundRefreshUpdateRequestSchema,
  radarListRequestSchema,
  radarRefreshRequestSchema,
  scanCancelRequestSchema,
  libraryQueryRequestSchema,
  libraryRootRemovalApplyRequestSchema,
  libraryRootRemovalPreviewRequestSchema,
  renameSyncProfileRequestSchema,
  removeFavoriteArtistRequestSchema,
  scanRequestSchema,
  syncProfileRequestSchema,
  syncProfileTargetApplyRequestSchema,
  syncProfileTargetPreviewRequestSchema,
  syncHistoryRequestSchema,
  syncRecoveryApplyRequestSchema,
  syncRecoveryPreviewRequestSchema,
  syncCancelRequestSchema,
  trackBatchEditPreviewRequestSchema,
  trackNumberSequencePreviewRequestSchema,
  trackTagEditPreviewRequestSchema,
  updateSyncProfileAlbumsRequestSchema,
  updateSavedLibraryFilterRequestSchema,
} from "../../shared/contracts/api";
import { createValidatedHandler } from "./validated-handler";

describe("validated IPC handlers", () => {
  it("accepts only catalog identity and pending confirmation for AcoustID", async () => {
    const fileId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const preview = vi.fn(() => ({ readOnly: true }));
    const previewHandler = createValidatedHandler(
      acoustIdTrackPreviewRequestSchema,
      preview,
    );
    await expect(previewHandler({}, { fileId })).resolves.toMatchObject({
      ok: true,
      value: { readOnly: true },
    });
    expect(preview).toHaveBeenCalledWith({ fileId });
    for (const request of [
      { fileId: "not-an-id" },
      { fileId, path: "/private/library/track.flac" },
      { fileId, fingerprint: "audio-derived-data" },
      { fileId, providerUrl: "https://attacker.invalid" },
    ])
      await expect(previewHandler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });

    const confirm = vi.fn(() => ({ readOnly: true }));
    const confirmHandler = createValidatedHandler(
      acoustIdTrackConfirmRequestSchema,
      confirm,
    );
    const confirmation = {
      operationId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
      confirmationToken: "confirmation-token-with-enough-entropy",
    };
    await expect(confirmHandler({}, confirmation)).resolves.toMatchObject({
      ok: true,
    });
    expect(confirm).toHaveBeenCalledWith(confirmation);
    for (const request of [
      { ...confirmation, operationId: "not-an-id" },
      { ...confirmation, confirmationToken: "short" },
      { ...confirmation, fingerprint: "renderer-controlled" },
      { ...confirmation, duration: 123 },
    ])
      await expect(confirmHandler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("accepts only a bounded artist query and stable reviewed identity for Favorites", async () => {
    const search = vi.fn(() => ({ readOnly: true }));
    const searchHandler = createValidatedHandler(
      favoriteArtistSearchRequestSchema,
      search,
    );
    await expect(
      searchHandler({}, { query: "  Fixture Artist  " }),
    ).resolves.toMatchObject({
      ok: true,
      value: { readOnly: true },
    });
    expect(search).toHaveBeenCalledWith({ query: "Fixture Artist" });
    for (const request of [
      { query: "" },
      { query: "x".repeat(201) },
      { query: "Artist", path: "/private/library" },
      { query: "Artist", audio: "bytes" },
      { query: "Artist", providerUrl: "https://example.com" },
    ])
      await expect(searchHandler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });

    const add = vi.fn();
    const addHandler = createValidatedHandler(
      addFavoriteArtistRequestSchema,
      add,
    );
    const artistId = "7c08e5aa-3d6a-480f-8763-156120bc9bd9";
    await expect(addHandler({}, { artistId })).resolves.toMatchObject({
      ok: true,
    });
    expect(add).toHaveBeenCalledWith({ artistId });
    await expect(
      addHandler({}, { artistId, name: "Renderer supplied" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("validates local favorite listing and removal without accepting provider or path fields", async () => {
    const list = vi.fn(() => []);
    const listHandler = createValidatedHandler(
      favoriteArtistListRequestSchema,
      list,
    );
    await expect(listHandler({}, { query: "" })).resolves.toEqual({
      ok: true,
      value: [],
    });
    expect(list).toHaveBeenCalledWith({ query: "" });
    await expect(
      listHandler({}, { query: "", provider: "musicbrainz" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });

    const remove = vi.fn();
    const removeHandler = createValidatedHandler(
      removeFavoriteArtistRequestSchema,
      remove,
    );
    const id = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    await expect(removeHandler({}, { id })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      removeHandler({}, { id, targetPath: "/Volumes/DAP" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("accepts only stable local identities and bounded paging for Radar", async () => {
    const favoriteArtistId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const itemId = "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef";
    const refresh = vi.fn();
    const refreshHandler = createValidatedHandler(
      radarRefreshRequestSchema,
      refresh,
    );
    await expect(
      refreshHandler({}, { favoriteArtistId }),
    ).resolves.toMatchObject({ ok: true });
    expect(refresh).toHaveBeenCalledWith({ favoriteArtistId });
    for (const request of [
      { favoriteArtistId: "not-an-id" },
      { favoriteArtistId, artistId: favoriteArtistId },
      { favoriteArtistId, providerUrl: "https://example.com" },
      { favoriteArtistId, path: "/private/library" },
    ])
      await expect(refreshHandler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });

    const refreshAll = vi.fn();
    const refreshAllHandler = createValidatedHandler(
      emptyRequestSchema,
      refreshAll,
    );
    await expect(refreshAllHandler({}, {})).resolves.toMatchObject({
      ok: true,
    });
    expect(refreshAll).toHaveBeenCalledWith({});
    for (const request of [
      { favoriteArtistId },
      { artistIds: [favoriteArtistId] },
      { providerUrl: "https://example.com" },
      { path: "/private/library" },
    ])
      await expect(refreshAllHandler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });

    const updateBackground = vi.fn();
    const backgroundHandler = createValidatedHandler(
      radarBackgroundRefreshUpdateRequestSchema,
      updateBackground,
    );
    const preferences = {
      enabled: true,
      pauseOnBattery: true,
      notificationsEnabled: false,
    };
    await expect(backgroundHandler({}, preferences)).resolves.toMatchObject({
      ok: true,
    });
    expect(updateBackground).toHaveBeenCalledWith(preferences);
    for (const request of [
      { enabled: true },
      {
        enabled: 1,
        pauseOnBattery: true,
        notificationsEnabled: false,
      },
      {
        enabled: true,
        pauseOnBattery: true,
        notificationsEnabled: false,
        intervalHours: 1,
      },
      {
        enabled: true,
        pauseOnBattery: true,
        notificationsEnabled: false,
        artistIds: [favoriteArtistId],
      },
      {
        enabled: true,
        pauseOnBattery: true,
        notificationsEnabled: false,
        path: "/private/library",
      },
    ])
      await expect(backgroundHandler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });

    const list = vi.fn(() => ({ items: [], totalItems: 0 }));
    const listHandler = createValidatedHandler(radarListRequestSchema, list);
    const page = {
      view: "newly-found",
      primaryType: "album",
      favoriteArtistId,
      unseenOnly: true,
      includeDismissed: false,
      offset: 0,
      limit: 20,
    };
    await expect(listHandler({}, page)).resolves.toMatchObject({ ok: true });
    expect(list).toHaveBeenCalledWith(page);
    for (const request of [
      {
        view: page.view,
        primaryType: page.primaryType,
        unseenOnly: page.unseenOnly,
        includeDismissed: page.includeDismissed,
        offset: page.offset,
        limit: page.limit,
      },
      {
        view: page.view,
        primaryType: page.primaryType,
        favoriteArtistId: page.favoriteArtistId,
        includeDismissed: page.includeDismissed,
        offset: page.offset,
        limit: page.limit,
      },
      { ...page, view: "unknown" },
      { ...page, primaryType: "soundtrack" },
      { ...page, favoriteArtistId: "not-an-id" },
      { ...page, unseenOnly: 1 },
      { ...page, limit: 51 },
      { ...page, offset: -1 },
      { ...page, provider: "musicbrainz" },
      { ...page, path: "/private/library" },
    ])
      await expect(listHandler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });

    const seen = vi.fn();
    const seenHandler = createValidatedHandler(
      radarItemSeenRequestSchema,
      seen,
    );
    await expect(
      seenHandler({}, { id: itemId, seen: true }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      seenHandler({}, { id: itemId, seen: true, audio: "bytes" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });

    const dismiss = vi.fn();
    const dismissHandler = createValidatedHandler(
      radarItemDismissRequestSchema,
      dismiss,
    );
    await expect(
      dismissHandler({}, { id: itemId, dismissed: false }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      dismissHandler({}, { id: itemId, dismissed: false, targetPath: "/tmp" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });

    const open = vi.fn();
    const openHandler = createValidatedHandler(
      radarItemOpenRequestSchema,
      open,
    );
    await expect(openHandler({}, { id: itemId })).resolves.toMatchObject({
      ok: true,
    });
    expect(open).toHaveBeenCalledWith({ id: itemId });
    for (const request of [
      { id: "not-an-id" },
      { id: itemId, url: "https://attacker.invalid" },
      { id: itemId, releaseGroupId: itemId },
      { id: itemId, path: "/private/library" },
    ])
      await expect(openHandler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("accepts only an album and release identity for Cover Art Archive preview", async () => {
    const useCase = vi.fn(() => ({ readOnly: true }));
    const handler = createValidatedHandler(
      coverArtArchiveRequestSchema,
      useCase,
    );
    const albumId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const releaseId = "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef";
    await expect(handler({}, { albumId, releaseId })).resolves.toMatchObject({
      ok: true,
      value: { readOnly: true },
    });
    expect(useCase).toHaveBeenCalledWith({ albumId, releaseId });
    for (const request of [
      { albumId, releaseId: "not-an-id" },
      { albumId, releaseId, url: "https://example.com/image.jpg" },
      { albumId, releaseId, path: "/private/library/album" },
      { albumId, releaseId, audio: "bytes" },
    ])
      await expect(handler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("accepts only exact provider identities for a Cover Art Archive artwork-edit preview", async () => {
    const useCase = vi.fn(() => ({ action: "replace" }));
    const handler = createValidatedHandler(
      coverArtArchiveArtworkEditPreviewRequestSchema,
      useCase,
    );
    const request = {
      albumId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
      releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
      artworkId: "829521842",
    };
    await expect(handler({}, request)).resolves.toMatchObject({
      ok: true,
      value: { action: "replace" },
    });
    expect(useCase).toHaveBeenCalledWith(request);
    for (const invalid of [
      { ...request, artworkId: "" },
      { ...request, artworkId: "../image" },
      { ...request, url: "https://example.com/image.jpg" },
      { ...request, bytes: "image bytes" },
      { ...request, path: "/private/library/cover.jpg" },
    ])
      await expect(handler({}, invalid)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("accepts only an album identity for remote candidate lookup", async () => {
    const useCase = vi.fn(() => ({ readOnly: true }));
    const handler = createValidatedHandler(
      albumIdentificationRequestSchema,
      useCase,
    );
    const albumId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    await expect(handler({}, { albumId })).resolves.toMatchObject({
      ok: true,
      value: { readOnly: true },
    });
    expect(useCase).toHaveBeenCalledWith({ albumId });
    for (const request of [
      { albumId: "not-an-id" },
      { albumId, query: "arbitrary provider query" },
      { albumId, path: "/private/library/album" },
      { albumId, audio: "bytes" },
    ])
      await expect(handler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("accepts only bounded album identities for artwork queries", async () => {
    const useCase = vi.fn(() => []);
    const handler = createValidatedHandler(albumArtworkRequestSchema, useCase);
    const albumId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    await expect(handler({}, { albumIds: [albumId] })).resolves.toEqual({
      ok: true,
      value: [],
    });
    expect(useCase).toHaveBeenCalledWith({ albumIds: [albumId] });
    for (const request of [
      { albumIds: [] },
      { albumIds: [albumId, albumId] },
      { albumIds: [albumId], path: "/private/library/cover.png" },
    ])
      await expect(handler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("does not accept renderer-supplied paths for folder artwork", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(
      albumFolderArtworkPreviewRequestSchema,
      useCase,
    );
    const albumId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    await expect(handler({}, { albumId })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    await expect(
      handler({}, { albumId, destinationPath: "/tmp/cover.jpg" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    expect(useCase).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed and unknown request fields without calling the use case", async () => {
    const useCase = vi.fn(() => "ok");
    const handler = createValidatedHandler(scanRequestSchema, useCase);
    await expect(handler({}, { rootId: "not-a-uuid" })).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    await expect(
      handler(
        {},
        {
          rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
          arbitraryPath: "/etc",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
  });

  it("accepts exactly the declared request", async () => {
    const handler = createValidatedHandler(
      scanRequestSchema,
      ({ rootId }) => rootId,
    );
    await expect(
      handler({}, { rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf" }),
    ).resolves.toEqual({
      ok: true,
      value: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
    });
  });

  it("rejects injected fields on read-only list requests", async () => {
    const useCase = vi.fn(() => []);
    const handler = createValidatedHandler(emptyRequestSchema, useCase);
    await expect(handler({}, {})).resolves.toEqual({ ok: true, value: [] });
    await expect(
      handler({}, { targetPath: "/Volumes/untrusted" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    expect(useCase).toHaveBeenCalledTimes(1);
  });

  it("validates bounded, distinct multi-album DAP selections without accepting target paths", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(syncProfileRequestSchema, useCase);
    const albumIds = [
      "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
      "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
    ];
    await expect(handler({}, { name: "Road DAP", albumIds })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(useCase).toHaveBeenCalledWith({ name: "Road DAP", albumIds });
    for (const request of [
      { name: "Empty", albumIds: [] },
      { name: "Duplicate", albumIds: [albumIds[0], albumIds[0]] },
      { name: "Path injection", albumIds, targetPath: "/Volumes/DAP" },
    ])
      await expect(handler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("validates DAP profile album revisions without accepting target changes", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(
      updateSyncProfileAlbumsRequestSchema,
      useCase,
    );
    const id = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const albumIds = ["86fb71a8-9faf-49f9-ad60-39e5bb28c02d"];
    await expect(handler({}, { id, albumIds })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(useCase).toHaveBeenCalledWith({ id, albumIds });
    for (const request of [
      { id, albumIds: [] },
      { id, albumIds: [albumIds[0], albumIds[0]] },
      { id, albumIds, targetPath: "/Volumes/DAP" },
    ])
      await expect(handler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("validates bounded DAP profile names without accepting other changes", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(
      renameSyncProfileRequestSchema,
      useCase,
    );
    const id = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    await expect(handler({}, { id, name: "  Pocket DAP  " })).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(useCase).toHaveBeenCalledWith({ id, name: "Pocket DAP" });
    for (const request of [
      { id, name: "   " },
      { id, name: "x".repeat(101) },
      { id, name: "Pocket DAP", targetPath: "/Volumes/DAP" },
      { id, name: "Pocket DAP", albumIds: [id] },
    ])
      await expect(handler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("accepts only a profile identity for bounded sync history", async () => {
    const useCase = vi.fn(() => []);
    const handler = createValidatedHandler(syncHistoryRequestSchema, useCase);
    const profileId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    await expect(handler({}, { profileId })).resolves.toEqual({
      ok: true,
      value: [],
    });
    expect(useCase).toHaveBeenCalledWith({ profileId });
    for (const request of [
      { profileId: "not-a-uuid" },
      { profileId, targetPath: "/Volumes/DAP" },
      { profileId, limit: 10 },
    ])
      await expect(handler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("validates both stages of a DAP profile target change without accepting paths", async () => {
    const profileId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const chooseTarget = createValidatedHandler(
      syncProfileTargetPreviewRequestSchema,
      vi.fn(),
    );
    await expect(chooseTarget({}, { profileId })).resolves.toMatchObject({
      ok: true,
    });
    await expect(
      chooseTarget({}, { profileId, targetPath: "/Volumes/DAP" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });

    const applyTarget = createValidatedHandler(
      syncProfileTargetApplyRequestSchema,
      vi.fn(),
    );
    await expect(
      applyTarget(
        {},
        {
          operationId: profileId,
          confirmationToken: "confirmation-token-long-enough",
        },
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      applyTarget(
        {},
        {
          operationId: profileId,
          confirmationToken: "short",
          targetPath: "/Volumes/DAP",
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
  });

  it("validates both stages of watched-root removal without accepting paths", async () => {
    const preview = vi.fn();
    const previewHandler = createValidatedHandler(
      libraryRootRemovalPreviewRequestSchema,
      preview,
    );
    await expect(
      previewHandler(
        {},
        {
          rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
          path: "/fixture",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(preview).not.toHaveBeenCalled();

    const apply = vi.fn();
    const applyHandler = createValidatedHandler(
      libraryRootRemovalApplyRequestSchema,
      apply,
    );
    await expect(
      applyHandler(
        {},
        {
          operationId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
          confirmationToken: "too-short",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(apply).not.toHaveBeenCalled();
  });

  it("rejects unknown fields on cancellation requests", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(scanCancelRequestSchema, useCase);
    await expect(
      handler(
        {},
        {
          jobId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
          arbitraryChannel: "filesystem:delete",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
  });

  it("accepts only a sync preview identity for cancellation", async () => {
    const useCase = vi.fn(() => ({ accepted: true }));
    const handler = createValidatedHandler(syncCancelRequestSchema, useCase);
    const planId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    await expect(handler({}, { planId })).resolves.toMatchObject({
      ok: true,
      value: { accepted: true },
    });
    expect(useCase).toHaveBeenCalledWith({ planId });
    for (const request of [
      { planId: "not-a-uuid" },
      { planId, targetPath: "/Volumes/DAP" },
      { planId, deletePartialFiles: true },
    ])
      await expect(handler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("requires an exact interrupted-sync recovery confirmation", async () => {
    const useCase = vi.fn(() => ({ complete: true }));
    const handler = createValidatedHandler(
      syncRecoveryApplyRequestSchema,
      useCase,
    );
    const runId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const confirmationToken = "sync-recovery-confirmation-token-long-enough";
    await expect(
      handler({}, { runId, confirmationToken }),
    ).resolves.toMatchObject({ ok: true, value: { complete: true } });
    expect(useCase).toHaveBeenCalledWith({ runId, confirmationToken });
    for (const request of [
      { runId, confirmationToken: "short" },
      { runId: "not-a-uuid", confirmationToken },
      { runId, confirmationToken, targetPath: "/Volumes/DAP" },
      { runId, confirmationToken, deleteUnknownFiles: true },
    ])
      await expect(handler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("accepts only a recovery run identifier for read-only inspection", async () => {
    const useCase = vi.fn(() => ({ actions: [] }));
    const handler = createValidatedHandler(
      syncRecoveryPreviewRequestSchema,
      useCase,
    );
    const runId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    await expect(handler({}, { runId })).resolves.toMatchObject({
      ok: true,
      value: { actions: [] },
    });
    expect(useCase).toHaveBeenCalledWith({ runId });
    for (const request of [
      { runId: "not-a-uuid" },
      { runId, targetPath: "/Volumes/DAP" },
      { runId, deleteUnknownFiles: true },
    ])
      await expect(handler({}, request)).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });
  });

  it("validates bounded Library views and rejects undeclared filters", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(libraryQueryRequestSchema, useCase);
    await expect(
      handler({}, { query: "", view: "albums", offset: 0, limit: 500 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "albums",
          offset: 0,
          limit: 20,
          arbitrarySql: "DROP TABLE albums",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "folders",
          offset: 0,
          limit: 20,
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "tracks",
          offset: 0,
          limit: 20,
          folderId: "/library/album",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenLastCalledWith({
      query: "",
      view: "tracks",
      offset: 0,
      limit: 20,
      folderId: "/library/album",
    });
    await expect(
      handler({}, { query: "", view: "genres", offset: 0, limit: 20 }),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "tracks",
          offset: 0,
          limit: 20,
          genre: "Ambient",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "genres",
          offset: 0,
          limit: 20,
          genre: "Ambient",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "tracks",
          offset: 0,
          limit: 20,
          genre: "Ambient",
          missingGenre: true,
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "folders",
          offset: 0,
          limit: 20,
          folderId: "/library/album",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "data-quality",
          offset: 20,
          limit: 20,
          qualityFilter: "consistency",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenCalledWith({
      query: "fixture",
      view: "data-quality",
      offset: 20,
      limit: 20,
      qualityFilter: "consistency",
    });
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "data-quality",
          offset: 0,
          limit: 20,
          qualityFilter: "guess-for-me",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "artists",
          offset: 0,
          limit: 20,
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenLastCalledWith({
      query: "fixture",
      view: "artists",
      offset: 0,
      limit: 20,
    });
    await expect(
      handler(
        {},
        {
          query: "fixture",
          view: "albums",
          offset: 0,
          limit: 20,
          albumArtist: "Fixture Artist",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenLastCalledWith({
      query: "fixture",
      view: "albums",
      offset: 0,
      limit: 20,
      albumArtist: "Fixture Artist",
    });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "albums",
          offset: 0,
          limit: 20,
          albumArtist: " ",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "Needle",
          view: "tracks",
          offset: 0,
          limit: 20,
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenLastCalledWith({
      query: "Needle",
      view: "tracks",
      offset: 0,
      limit: 20,
    });
    await expect(
      handler(
        {},
        {
          query: "fl",
          view: "formats",
          offset: 0,
          limit: 20,
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "tracks",
          offset: 0,
          limit: 20,
          format: "FLAC",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    expect(useCase).toHaveBeenLastCalledWith({
      query: "",
      view: "tracks",
      offset: 0,
      limit: 20,
      format: "FLAC",
    });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "formats",
          offset: 0,
          limit: 20,
          format: "FLAC",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "albums",
          offset: 0,
          limit: 20,
          albumId: "8c196850-bca9-48b7-ae7f-dc760fbf8f2b",
        },
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
    await expect(
      handler(
        {},
        {
          query: "",
          view: "tracks",
          offset: 0,
          limit: 20,
          albumId: "8c196850-bca9-48b7-ae7f-dc760fbf8f2b",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
  });

  it("validates saved Library filter definitions and deletion identities", async () => {
    const create = vi.fn();
    const createHandler = createValidatedHandler(
      createSavedLibraryFilterRequestSchema,
      create,
    );
    const valid = {
      name: "Ambient without genre",
      definition: {
        query: "live",
        view: "tracks",
        genre: { name: "No genre tag", missing: true },
      },
    };
    await expect(createHandler({}, valid)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(create).toHaveBeenCalledWith(valid);
    for (const definition of [
      { query: "", view: "albums", format: "FLAC" },
      {
        query: "",
        view: "tracks",
        format: "FLAC",
        genre: { name: "Rock", missing: false },
      },
      { query: "", view: "albums", arbitrarySql: "DROP TABLE albums" },
    ])
      await expect(
        createHandler({}, { name: "Rejected", definition }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: "INVALID_REQUEST" },
      });

    const update = vi.fn();
    const updateHandler = createValidatedHandler(
      updateSavedLibraryFilterRequestSchema,
      update,
    );
    const updateRequest = {
      id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
      ...valid,
    };
    await expect(updateHandler({}, updateRequest)).resolves.toEqual({
      ok: true,
      value: undefined,
    });
    expect(update).toHaveBeenCalledWith(updateRequest);
    await expect(
      updateHandler({}, { ...updateRequest, id: "not-a-uuid", path: "/tmp" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });

    const remove = vi.fn();
    const removeHandler = createValidatedHandler(
      deleteSavedLibraryFilterRequestSchema,
      remove,
    );
    await expect(
      removeHandler({}, { id: "not-a-uuid", path: "/fixture" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("rejects malformed database restore confirmations", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(
      databaseRestoreApplyRequestSchema,
      useCase,
    );
    await expect(
      handler(
        {},
        {
          operationId: "not-a-uuid",
          confirmationToken: "short",
          databasePath: "/arbitrary/path",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
  });

  it("rejects arbitrary fields and malformed ids on edit history and undo requests", async () => {
    const useCase = vi.fn();
    const history = createValidatedHandler(
      albumEditHistoryRequestSchema,
      useCase,
    );
    const undo = createValidatedHandler(
      albumEditUndoPreviewRequestSchema,
      useCase,
    );
    await expect(
      history(
        {},
        {
          albumId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
          filePath: "/arbitrary/file.mp3",
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    await expect(
      undo({}, { operationId: "not-a-uuid" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    expect(useCase).not.toHaveBeenCalled();
  });

  it("strictly validates track metadata patches", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(
      trackTagEditPreviewRequestSchema,
      useCase,
    );
    const fileId = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    await expect(
      handler({}, { fileId, changes: { year: "2025-02-29" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        { fileId, changes: { artist: "Artist", arbitraryFrame: "TXXX" } },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileId, changes: {}, filePath: "/arbitrary/file.mp3" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileId, changes: { genres: ["Rock", "Metal"] } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileId, changes: { trackTotal: 10_000 } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileId, changes: { discTotal: 0 } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileId, changes: { originalReleaseDate: "2026-13" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileId, changes: { comment: "C".repeat(4001) } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileId, changes: { language: "L".repeat(101) } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileId, changes: { bpm: 1000 } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        { fileId, changes: { musicBrainzRecordingId: "not-a-uuid" } },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileId,
          changes: { composers: ["First Composer", "Second Composer"] },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileId,
          changes: {
            conductors: ["First Conductor", "Second Conductor"],
          },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileId,
          changes: {
            lyricists: ["First Lyricist", "Second Lyricist"],
          },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileId,
          changes: { isrcs: ["DEABC2600001", "DEABC2600002"] },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileId,
          changes: {
            trackTotal: 12,
            discTotal: null,
            genres: ["  Post Rock  "],
            composers: ["  Fixture Composer  "],
            conductors: ["  Fixture Conductor  "],
            lyricists: ["  Fixture Lyricist  "],
            isrcs: ["  DEABC2600001  "],
            copyright: "  Copyright Fixture  ",
            comment: "  Fixture comment  ",
            originalReleaseDate: "  1998-04  ",
            language: "  deu  ",
            publishers: ["  Fixture Publisher  "],
            descriptions: ["  Fixture description  "],
            grouping: "  Suite I  ",
            catalogNumbers: ["  OUT-42  "],
            publishingDate: "  2025-09  ",
            bpm: 127,
            compilation: true,
            musicBrainzRecordingId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
          },
        },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(useCase).toHaveBeenCalledWith({
      fileId,
      changes: {
        trackTotal: 12,
        discTotal: null,
        genres: ["Post Rock"],
        composers: ["Fixture Composer"],
        conductors: ["Fixture Conductor"],
        lyricists: ["Fixture Lyricist"],
        isrcs: ["DEABC2600001"],
        copyright: "Copyright Fixture",
        comment: "Fixture comment",
        originalReleaseDate: "1998-04",
        language: "deu",
        publishers: ["Fixture Publisher"],
        descriptions: ["Fixture description"],
        grouping: "Suite I",
        catalogNumbers: ["OUT-42"],
        publishingDate: "2025-09",
        bpm: 127,
        compilation: true,
        musicBrainzRecordingId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
    });
  });

  it("limits batch edits to unique track ids and shared safe fields", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(
      trackBatchEditPreviewRequestSchema,
      useCase,
    );
    const first = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const second = "e709f458-a288-4f90-a016-9c42347670bb";
    await expect(
      handler({}, { fileIds: [first, first], changes: { artist: "Artist" } }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        { fileIds: [first, second], changes: { title: "Mass title" } },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          changes: { musicBrainzRecordingId: first },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          changes: { lyricists: ["First Lyricist", "Second Lyricist"] },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          changes: { comment: "Comments stay single-track only" },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          changes: { isrcs: ["DEABC2600001", "DEABC2600002"] },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          changes: {
            conductors: ["First Conductor", "Second Conductor"],
          },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          changes: { trackTotal: 10_000, discTotal: 0 },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          changes: { artist: "Artist" },
          directory: "/arbitrary/path",
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          changes: { genres: ["Rock", "Metal"] },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          changes: { composers: ["First Composer", "Second Composer"] },
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          changes: {
            trackTotal: 12,
            discTotal: 2,
            genres: [],
            composers: ["Fixture Composer"],
            conductors: ["Fixture Conductor"],
            lyricists: ["Fixture Lyricist"],
            isrcs: ["DEABC2600001"],
            copyright: null,
            originalReleaseDate: "1998-04",
            language: "deu",
            publishers: ["Fixture Publisher"],
            grouping: "Suite I",
            catalogNumbers: ["OUT-42"],
            publishingDate: "2025-09",
            compilation: true,
            musicBrainzReleaseId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
            musicBrainzReleaseArtistIds: [
              "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB",
            ],
            musicBrainzReleaseGroupId: "CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC",
          },
        },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(useCase).toHaveBeenCalledWith({
      fileIds: [first, second],
      changes: {
        trackTotal: 12,
        discTotal: 2,
        genres: [],
        composers: ["Fixture Composer"],
        conductors: ["Fixture Conductor"],
        lyricists: ["Fixture Lyricist"],
        isrcs: ["DEABC2600001"],
        copyright: null,
        originalReleaseDate: "1998-04",
        language: "deu",
        publishers: ["Fixture Publisher"],
        grouping: "Suite I",
        catalogNumbers: ["OUT-42"],
        publishingDate: "2025-09",
        compilation: true,
        musicBrainzReleaseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        musicBrainzReleaseArtistIds: ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
        musicBrainzReleaseGroupId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      },
    });
  });

  it("requires an explicit bounded order for track-number sequencing", async () => {
    const useCase = vi.fn();
    const handler = createValidatedHandler(
      trackNumberSequencePreviewRequestSchema,
      useCase,
    );
    const first = "6fdf7677-0e73-4f9a-85fd-6612ef381bdf";
    const second = "e709f458-a288-4f90-a016-9c42347670bb";
    await expect(
      handler({}, { fileIds: [first, first], startNumber: 1 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileIds: [first, second], startNumber: 9999 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler({}, { fileIds: [first, second], startNumber: 1, discNumber: 0 }),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    await expect(
      handler(
        {},
        {
          fileIds: [first, second],
          startNumber: 1,
          inferredPathOrder: ["/arbitrary/file.mp3"],
        },
      ),
    ).resolves.toMatchObject({ ok: false, error: { code: "INVALID_REQUEST" } });
    expect(useCase).not.toHaveBeenCalled();
  });
});
