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
  unchanged: [
    {
      sourceFileId: "file-2",
      sourcePath: "/fixture/source/Album/Existing.flac",
      relativeDestination: "Artist/Album/01-02 Existing.flac",
      size: 1024,
      signature: "1024:1",
    },
  ],
  conflicts: [],
  errors: [],
  requiredBytes: 2048,
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
  onPreview = vi.fn(),
  onApply = vi.fn(),
  onCancel = vi.fn(),
}: {
  currentPlan?: SyncPlanDto;
  currentHistory?: readonly SyncHistoryItemDto[];
  applyingPlanId?: string;
  cancellationRequested?: boolean;
  onPreview?: () => void;
  onApply?: () => void;
  onCancel?: () => void;
} = {}) {
  return (
    <SyncPlanReview
      applyingPlanId={applyingPlanId}
      busy={false}
      cancellationRequested={cancellationRequested}
      editingProfile={false}
      history={currentHistory}
      historyLoading={false}
      historyProfileId={profile.id}
      plan={currentPlan}
      planHeadingRef={createRef<HTMLHeadingElement>()}
      profile={profile}
      onApply={onApply}
      onCancel={onCancel}
      onManage={vi.fn()}
      onPreview={onPreview}
    />
  );
}

describe("SyncPlanReview", () => {
  it("keeps preview and history progressive disclosure keyboard accessible", async () => {
    const user = userEvent.setup();
    const onPreview = vi.fn();
    render(review({ onPreview }));

    expect(screen.getByLabelText("No sync plan")).toHaveTextContent(
      "does not copy, replace, or delete anything",
    );
    const preview = screen.getByRole("button", { name: "Preview sync plan" });
    preview.focus();
    await user.keyboard("{Enter}");
    expect(onPreview).toHaveBeenCalledTimes(1);

    const historyLabel = screen.getByText("Successful sync history");
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
        name: "Successful sync history for Road DAP",
      }),
    ).toHaveTextContent("/fixture/a/previous/target");
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
    expect(summary).toHaveTextContent("Unchanged1");
    expect(summary).toHaveTextContent("Issues0");
    expect(summary).toHaveTextContent("2.00 KiB");
    expect(confirmation).toHaveTextContent("Source audio stays untouched");
    expect(confirmation).toHaveTextContent("commits the new manifest last");

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
      name: "Confirm and apply copy plan",
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
        name: "Confirm and apply copy plan",
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
});
