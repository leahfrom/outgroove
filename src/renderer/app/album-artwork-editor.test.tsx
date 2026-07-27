// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  AlbumArtworkEditPreviewDto,
  AlbumArtworkExportPreviewDto,
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
        onCancelPreview={vi.fn()}
        onChoose={onChoose}
        onConfirm={onConfirm}
        onExport={vi.fn()}
        onPrepareExport={vi.fn()}
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
        onCancelPreview={vi.fn()}
        onChoose={vi.fn()}
        onConfirm={onConfirm}
        onExport={vi.fn()}
        onPrepareExport={vi.fn()}
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
        onCancelPreview={vi.fn()}
        onChoose={vi.fn()}
        onConfirm={vi.fn()}
        onExport={onExport}
        onPrepareExport={onPrepareExport}
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
        onCancelPreview={vi.fn()}
        onChoose={vi.fn()}
        onConfirm={vi.fn()}
        onExport={onExport}
        onPrepareExport={onPrepareExport}
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
});
