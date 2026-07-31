// @vitest-environment jsdom
import { createRef } from "react";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  SyncHistoryItemDto,
  SyncPlanDto,
} from "../../shared/contracts/api";
import { SyncPlanReview } from "./sync-plan-review";

const profile = {
  id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
  name: "Road DAP",
  targetPath: "/fixture/a/very/long/target/path",
  albumIds: ["album-1", "album-2"],
};

const plan: SyncPlanDto = {
  id: "853a8e28-560a-4261-b152-1fe31c26dc42",
  profileId: profile.id,
  targetPath: profile.targetPath,
  confirmationToken: "sync-confirmation-token-long-enough",
  cleanupEnabled: false,
  previousManifestHash: null,
  targetIdentity: "1:2",
  targetVolume: { status: "matched", confirmationRequired: false },
  copies: [
    {
      sourceFileId: "file-1",
      sourcePath: "/fixture/source/Album/Track.flac",
      relativeDestination:
        "Artist/A very long album title/01-01 A very long track title.flac",
      size: 2048,
      signature: "2048:1",
    },
  ],
  replacements: [],
  unchanged: [
    {
      sourceFileId: "file-2",
      sourcePath: "/fixture/source/Album/Existing.flac",
      relativeDestination: "Artist/Album/01-02 Existing.flac",
      size: 1024,
      signature: "1024:1",
    },
  ],
  removals: [],
  absentOwned: [],
  conflicts: [],
  errors: [],
  requiredBytes: 2048,
  hasChanges: true,
};

const history: readonly SyncHistoryItemDto[] = [
  {
    id: "b1a3e2cd-2d58-4b53-a414-07d34b7da3a7",
    profileId: profile.id,
    targetPath: "/fixture/a/previous/target",
    completedAt: "2026-07-22T10:00:00.000Z",
    entryCount: 2,
  },
];

function review({
  currentPlan,
  currentHistory = history,
  applyingPlanId,
  cancellationRequested = false,
  targetVolumeConfirmed = false,
  onPreview = vi.fn(),
  onApply = vi.fn(),
  onCancel = vi.fn(),
  onCleanupEnabledChange = vi.fn(),
  onTargetVolumeConfirmedChange = vi.fn(),
}: {
  currentPlan?: SyncPlanDto;
  currentHistory?: readonly SyncHistoryItemDto[];
  applyingPlanId?: string;
  cancellationRequested?: boolean;
  targetVolumeConfirmed?: boolean;
  onPreview?: () => void;
  onApply?: () => void;
  onCancel?: () => void;
  onCleanupEnabledChange?: (enabled: boolean) => void;
  onTargetVolumeConfirmedChange?: (confirmed: boolean) => void;
} = {}) {
  return (
    <SyncPlanReview
      applyingPlanId={applyingPlanId}
      busy={false}
      cancellationRequested={cancellationRequested}
      cleanupEnabled={currentPlan?.cleanupEnabled ?? false}
      targetVolumeConfirmed={targetVolumeConfirmed}
      editingProfile={false}
      history={currentHistory}
      historyLoading={false}
      historyProfileId={profile.id}
      plan={currentPlan}
      planHeadingRef={createRef<HTMLHeadingElement>()}
      profile={profile}
      onApply={onApply}
      onCancel={onCancel}
      onCleanupEnabledChange={onCleanupEnabledChange}
      onManage={vi.fn()}
      onPreview={onPreview}
      onTargetVolumeConfirmedChange={onTargetVolumeConfirmedChange}
    />
  );
}

describe("SyncPlanReview", () => {
  it("keeps preview and history progressive disclosure keyboard accessible", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    render(review({ onPreview }));

    expect(screen.getByLabelText("No sync plan")).toHaveTextContent(
      "does not copy, replace, or remove anything",
    );
    const preview = screen.getByRole("button", { name: "Preview sync plan" });
    preview.focus();
    await user.keyboard("{Enter}");
    expect(onPreview).toHaveBeenCalledTimes(1);

    const historyLabel = screen.getByText("Completed syncs");
    const historySummary = historyLabel.closest("summary");
    const historyDetails = historyLabel.closest("details");
    if (!historySummary || !historyDetails)
      throw new Error("Sync history disclosure missing");
    expect(historyDetails).not.toHaveAttribute("open");
    historySummary.focus();
    expect(historySummary).toHaveFocus();
    await user.click(historySummary);
    expect(historyDetails).toHaveAttribute("open");
    expect(
      screen.getByRole("list", {
        name: "Completed sync history for Road DAP",
      }),
    ).toHaveTextContent("/fixture/a/previous/target");
    expect(historyDetails).toHaveTextContent(
      "final record of synced files was saved successfully",
    );
  });

  it("summarizes a valid plan before disclosing exact paths and confirming", async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(review({ currentPlan: plan, onApply }));

    const confirmation = screen.getByLabelText("Sync confirmation");
    expect(
      within(confirmation).getByRole("heading", {
        name: "Current sync plan",
      }),
    ).toBeVisible();
    const summary = within(confirmation).getByLabelText("Sync plan summary");
    expect(summary).toHaveTextContent("Copies1");
    expect(summary).toHaveTextContent("Skipped (unchanged)1");
    expect(summary).toHaveTextContent("Issues0");
    expect(summary).toHaveTextContent("2.00 KiB");
    expect(confirmation).toHaveTextContent("Source audio stays untouched");
    expect(confirmation).toHaveTextContent(
      "saves its new synced-file record only after everything succeeds",
    );

    const copyLabel = within(confirmation).getByText("Files to copy");
    const copySummary = copyLabel.closest("summary");
    const copyDetails = copyLabel.closest("details");
    if (!copySummary || !copyDetails)
      throw new Error("Copy disclosure missing");
    expect(copyDetails).not.toHaveAttribute("open");
    copySummary.focus();
    expect(copySummary).toHaveFocus();
    await user.click(copySummary);
    expect(copyDetails).toHaveAttribute("open");
    expect(copyDetails).toHaveTextContent(
      "Artist/A very long album title/01-01 A very long track title.flac",
    );

    const apply = within(confirmation).getByRole("button", {
      name: "Confirm and apply sync plan",
    });
    apply.focus();
    await user.keyboard("{Enter}");
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("exposes blockers, disables apply, and keeps cancellation feedback local", () => {
    const blockedPlan = {
      ...plan,
      conflicts: ["Artist/Album/01-01 Track.flac conflicts by case."],
      errors: ["The target has insufficient free space."],
    };
    const { rerender } = render(review({ currentPlan: blockedPlan }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This plan cannot be applied yet.",
    );
    expect(
      screen.getByRole("button", {
        name: "Confirm and apply sync plan",
      }),
    ).toBeDisabled();
    const conflicts = screen.getByText("Conflicts").closest("details");
    const errors = screen.getByText("Errors").closest("details");
    expect(conflicts).toHaveAttribute("open");
    expect(errors).toHaveAttribute("open");

    const onCancel = vi.fn();
    rerender(
      review({
        applyingPlanId: plan.id,
        cancellationRequested: true,
        currentPlan: plan,
        onCancel,
      }),
    );
    expect(screen.getByText("Status: Cancelling safely")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Cancel active sync" }),
    ).toBeDisabled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("requires a separate keyboard-accessible confirmation when volume evidence is uncertain", async () => {
    const user = userEvent.setup();
    const onTargetVolumeConfirmedChange = vi.fn();
    const uncertainPlan: SyncPlanDto = {
      ...plan,
      targetVolume: {
        status: "changed",
        confirmationRequired: true,
      },
    };
    const { rerender } = render(
      review({
        currentPlan: uncertainPlan,
        onTargetVolumeConfirmedChange,
      }),
    );
    const volumeConfirmation = screen.getByLabelText(
      "DAP volume identity confirmation",
    );
    expect(volumeConfirmation).toHaveTextContent(
      "does not match the identity saved for this profile",
    );
    const acknowledgement = within(volumeConfirmation).getByRole("checkbox", {
      name: "I confirm this is the intended DAP volume for this plan",
    });
    const apply = screen.getByRole("button", {
      name: "Confirm and apply sync plan",
    });
    expect(apply).toBeDisabled();
    acknowledgement.focus();
    await user.keyboard(" ");
    expect(onTargetVolumeConfirmedChange).toHaveBeenCalledWith(true);

    rerender(
      review({
        currentPlan: uncertainPlan,
        targetVolumeConfirmed: true,
      }),
    );
    expect(
      screen.getByRole("button", {
        name: "Confirm and apply sync plan",
      }),
    ).not.toBeDisabled();
  });

  it("keeps cleanup off by default and shows every exact removal before confirmation", async () => {
    const user = userEvent.setup();
    const onCleanupEnabledChange = vi.fn();
    const onApply = vi.fn();
    const firstCopy = plan.copies[0];
    if (!firstCopy) throw new Error("Copy fixture missing.");
    const removalPlan: SyncPlanDto = {
      ...plan,
      cleanupEnabled: true,
      replacements: [
        {
          ...firstCopy,
          relativeDestination:
            "Artist/A very long album title/01-02 Replacement.flac",
          expectedTargetHash: "a".repeat(64),
        },
      ],
      removals: [
        {
          relativeDestination:
            "Artist/A very long obsolete album/01-01 Obsolete track.flac",
          size: 4096,
          expectedTargetHash: "b".repeat(64),
        },
      ],
    };
    const { rerender } = render(review({ onCleanupEnabledChange }));
    const cleanup = screen.getByRole("checkbox", {
      name: /Remove obsolete files from earlier Outgroove syncs/u,
    });
    expect(cleanup).not.toBeChecked();
    cleanup.focus();
    await user.keyboard(" ");
    expect(onCleanupEnabledChange).toHaveBeenCalledWith(true);

    rerender(review({ currentPlan: removalPlan, onApply }));
    const confirmation = screen.getByLabelText("Sync confirmation");
    expect(confirmation).toHaveTextContent("Copies1");
    expect(confirmation).toHaveTextContent("Replacements1");
    expect(confirmation).toHaveTextContent("Skipped (unchanged)1");
    expect(confirmation).toHaveTextContent("Removals1");
    const removalDisclosure = within(confirmation)
      .getByText("Previously synced files to remove")
      .closest("details");
    expect(removalDisclosure).toHaveAttribute("open");
    expect(removalDisclosure).toHaveTextContent(
      "Artist/A very long obsolete album/01-01 Obsolete track.flac",
    );
    expect(confirmation).toHaveTextContent(
      "Unknown target files are never removed.",
    );
    const apply = within(confirmation).getByRole("button", {
      name: "Confirm and apply plan with 1 removal",
    });
    apply.focus();
    await user.keyboard("{Enter}");
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("does not expose confirmation or apply for a no-op plan", () => {
    render(
      review({
        currentPlan: {
          ...plan,
          copies: [],
          unchanged: [...plan.copies, ...plan.unchanged],
          requiredBytes: 0,
          hasChanges: false,
        },
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "No target changes are needed.",
    );
    expect(
      screen.queryByRole("heading", { name: "Apply this plan?" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Confirm and apply/u }),
    ).not.toBeInTheDocument();
  });
});
