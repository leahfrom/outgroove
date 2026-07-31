// @vitest-environment jsdom
import { createRef } from "react";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  SyncRecoveryPreviewDto,
  SyncRecoverySummaryDto,
} from "../../shared/contracts/api";
import {
  SyncRecoveryWorkspace,
  type SyncRecoveryFeedback,
} from "./sync-recovery-workspace";

const rollbackRecovery: SyncRecoverySummaryDto = {
  runId: "a0be4702-0050-4fca-b6df-cbba6529b5f9",
  profileId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
  profileName: "Road DAP",
  targetPath: "/fixture/a/very/long/target/path",
  interruptedAt: "2026-07-22T10:00:00.000Z",
  phase: "copying",
  mode: "rollback",
};

const cleanupRecovery: SyncRecoverySummaryDto = {
  ...rollbackRecovery,
  runId: "d3a52a1d-f00b-46d8-ac01-e848675a2139",
  profileName: "Desk DAP",
  phase: "finalizing",
  mode: "committed-cleanup",
};

const preview: SyncRecoveryPreviewDto = {
  ...rollbackRecovery,
  actions: [
    {
      path: "/fixture/target/Artist/Album/01 Track.flac",
      action: "restore",
      explanation:
        "Restore the pre-sync replacement from its recorded rollback copy.",
    },
    {
      path: "/fixture/target/.outgroove/temporary/02 Track.flac",
      action: "remove",
      explanation: "Remove an incomplete Outgroove temporary file.",
    },
  ],
  warnings: [
    "/fixture/target/Artist/Album/03 Track.flac changed externally and will remain untouched.",
  ],
  canRecover: true,
  targetVolume: { status: "matched", confirmationRequired: false },
  confirmationToken: "sync-recovery-confirmation-token-long-enough",
};

function workspace({
  recoveries = [rollbackRecovery, cleanupRecovery],
  currentPreview,
  feedback,
  onReview = vi.fn(),
  onConfirm = vi.fn(),
  onClosePreview = vi.fn(),
  targetVolumeConfirmed = false,
  onTargetVolumeConfirmedChange = vi.fn(),
}: {
  recoveries?: readonly SyncRecoverySummaryDto[];
  currentPreview?: SyncRecoveryPreviewDto;
  feedback?: SyncRecoveryFeedback;
  onReview?: (recovery: SyncRecoverySummaryDto) => void;
  onConfirm?: (recovery: SyncRecoveryPreviewDto) => void;
  onClosePreview?: () => void;
  targetVolumeConfirmed?: boolean;
  onTargetVolumeConfirmedChange?: (confirmed: boolean) => void;
} = {}) {
  return (
    <SyncRecoveryWorkspace
      busy={false}
      feedback={feedback}
      feedbackHeadingRef={createRef<HTMLHeadingElement>()}
      preview={currentPreview}
      previewHeadingRef={createRef<HTMLHeadingElement>()}
      recoveries={recoveries}
      targetVolumeConfirmed={targetVolumeConfirmed}
      onClosePreview={onClosePreview}
      onConfirm={onConfirm}
      onDismissFeedback={vi.fn()}
      onReturn={vi.fn()}
      onReview={onReview}
      onTargetVolumeConfirmedChange={onTargetVolumeConfirmedChange}
    />
  );
}

describe("SyncRecoveryWorkspace", () => {
  it("distinguishes rollback and cleanup runs and opens review from the keyboard", async () => {
    const user = userEvent.setup();
    const onReview = vi.fn();
    render(workspace({ onReview }));

    const recoveries = screen.getByRole("list", {
      name: "Interrupted sync recoveries",
    });
    expect(
      screen.getByRole("heading", { name: "2 interrupted syncs" }),
    ).toBeVisible();
    expect(recoveries).toHaveTextContent("Restore previous state");
    expect(recoveries).toHaveTextContent("Remove temporary files");
    expect(recoveries).toHaveTextContent(
      "The sync finished successfully, but some temporary Outgroove files still need cleanup.",
    );
    expect(
      within(recoveries).getAllByText(
        (_content, element) =>
          element?.matches('time[datetime="2026-07-22T10:00:00.000Z"]') ??
          false,
      ),
    ).toHaveLength(2);

    const review = within(recoveries).getByRole("button", {
      name: "Review recovery for Road DAP",
    });
    review.focus();
    await user.keyboard("{Enter}");
    expect(onReview).toHaveBeenCalledWith(rollbackRecovery);
  });

  it("requires explicit volume confirmation before an uncertain recovery", async () => {
    const user = userEvent.setup();
    const onTargetVolumeConfirmedChange = vi.fn();
    const uncertainPreview: SyncRecoveryPreviewDto = {
      ...preview,
      targetVolume: { status: "changed", confirmationRequired: true },
    };
    const { rerender } = render(
      workspace({
        currentPreview: uncertainPreview,
        onTargetVolumeConfirmedChange,
      }),
    );
    const confirmation = screen.getByLabelText(
      "Interrupted sync storage confirmation",
    );
    const acknowledgement = within(confirmation).getByRole("checkbox", {
      name: "I confirm this is the storage used by the interrupted sync",
    });
    expect(
      screen.getByRole("button", {
        name: "Apply recovery for Road DAP",
      }),
    ).toBeDisabled();
    acknowledgement.focus();
    await user.keyboard(" ");
    expect(onTargetVolumeConfirmedChange).toHaveBeenCalledWith(true);

    rerender(
      workspace({
        currentPreview: uncertainPreview,
        targetVolumeConfirmed: true,
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "Apply recovery for Road DAP",
      }),
    ).not.toBeDisabled();
  });

  it("groups reviewed actions, preserves warnings, and confirms only explicitly", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onClosePreview = vi.fn();
    render(workspace({ currentPreview: preview, onClosePreview, onConfirm }));

    const confirmation = screen.getByLabelText(
      "Recovery confirmation for Road DAP",
    );
    expect(confirmation).toHaveTextContent("Files to restore1");
    expect(confirmation).toHaveTextContent("Files to remove1");
    expect(confirmation).toHaveTextContent("Things to review1");
    expect(
      within(confirmation).getByRole("heading", {
        name: "Restore earlier files",
      }),
    ).toBeVisible();
    expect(
      within(confirmation).getByRole("heading", {
        name: "Remove unfinished files",
      }),
    ).toBeVisible();
    const warning = within(confirmation).getByRole("alert");
    expect(warning).toHaveTextContent("will remain untouched");
    expect(onConfirm).not.toHaveBeenCalled();

    const close = within(confirmation).getByRole("button", {
      name: "Close recovery review",
    });
    close.focus();
    await user.keyboard("{Enter}");
    expect(onClosePreview).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    const confirm = within(confirmation).getByRole("button", {
      name: "Apply recovery for Road DAP",
    });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(onConfirm).toHaveBeenCalledWith(preview);
  });

  it("blocks unsafe recovery and presents complete, incomplete, and failed outcomes", () => {
    const blockedPreview = {
      ...preview,
      actions: [],
      canRecover: false,
      warnings: [
        "The DAP target is unavailable. Reconnect the same target and review recovery again.",
      ],
    };
    const { rerender } = render(workspace({ currentPreview: blockedPreview }));
    expect(screen.getByText("Can’t continue yet")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Apply recovery for Road DAP",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Reconnect the same target",
    );

    const outcomes: readonly SyncRecoveryFeedback[] = [
      {
        runId: rollbackRecovery.runId,
        profileName: "Road DAP",
        status: "complete",
        recovered: 2,
        messages: ["A fresh sync plan can now be generated."],
      },
      {
        runId: rollbackRecovery.runId,
        profileName: "Road DAP",
        status: "incomplete",
        recovered: 1,
        messages: ["Reconnect the target and review again."],
      },
      {
        runId: rollbackRecovery.runId,
        profileName: "Road DAP",
        status: "failed",
        recovered: 0,
        messages: ["The recovery preview changed."],
      },
    ];

    for (const feedback of outcomes) {
      rerender(workspace({ feedback, recoveries: [] }));
      const result = screen.getByLabelText("Recovery result for Road DAP");
      expect(result).toHaveTextContent(feedback.messages[0] ?? "");
      expect(
        within(result).getByText(feedback.messages[0] ?? ""),
      ).not.toBeVisible();
      expect(
        within(result).getByText("Recovery technical details"),
      ).toBeVisible();
      expect(result).toHaveAttribute(
        "role",
        feedback.status === "complete" ? "status" : "alert",
      );
    }
  });
});
