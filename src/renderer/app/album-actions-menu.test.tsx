// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AlbumActionsMenu } from "./album-actions-menu";

describe("AlbumActionsMenu", () => {
  it("keeps album workflows in one keyboard-operable contextual menu", async () => {
    const user = userEvent.setup();
    const onEditMetadata = vi.fn();
    const onEditTrackOrder = vi.fn();
    const onEditArtwork = vi.fn();
    const onFindMatches = vi.fn();
    const onOpenHistory = vi.fn();
    const onAddToSync = vi.fn();
    render(
      <AlbumActionsMenu
        albumTitle="A very long album title that remains contextual"
        busy={false}
        syncDisabled={false}
        onAddToSync={onAddToSync}
        onEditMetadata={onEditMetadata}
        onEditArtwork={onEditArtwork}
        onFindMatches={onFindMatches}
        onEditTrackOrder={onEditTrackOrder}
        onOpenHistory={onOpenHistory}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Album actions" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("menu", {
        name: "Actions for A very long album title that remains contextual",
      }),
    ).toBeVisible();
    const findMatches = screen.getByRole("menuitem", {
      name: "Find album details",
    });
    expect(findMatches).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onFindMatches).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{Enter}");
    expect(onOpenHistory).toHaveBeenCalledOnce();
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("keeps a full Sync selection visibly unavailable", async () => {
    const user = userEvent.setup();
    render(
      <AlbumActionsMenu
        albumTitle="Fixture Album"
        busy={false}
        syncDisabled
        onAddToSync={vi.fn()}
        onEditMetadata={vi.fn()}
        onEditArtwork={vi.fn()}
        onFindMatches={vi.fn()}
        onEditTrackOrder={vi.fn()}
        onOpenHistory={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Album actions" }));
    expect(
      screen.getByRole("menuitem", {
        name: "Add Fixture Album to Sync",
      }),
    ).toBeDisabled();
  });
});
