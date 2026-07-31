// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LibraryAlbumEditingNavigation } from "./library-album-editing-navigation";

describe("LibraryAlbumEditingNavigation", () => {
  it("keeps every contextual tool description and supports keyboard activation", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <LibraryAlbumEditingNavigation activeTool="shared" onSelect={onSelect} />,
    );

    const sharedFields = screen.getByRole("button", {
      name: "Shared fields. Choose tracks and compare shared tag values.",
    });
    expect(sharedFields).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByText("Review explicit track and disc numbering."),
    ).toBeVisible();
    expect(
      screen.getByText("Review a past change before restoring earlier values."),
    ).toBeVisible();

    const trackOrder = screen.getByRole("button", {
      name: "Track order. Review explicit track and disc numbering.",
    });
    trackOrder.focus();
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("sequence");
  });
});
