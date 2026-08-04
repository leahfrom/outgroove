// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type {
  AlbumArtworkEditPreviewDto,
  AlbumArtworkExportPreviewDto,
  AlbumFolderArtworkPreviewDto,
} from "../../shared/contracts/api";
import type { CatalogTrack } from "../../shared/domain/catalog";
import { AlbumArtworkEditor } from "./album-artwork-editor";

const tracks: readonly CatalogTrack[] = [
  {
    id: "3c46b116-1b71-4f86-98d9-78db47fa693e",
    path: "/fixture/album/track.flac",
    size: 1024,
    modifiedMs: 1,
    format: "FLAC",
    durationSeconds: 180,
    scanError: null,
    tags: {
      title: "First track",
      album: "Fixture album",
      artist: "Fixture artist",
      albumArtist: "Fixture artist",
      trackNumber: 1,
      discNumber: 1,
      year: "2026",
    },
    nativeTags: [],
  },
  {
    id: "ee94f69b-c8cd-48bb-846a-91bb4301d23c",
    path: "/fixture/album/read-only.m4a",
    size: 2048,
    modifiedMs: 1,
    format: "M4A",
    durationSeconds: 200,
    scanError: null,
    tags: {
      title: "Second track",
      album: "Fixture album",
      artist: "Fixture artist",
      albumArtist: "Fixture artist",
      trackNumber: 2,
      discNumber: 1,
      year: "2026",
    },
    nativeTags: [],
  },
];
const selectionProps = {
  selectedFileIds: tracks.map((track) => track.id),
  onSelectionChange: vi.fn(),
};

function ArtworkSelectionHarness({
  onChoose,
}: {
  readonly onChoose: (fileIds: readonly string[]) => void;
}): React.JSX.Element {
  const [selectedFileIds, setSelectedFileIds] = useState(
    tracks.map((track) => track.id),
  );
  return (
    <AlbumArtworkEditor
      busy={false}
      tracks={tracks}
      selectedFileIds={selectedFileIds}
      error={undefined}
      exportError={undefined}
      exportPreview={undefined}
      exportResult={undefined}
      preview={undefined}
      result={undefined}
      resultAction={undefined}
      onCancelPreview={vi.fn()}
      onChoose={onChoose}
      onConfirm={vi.fn()}
      onExport={vi.fn()}
      onPrepareExport={vi.fn()}
      onPrepareRemoval={vi.fn()}
      onSelectionChange={(fileIds) => setSelectedFileIds([...fileIds])}
    />
  );
}

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
        {...selectionProps}
        busy={false}
        tracks={tracks}
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
    expect(onChoose).toHaveBeenCalledWith(tracks.map((track) => track.id));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("selects exact tracks by keyboard before preparing a local change", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<ArtworkSelectionHarness onChoose={onChoose} />);

    const secondTrack = screen.getByRole("checkbox", {
      name: /Second track/u,
    });
    secondTrack.focus();
    await user.keyboard(" ");
    expect(secondTrack).not.toBeChecked();
    expect(screen.getByText("1 of 2 tracks selected.")).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Choose JPEG or PNG" }),
    );
    expect(onChoose).toHaveBeenCalledWith([tracks[0]?.id]);

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(
      screen.getByText(
        "Choose at least one track before preparing a local artwork change.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Choose JPEG or PNG" }),
    ).toBeDisabled();
  });

  it("shows the proposed cover, exact file set, warnings, and confirmed write count", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <AlbumArtworkEditor
        {...selectionProps}
        busy={false}
        tracks={tracks}
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
      screen.getByRole("group", { name: "Tracks for local artwork changes" }),
    ).toBeDisabled();
    expect(
      within(confirmation).getByText("/fixture/album/track.flac"),
    ).toBeVisible();
    expect(
      within(confirmation).getByText(".m4a is read-only in this slice."),
    ).toBeVisible();
    expect(confirmation).toHaveTextContent(
      "save its current embedded pictures for recovery",
    );
    expect(confirmation).toHaveTextContent(
      "temporary file beside the original",
    );
    expect(confirmation).not.toHaveTextContent("audio payload");
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
        {...selectionProps}
        busy={false}
        tracks={tracks}
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
    expect(
      screen.queryByRole("group", {
        name: "Tracks for local artwork changes",
      }),
    ).not.toBeInTheDocument();
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
        {...selectionProps}
        busy={false}
        tracks={tracks}
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
        {...selectionProps}
        busy={false}
        tracks={tracks}
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
        {...selectionProps}
        busy={false}
        tracks={tracks}
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
        {...selectionProps}
        busy={false}
        tracks={tracks}
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
    expect(confirmation).toHaveTextContent(
      "check that the remaining pictures and music are unchanged",
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
        {...selectionProps}
        busy={false}
        tracks={tracks}
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
        {...selectionProps}
        busy={false}
        tracks={tracks}
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

  it("keeps exported artwork verification codes behind keyboard-accessible details", async () => {
    const user = userEvent.setup();
    render(
      <AlbumArtworkEditor
        {...selectionProps}
        busy={false}
        tracks={tracks}
        error={undefined}
        exportError={undefined}
        exportPreview={undefined}
        exportResult={{
          destinationPath: "/fixture/export/cover.png",
          byteLength: 1024,
          sha256:
            "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        }}
        preview={undefined}
        result={undefined}
        resultAction={undefined}
        onCancelPreview={vi.fn()}
        onChoose={vi.fn()}
        onConfirm={vi.fn()}
        onExport={vi.fn()}
        onPrepareExport={vi.fn()}
        onPrepareRemoval={vi.fn()}
      />,
    );

    await user.click(screen.getByText("Export current artwork"));
    expect(screen.getByText("Artwork exported and verified.")).toBeVisible();
    const summary = screen.getByText("File verification details");
    const details = summary.closest("details");
    if (!details) throw new Error("Artwork verification details missing");
    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText(/1234567890abcdef/u)).not.toBeVisible();
    summary.focus();
    expect(summary).toHaveFocus();
    await user.click(summary);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("File fingerprint (SHA-256)")).toBeVisible();
    expect(screen.getByText(/1234567890abcdef/u)).toBeVisible();
  });
});
