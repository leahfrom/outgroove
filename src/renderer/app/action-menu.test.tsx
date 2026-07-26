// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActionMenu } from "./action-menu";

describe("ActionMenu", () => {
  it("keeps a pointer-anchored menu inside the visible viewport", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 0,
      height: 90,
      left: 0,
      right: 0,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 200,
    });

    render(
      <ActionMenu
        anchor={{ x: 290, y: 190, align: "start" }}
        ariaLabel="Fixture actions"
        items={[{ label: "Inspect", onSelect: vi.fn() }]}
        returnFocus={null}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("menu", { name: "Fixture actions" })).toHaveStyle({
      left: "92px",
      top: "100px",
    });
  });
});
