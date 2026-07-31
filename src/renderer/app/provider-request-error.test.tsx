// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import { ProviderRequestError } from "./provider-request-error";

it("leads with recovery and keeps exact provider diagnostics keyboard-accessible", async () => {
  const user = userEvent.setup();
  render(
    <ProviderRequestError
      details={["HTTP 503 from https://provider.invalid/release/fixture"]}
      guidance="Saved results remain available. Try again later."
      label="Fixture provider error"
      title="The online check couldn’t finish."
    />,
  );

  const alert = screen.getByRole("alert", { name: "Fixture provider error" });
  expect(alert).toHaveTextContent("The online check couldn’t finish.");
  expect(alert).toHaveTextContent("Saved results remain available.");

  const summary = screen.getByText("Technical details");
  const details = summary.closest("details");
  if (!details) throw new Error("Technical details disclosure missing");
  expect(details).not.toHaveAttribute("open");
  expect(screen.getByText(/HTTP 503/u)).not.toBeVisible();

  summary.focus();
  expect(summary).toHaveFocus();
  await user.click(summary);
  expect(details).toHaveAttribute("open");
  expect(screen.getByText(/HTTP 503/u)).toBeVisible();
});
