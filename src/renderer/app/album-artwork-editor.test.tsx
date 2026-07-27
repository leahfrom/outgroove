// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  AlbumArtworkEditPreviewDto,
  AlbumArtworkExportPreviewDto,
  AlbumFolderArtworkPreviewDto,
} from "../../shared/contracts/api";
import { AlbumArtworkEditor } from "./album-artwork-editor";

const preview: AlbumArtworkEditPreviewDto = {
  operationId: "36e97945-004e-4771-bf22-b3891bb811c4",
  confirmationToken: "confirmation-token-long-enough",
  action: "replace",
  proposedArtworkDataUrl: "data:image/png;base64,cHJldmlldw==",
  mimeType: "image/png",
  byteLength: 1024,
  width: 800,
  height: 800,
  files: [
    {
      fileId: "3c46b116-1b71-4f86-98d9-78db47fa693e",
      path: "/fixture/album/track.flac",
      currentFrontCovers: 1,
      preservedPictures: 2,
      willWrite: true,
      warnings: [],
    },
    {
      fileId: "ee94f69b-c8cd-48bb-846a-91bb4301d23c",
      path: "/fixture/album/read-only.m4a",
      currentFrontCovers: 0,
      preservedPictures: 0,
      willWrite: false,
      warnings: [".m4a is read-only in this slice."],
    },
  ],
};

const exportPreview: AlbumArtworkExportPreviewDto = {
  operationId: "9c92ba3d-d05a-47b5-914e-7886bb123712",
  confirmationToken: "export-confirmation-token-long-enough",
  artworkDataUrl: "data:image/png;base64,cHJldmlldw==",
  source: "folder",
  mimeType: "image/png",
  byteLength: 1024,
  width: 800,
  height: 800,
  suggestedFileName: "cover.png",
};

const removalPreview: AlbumArtworkEditPreviewDto = {
  operationId: "ae768aea-af97-42fd-aa55-3e19dbbb2046",
  confirmationToken: "removal-confirmation-token-long-enough",
  action: "remove",
  files: [
    {
      fileId: "3c46b116-1b71-4f86-98d9-78db47fa693e",
      path: "/fixture/album/track.flac",
      currentFrontCovers: 1,
      preservedPictures: 2,
      willWrite: true,
      warnings: [],
    },
    {
      fileId: "ee94f69b-c8cd-48bb-846a-91bb4301d23c",
      path: "/fixture/album/no-cover.mp3",
      currentFrontCovers: 0,
      preservedPictures: 1,
      willWrite: false,
      warnings: [],
    },
  ],
};

const folderPreview: AlbumFolderArtworkPreviewDto = {
  operationId: "d99ef593-c0db-4835-8c42-d688e053e864",
  confirmationToken: "folder-confirmation-token-long-enough",
  artworkDataUrl: "data:image/png;base64,cHJldmlldw==",
  mimeType: "image/png",
  byteLength: 1024,
  width: 800,
  height: 800,
  destinationPath: "/fixture/album/cover.png",
};

describe("AlbumArtworkEditor", () => {
  it("keeps choosing separate from the explicit keyboard confirmation", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onConfirm = vi.fn();
    render(
      <AlbumArtworkEditor
        busy={false}
        error={undefined}
        exportError={undefined}
        exportPreview={undefined}
        exportResult={undefined}
        preview={undefined}
        result={undefined}
        resultAction={undefined}
        onCancelPreview={vi.fn()}
        onChoose={onChoose}
        onConfirm={onConfirm}
        onExport={vi.fn()}
        onPrepareExport={vi.fn()}
        onPrepareRemoval={vi.fn()}
      />,
    );

    const choose = screen.getByRole("button", { name: "Choose JPEG or PNG" });
    choose.focus();
    await user.keyboard("{Enter}");
    expect(onChoose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows the proposed cover, exact file set, warnings, and confirmed write count", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <AlbumArtworkEditor
        busy={false}
        error={undefined}
        exportError={undefined}
        exportPreview={undefined}
        exportResult={undefined}
        preview={preview}
        result={undefined}
        resultAction={undefined}
        onCancelPreview={vi.fn()}
        onChoose={vi.fn()}
        onConfirm={onConfirm}
        onExport={vi.fn()}
        onPrepareExport={vi.fn()}
        onPrepareRemoval={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Proposed album cover" }),
    ).toBeVisible();
    const confirmation = screen.getByLabelText("Artwork edit confirmation");
    expect(
      within(confirmation).getByText("/fixture/album/track.flac"),
    ).toBeVisible();
    expect(
      within(confirmation).getByText(".m4a is read-only in this slice."),
    ).toBeVisible();
    const confirm = within(confirmation).getByRole("button", {
      name: "Confirm and write 1 file",
    });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("identifies a prepared remote original without bypassing confirmation", async () => {
    const user = userEvent.setup();
    const onCancelPreview = vi.fn();
    const onConfirm = vi.fn();
    render(
      <AlbumArtworkEditor
        busy={false}
        error={undefined}
        exportError={undefined}
        exportPreview={undefined}
        exportResult={undefined}
        preview={{
          ...preview,
          proposedArtworkSource: {
            kind: "cover-art-archive",
            releaseId: "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
            artworkId: "829521842",
          },
        }}
        result={undefined}
        resultAction={undefined}
        onCancelPreview={onCancelPreview}
        onChoose={vi.fn()}
        onConfirm={onConfirm}
        onExport={vi.fn()}
        onPrepareExport={vi.fn()}
        onPrepareRemoval={vi.fn()}
      />,
    );

    const confirmation = screen.getByLabelText("Artwork edit confirmation");
    expect(confirmation).toHaveTextContent(
      "Cover Art Archive original from exact MusicBrainz release",
    );
    expect(confirmation).toHaveTextContent(
      "2f3ad7a7-7d18-4f21-84ec-c5c3eac2deef",
    );
    expect(confirmation).toHaveTextContent("artwork 829521842");
    expect(confirmation).toHaveTextContent("nothing has been written");
    expect(onConfirm).not.toHaveBeenCalled();

    const cancel = within(confirmation).getByRole("button", {
      name: "Return without replacing",
    });
    cancel.focus();
    await user.keyboard("{Enter}");
    expect(onCancelPreview).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("progressively discloses and keyboard-operates a read-only artwork export", async () => {
    const user = userEvent.setup();
    const onPrepareExport = vi.fn();
    const onExport = vi.fn();
    const { rerender } = render(
      <AlbumArtworkEditor
        busy={false}
        error={undefined}
        exportError={undefined}
        exportPreview={undefined}
        exportResult={undefined}
        preview={undefined}
        result={undefined}
        resultAction={undefined}
        onCancelPreview={vi.fn()}
        onChoose={vi.fn()}
        onConfirm={vi.fn()}
        onExport={onExport}
        onPrepareExport={onPrepareExport}
        onPrepareRemoval={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Prepare artwork export" }),
    ).not.toBeVisible();
    const disclosure = screen
      .getByText("Export current artwork")
      .closest("summary");
    expect(disclosure).not.toBeNull();
    if (!disclosure) return;
    disclosure.focus();
    await user.click(disclosure);
    const prepare = screen.getByRole("button", {
      name: "Prepare artwork export",
    });
    prepare.focus();
    await user.keyboard("{Enter}");
    expect(onPrepareExport).toHaveBeenCalledOnce();
    expect(onExport).not.toHaveBeenCalled();

    rerender(
      <AlbumArtworkEditor
        busy={false}
        error={undefined}
        exportError={undefined}
        exportPreview={exportPreview}
        exportResult={undefined}
        preview={undefined}
        result={undefined}
        resultAction={undefined}
        onCancelPreview={vi.fn()}
        onChoose={vi.fn()}
        onConfirm={vi.fn()}
        onExport={onExport}
        onPrepareExport={onPrepareExport}
        onPrepareRemoval={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Artwork prepared for export" }),
    ).toBeVisible();
    expect(screen.getByText("Folder artwork")).toBeVisible();
    const exportButton = screen.getByRole("button", {
      name: "Export this artwork…",
    });
    exportButton.focus();
    await user.keyboard("{Enter}");
    expect(onExport).toHaveBeenCalledOnce();
  });

  it("requires a separate preview and keyboard confirmation before front-cover removal", async () => {
    const user = userEvent.setup();
    const onPrepareRemoval = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <AlbumArtworkEditor
        busy={false}
        error={undefined}
        exportError={undefined}
        exportPreview={undefined}
        exportResult={undefined}
        preview={undefined}
        result={undefined}
        resultAction={undefined}
        onCancelPreview={vi.fn()}
        onChoose={vi.fn()}
        onConfirm={onConfirm}
        onExport={vi.fn()}
        onPrepareExport={vi.fn()}
        onPrepareRemoval={onPrepareRemoval}
      />,
    );

    await user.click(screen.getByText("Remove embedded front covers"));
    const prepare = screen.getByRole("button", {
      name: "Preview front-cover removal",
    });
    prepare.focus();
    await user.keyboard("{Enter}");
    expect(onPrepareRemoval).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <AlbumArtworkEditor
        busy={false}
        error={undefined}
        exportError={undefined}
        exportPreview={undefined}
        exportResult={undefined}
        preview={removalPreview}
        result={undefined}
        resultAction={undefined}
        onCancelPreview={vi.fn()}
        onChoose={vi.fn()}
        onConfirm={onConfirm}
        onExport={vi.fn()}
        onPrepareExport={vi.fn()}
        onPrepareRemoval={onPrepareRemoval}
      />,
    );

    const confirmation = screen.getByLabelText("Artwork removal confirmation");
    expect(confirmation).toHaveTextContent(
      "Folder artwork and every embedded picture with another role remain untouched.",
    );
    expect(confirmation).toHaveTextContent(
      "Remove 1 embedded front cover; preserve 2 other embedded pictures.",
    );
    expect(confirmation).toHaveTextContent(
      "No embedded front cover; this file stays unchanged.",
    );
    const confirm = within(confirmation).getByRole("button", {
      name: "Confirm removal from 1 file",
    });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("keeps optional folder artwork behind disclosure, preview, and keyboard confirmation", async () => {
    const user = userEvent.setup();
    const onPrepareFolderArtwork = vi.fn();
    const onConfirmFolderArtwork = vi.fn();
    const onCancelFolderArtwork = vi.fn();
    const { rerender } = render(
      <AlbumArtworkEditor
        busy={false}
        error={undefined}
        exportError={undefined}
        exportPreview={undefined}
        exportResult={undefined}
        preview={undefined}
        result={undefined}
        resultAction={undefined}
        onCancelPreview={vi.fn()}
        onChoose={vi.fn()}
        onConfirm={vi.fn()}
        onExport={vi.fn()}
        onPrepareExport={vi.fn()}
        onPrepareRemoval={vi.fn()}
        onCancelFolderArtwork={onCancelFolderArtwork}
        onConfirmFolderArtwork={onConfirmFolderArtwork}
        onPrepareFolderArtwork={onPrepareFolderArtwork}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Preview folder artwork" }),
    ).not.toBeVisible();
    await user.click(screen.getByText("Create folder artwork"));
    const prepare = screen.getByRole("button", {
      name: "Preview folder artwork",
    });
    prepare.focus();
    await user.keyboard("{Enter}");
    expect(onPrepareFolderArtwork).toHaveBeenCalledOnce();
    expect(onConfirmFolderArtwork).not.toHaveBeenCalled();

    rerender(
      <AlbumArtworkEditor
        busy={false}
        error={undefined}
        exportError={undefined}
        exportPreview={undefined}
        exportResult={undefined}
        folderPreview={folderPreview}
        preview={undefined}
        result={undefined}
        resultAction={undefined}
        onCancelPreview={vi.fn()}
        onChoose={vi.fn()}
        onConfirm={vi.fn()}
        onExport={vi.fn()}
        onPrepareExport={vi.fn()}
        onPrepareRemoval={vi.fn()}
        onCancelFolderArtwork={onCancelFolderArtwork}
        onConfirmFolderArtwork={onConfirmFolderArtwork}
        onPrepareFolderArtwork={onPrepareFolderArtwork}
      />,
    );

    const confirmation = screen.getByLabelText("Folder artwork confirmation");
    expect(confirmation).toHaveTextContent("/fixture/album/cover.png");
    expect(confirmation).toHaveTextContent("Audio files remain unchanged");
    const confirm = within(confirmation).getByRole("button", {
      name: "Confirm and create folder artwork",
    });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(onConfirmFolderArtwork).toHaveBeenCalledOnce();

    const cancel = within(confirmation).getByRole("button", {
      name: "Keep embedded artwork only",
    });
    await user.click(cancel);
    expect(onCancelFolderArtwork).toHaveBeenCalledOnce();
  });
});
