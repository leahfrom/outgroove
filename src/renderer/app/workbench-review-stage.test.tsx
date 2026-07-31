// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import {
  WorkbenchConfirmation,
  WorkbenchDraftHeading,
  WorkbenchRequestError,
  WorkbenchWriteResult,
} from "./workbench-review-stage";

it("identifies a draft as safe before any preview exists", () => {
  render(
    <WorkbenchDraftHeading
      context="Draft"
      description="Choose only the fields you intend to change."
      title="Edit shared metadata"
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Edit shared metadata" }),
  ).toBeVisible();
  expect(screen.getByText("Source files unchanged")).toBeVisible();
  expect(screen.getByText("Preview required")).toBeVisible();
});

it("moves focus to an available confirmation action and supports the keyboard", async () => {
  const onConfirm = vi.fn();
  render(
    <WorkbenchConfirmation
      blocked={false}
      busy={false}
      cancelLabel="Return to draft"
      confirmLabel="Confirm safe writes"
      description="Review every exact change."
      label="Metadata confirmation"
      title="Review selected files"
      onCancel={vi.fn()}
      onConfirm={onConfirm}
    >
      <p>Two files will change.</p>
    </WorkbenchConfirmation>,
  );
  const user = userEvent.setup();
  const confirm = screen.getByRole("button", { name: "Confirm safe writes" });

  expect(confirm).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(onConfirm).toHaveBeenCalledOnce();
});

it("focuses and explains a blocked confirmation without enabling writes", () => {
  render(
    <WorkbenchConfirmation
      blocked
      busy={false}
      cancelLabel="Return to draft"
      confirmLabel="Confirm safe writes"
      description="Review every exact change."
      label="Blocked metadata confirmation"
      title="Review selected files"
      onCancel={vi.fn()}
      onConfirm={vi.fn()}
    >
      <p role="alert">A selected file changed after preview.</p>
    </WorkbenchConfirmation>,
  );

  const confirmation = screen.getByLabelText("Blocked metadata confirmation");
  expect(confirmation).toHaveFocus();
  expect(
    screen.getByRole("button", { name: "Confirm safe writes" }),
  ).toBeDisabled();
  expect(screen.getAllByRole("alert")).toHaveLength(2);
  expect(
    screen.getByText("These changes can’t be confirmed yet."),
  ).toBeVisible();
});

it("focuses a recoverable request error and keeps the next action in keyboard order", async () => {
  const user = userEvent.setup();
  render(
    <>
      <WorkbenchRequestError
        label="Shared metadata request error"
        message="The selected file changed after preview."
        recovery="Review the draft or retry this confirmation."
      />
      <button>Retry confirmation</button>
    </>,
  );

  const error = screen.getByRole("alert", {
    name: "Shared metadata request error",
  });
  expect(error).toHaveFocus();
  expect(error).toHaveTextContent("The selected file changed after preview.");
  expect(error).toHaveTextContent(
    "Review the draft or retry this confirmation.",
  );

  await user.tab();
  expect(
    screen.getByRole("button", { name: "Retry confirmation" }),
  ).toHaveFocus();
});

it("moves focus to results and distinguishes verified and failed files", () => {
  render(
    <WorkbenchWriteResult
      label="Batch result"
      subject="Shared-field write"
      results={[
        {
          fileId: "first",
          path: "C:\\Music\\First.mp3",
          verified: true,
          error: null,
        },
        {
          fileId: "second",
          path: "/Music/Second.flac",
          verified: false,
          error: "The file changed after preview.",
        },
      ]}
    />,
  );

  const result = screen.getByRole("alert", { name: "Batch result" });
  expect(result).toHaveFocus();
  expect(result).toHaveTextContent("1 confirmed; 1 couldn’t be confirmed");
  expect(result).toHaveTextContent("C:\\Music\\First.mp3");
  expect(result).toHaveTextContent("The file changed after preview.");
});
