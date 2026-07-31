// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { TechnicalDetails } from "./technical-details";

it("keeps exact technical messages behind a keyboard-reachable disclosure", async () => {
  const user = userEvent.setup();
  const longPath =
    "C:\\Music\\A very long artist name\\A very long album name\\01 Track.flac: EBUSY";
  render(<TechnicalDetails messages={[longPath, longPath, "  "]} />);

  const summary = screen.getByText("Technical details");
  const details = summary.closest("details");
  if (!details) throw new Error("Technical details disclosure missing");

  expect(details).not.toHaveAttribute("open");
  expect(screen.getByText(longPath)).not.toBeVisible();
  expect(screen.getAllByText(longPath)).toHaveLength(1);

  summary.focus();
  expect(summary).toHaveFocus();
  await user.click(summary);

  expect(details).toHaveAttribute("open");
  expect(screen.getByText(longPath)).toBeVisible();
});

it("renders nothing when no useful detail is available", () => {
  const { container } = render(<TechnicalDetails messages={["", "  "]} />);
  expect(container).toBeEmptyDOMElement();
});
