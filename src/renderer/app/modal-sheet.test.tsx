// @vitest-environment jsdom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ModalSheet } from "./modal-sheet";

function Harness(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open sheet</button>
      {open && (
        <ModalSheet
          ariaLabel="Fixture sheet"
          closeLabel="Close fixture sheet"
          onClose={() => setOpen(false)}
        >
          <button>First action</button>
          <button>Last action</button>
        </ModalSheet>
      )}
    </>
  );
}

describe("ModalSheet", () => {
  it("traps Tab focus, closes with Escape, and restores its opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open sheet" });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Fixture sheet" });
    const close = screen.getByRole("button", {
      name: "Close fixture sheet",
    });
    const first = screen.getByRole("button", { name: "First action" });
    const last = screen.getByRole("button", { name: "Last action" });
    expect(dialog).toHaveFocus();

    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
    await user.tab();
    expect(last).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
