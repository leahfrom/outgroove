// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  TagEditHistoryItemDto,
  TrackBatchEditPreviewDto,
} from "../../shared/contracts/api";
import {
  AlbumTitleWorkbench,
  type AlbumTitleSection,
} from "./album-title-workbench";

const historyItem: TagEditHistoryItemDto = {
  operationId: "75d39ca7-fc00-41b7-a132-2024b912573f",
  kind: "album-title-edit",
  sourceOperationId: null,
  proposedTitle: "Renamed Album",
  state: "completed",
  createdAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:01:00.000Z",
  verifiedFiles: 1,
  failedFiles: 0,
};

function renderWorkbench({
  section = "edit",
  editHistory = [historyItem],
  batchUndoPreview,
}: {
  readonly section?: AlbumTitleSection;
  readonly editHistory?: readonly TagEditHistoryItemDto[];
  readonly batchUndoPreview?: TrackBatchEditPreviewDto;
} = {}) {
  const onSectionChange = vi.fn();
  const onPreviewUndo = vi.fn();
  const onPreviewArtworkUndo = vi.fn();
  const onConfirmBatchUndo = vi.fn();

  render(
    <AlbumTitleWorkbench
      albumTitle="Fixture Album"
      artworkUndoPreview={undefined}
      artworkUndoResult={undefined}
      batchUndoKind="shared-fields"
      batchUndoPreview={batchUndoPreview}
      batchUndoResult={undefined}
      busy={false}
      draftTitle="Fixture Album"
      editError={undefined}
      editHistory={editHistory}
      editPreview={undefined}
      editResult={undefined}
      historyError={undefined}
      onCancelBatchUndo={vi.fn()}
      onCancelArtworkUndo={vi.fn()}
      onCancelEditPreview={vi.fn()}
      onCancelTrackUndo={vi.fn()}
      onCancelUndo={vi.fn()}
      onConfirmBatchUndo={onConfirmBatchUndo}
      onConfirmArtworkUndo={vi.fn()}
      onConfirmEdit={vi.fn()}
      onConfirmTrackUndo={vi.fn()}
      onConfirmUndo={vi.fn()}
      onDraftTitleChange={vi.fn()}
      onPreviewBatchUndo={vi.fn()}
      onPreviewArtworkUndo={onPreviewArtworkUndo}
      onPreviewEdit={vi.fn()}
      onPreviewTrackUndo={vi.fn()}
      onPreviewUndo={onPreviewUndo}
      onSectionChange={onSectionChange}
      section={section}
      trackUndoPreview={undefined}
      trackUndoResult={undefined}
      undoPreview={undefined}
      undoResult={undefined}
    />,
  );

  return {
    onConfirmBatchUndo,
    onPreviewArtworkUndo,
    onPreviewUndo,
    onSectionChange,
  };
}

describe("AlbumTitleWorkbench", () => {
  it("offers verified artwork edits through the same reviewed undo history", async () => {
    const user = userEvent.setup();
    const artworkHistory: TagEditHistoryItemDto = {
      ...historyItem,
      kind: "album-artwork-edit",
      proposedTitle: "Replace embedded front cover",
    };
    const { onPreviewArtworkUndo } = renderWorkbench({
      section: "history",
      editHistory: [artworkHistory],
    });

    const button = screen.getByRole("button", {
      name: "Preview artwork undo",
    });
    button.focus();
    await user.keyboard("{Enter}");
    expect(onPreviewArtworkUndo).toHaveBeenCalledWith(
      artworkHistory.operationId,
    );
  });

  it("labels a verified front-cover removal honestly in artwork history", () => {
    renderWorkbench({
      section: "history",
      editHistory: [
        {
          ...historyItem,
          kind: "album-artwork-edit",
          proposedTitle: "Remove embedded front cover",
        },
      ],
    });

    expect(screen.getByText("Removed embedded front cover")).toBeVisible();
  });

  it("discloses history contextually and supports keyboard navigation", async () => {
    const user = userEvent.setup();
    const { onSectionChange } = renderWorkbench();

    expect(screen.getByLabelText("Proposed title")).toBeVisible();
    expect(
      screen.queryByLabelText("Metadata edit history"),
    ).not.toBeInTheDocument();

    const historyButton = screen.getByRole("button", {
      name: /^History & undo/u,
    });
    historyButton.focus();
    await user.keyboard("{Enter}");

    expect(onSectionChange).toHaveBeenCalledWith("history");
  });

  it("shows an honest empty history state", () => {
    renderWorkbench({ section: "history", editHistory: [] });

    const history = screen.getByLabelText("Metadata edit history");
    expect(within(history).getByText("No confirmed edits yet")).toBeVisible();
    expect(
      within(history).queryByRole("button", { name: /undo/u }),
    ).not.toBeInTheDocument();
  });

  it("keeps a safe partial batch undo confirmable", async () => {
    const user = userEvent.setup();
    const { onConfirmBatchUndo } = renderWorkbench({
      section: "history",
      batchUndoPreview: {
        operationId: "fba25f9c-51ad-41c7-a838-4dcdf20a587a",
        confirmationToken: "batch-undo-confirmation-token-long-enough",
        files: [
          {
            fileId: "safe-file",
            path: "/fixture/safe.flac",
            willWrite: true,
            changes: [
              {
                field: "artist",
                before: "Renamed Artist",
                after: "Fixture Artist",
              },
            ],
            warnings: [],
          },
          {
            fileId: "conflicted-file",
            path: "/fixture/conflicted.mp3",
            willWrite: true,
            changes: [],
            warnings: ["This field changed after the original edit."],
          },
        ],
      },
    });

    const confirmation = screen.getByLabelText(
      "Batch metadata undo confirmation",
    );
    const confirm = within(confirmation).getByRole("button", {
      name: "Confirm safe batch undo writes",
    });
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveFocus();

    await user.click(confirm);
    expect(onConfirmBatchUndo).toHaveBeenCalledOnce();
  });
});
