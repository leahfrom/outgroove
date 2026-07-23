// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import type { ScanJobDto } from "../../shared/contracts/api";
import { LibraryOnboarding } from "./library-onboarding";

const root = {
  id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
  path: "C:\\Fixture Music\\A very long folder\\音乐",
  lastScanAt: null,
};

function scanJob(
  state: ScanJobDto["state"],
  values: Partial<ScanJobDto> = {},
): ScanJobDto {
  return {
    id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
    rootId: root.id,
    state,
    completed: 0,
    total: 0,
    detail: "Waiting",
    result: null,
    error: null,
    createdAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
    finishedAt: null,
    ...values,
  };
}

const defaultProps = {
  busy: false,
  catalogLoaded: true,
  libraryRoots: [root],
  rootsLoaded: true,
  scanActive: false,
  scanJob: undefined,
  selectedRootId: root.id,
  setupError: undefined,
  onChooseFolder: vi.fn(),
  onOpenActivity: vi.fn(),
  onStartScan: vi.fn(),
};

it("announces the initial local loading state", () => {
  render(
    <LibraryOnboarding
      {...defaultProps}
      catalogLoaded={false}
      libraryRoots={[]}
      rootsLoaded={false}
      selectedRootId={undefined}
    />,
  );

  expect(
    screen.getByRole("main", { name: "Opening your Library…" }),
  ).toHaveAttribute("aria-busy", "true");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("presents interrupted scans as recoverable keyboard actions", async () => {
  const onStartScan = vi.fn();
  render(
    <LibraryOnboarding
      {...defaultProps}
      onStartScan={onStartScan}
      scanJob={scanJob("interrupted", {
        error: "Outgroove closed before this scan finished.",
      })}
    />,
  );
  const user = userEvent.setup();

  expect(screen.getByText(root.path)).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Outgroove closed before this scan finished.",
  );
  const retry = screen.getByRole("button", { name: "Retry first scan" });
  retry.focus();
  await user.keyboard("{Enter}");

  expect(onStartScan).toHaveBeenCalledWith(root.id);
});

it("explains an empty completed scan without implying that audio changed", () => {
  render(
    <LibraryOnboarding
      {...defaultProps}
      scanJob={scanJob("completed", {
        completed: 2,
        total: 2,
        detail: "Scan complete",
        result: { parsed: 0, unchanged: 0, errors: 2 },
        finishedAt: "2026-07-23T00:01:00.000Z",
      })}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "No supported music was found" }),
  ).toBeVisible();
  expect(
    screen.getByText("No metadata write or DAP sync starts from this scan."),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "View scan activity" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Choose another folder" }),
  ).toBeEnabled();
});
