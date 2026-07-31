// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ScanJobDto } from "../../shared/contracts/api";
import { ActivityView } from "./activity-view";

const callbacks = {
  onCancel: vi.fn(),
  onChooseFolder: vi.fn(),
  onOpenLibrary: vi.fn(),
  onOpenSync: vi.fn(),
  onReviewScanProblems: vi.fn(),
  onRetry: vi.fn(),
};

function scanJob(
  state: ScanJobDto["state"],
  overrides: Partial<ScanJobDto> = {},
): ScanJobDto {
  return {
    id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
    rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
    state,
    completed: 0,
    total: 0,
    detail: "Waiting to start",
    result: null,
    error: null,
    createdAt: "2026-07-24T00:00:00.000Z",
    updatedAt: "2026-07-24T00:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

describe("ActivityView", () => {
  it("offers keyboard routes to Library and Sync when no work has run", async () => {
    const user = userEvent.setup();
    render(
      <ActivityView
        {...callbacks}
        busy={false}
        progress={undefined}
        scanActive={false}
        scanJob={undefined}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No work is running" }),
    ).toBeVisible();
    const openSync = screen.getByRole("button", { name: "Open Sync" });
    openSync.focus();
    await user.keyboard("{Enter}");
    expect(callbacks.onOpenSync).toHaveBeenCalledOnce();
  });

  it("keeps active scan progress and cancellation together", async () => {
    const user = userEvent.setup();
    render(
      <ActivityView
        {...callbacks}
        busy={false}
        progress={undefined}
        scanActive
        scanJob={scanJob("running", {
          completed: 2,
          total: 5,
          detail: "Reading metadata: a very long nested fixture path.mp3",
        })}
      />,
    );

    const operation = screen.getByLabelText("Library scan activity");
    expect(
      within(operation).getByRole("progressbar", {
        name: "Reading audio metadata",
      }),
    ).toHaveAttribute("value", "2");
    const cancel = within(operation).getByRole("button", {
      name: "Cancel scan",
    });
    cancel.focus();
    await user.keyboard("{Enter}");
    expect(callbacks.onCancel).toHaveBeenCalledOnce();
  });

  it("shows a Radar sweep as active work across navigation", () => {
    render(
      <ActivityView
        {...callbacks}
        busy={false}
        progress={{
          job: "radar",
          completed: 2,
          total: 5,
          detail: "Refreshing Radar for Fixture Artist",
        }}
        scanActive={false}
        scanJob={undefined}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Checking Radar" }),
    ).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Checking Radar progress" }),
    ).toHaveAttribute("value", "2");
    expect(screen.getByLabelText("Activity overview")).toHaveTextContent(
      "Active1",
    );
  });

  it("gives a failed scan recovery priority without hiding its error", () => {
    render(
      <ActivityView
        {...callbacks}
        busy={false}
        progress={undefined}
        scanActive={false}
        scanJob={scanJob("failed", {
          detail: "Scan failed",
          error: "The selected folder is no longer available.",
          finishedAt: "2026-07-24T00:01:00.000Z",
        })}
      />,
    );

    expect(screen.getByLabelText("Activity overview")).toHaveTextContent(
      "Needs attentionYes",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The selected folder is no longer available.",
    );
    expect(
      screen.getByRole("heading", { name: "Scan couldn’t finish" }),
    ).toBeVisible();
    expect(
      screen.getByText(/existing Library is still available/iu),
    ).toHaveTextContent(
      "Reconnect the folder if needed, then try the scan again",
    );
    expect(screen.getByRole("button", { name: "Retry scan" })).toBeEnabled();
  });

  it("explains partial scan results without implying the whole scan failed", () => {
    render(
      <ActivityView
        {...callbacks}
        busy={false}
        progress={undefined}
        scanActive={false}
        scanJob={scanJob("completed", {
          completed: 4,
          total: 4,
          detail: "Scan complete",
          result: { parsed: 2, unchanged: 1, errors: 1 },
          finishedAt: "2026-07-24T00:01:00.000Z",
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Scan complete" }),
    ).toBeVisible();
    expect(screen.getByText(/kept every readable file/iu)).toBeVisible();
    expect(
      screen.getByText("Added or refreshed").nextSibling,
    ).toHaveTextContent("2");
    expect(screen.getByText("Couldn’t read").nextSibling).toHaveTextContent(
      "1",
    );
  });
});
