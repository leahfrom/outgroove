// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ApplicationShell } from "./application-shell";

describe("ApplicationShell packaged inspection marker", () => {
  it("describes each destination in plain, task-focused language", () => {
    render(
      <ApplicationShell
        activeView="radar"
        notice={undefined}
        onDismissNotice={vi.fn()}
        onNavigate={vi.fn()}
      >
        <p>Radar workspace</p>
      </ApplicationShell>,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Primary navigation",
    });
    expect(navigation).toHaveTextContent(
      "Browse, search, and explore your music collection.",
    );
    expect(navigation).toHaveTextContent(
      "Keep up with new releases from artists you follow.",
    );
    expect(navigation).toHaveTextContent(
      "Choose music, preview changes, and copy it to your player.",
    );
    expect(navigation).not.toHaveTextContent(
      /exact artist identities|folder-backed|long-running work/iu,
    );
  });

  it("prominently identifies disposable inspection state", () => {
    render(
      <ApplicationShell
        activeView="library"
        inspectionSessionId="123e4567-e89b-42d3-a456-426614174000"
        notice={undefined}
        onDismissNotice={vi.fn()}
        onNavigate={vi.fn()}
      >
        <p>Fixture workspace</p>
      </ApplicationShell>,
    );

    const marker = screen.getByRole("status", {
      name: "Isolated packaged inspection profile",
    });
    expect(marker).toHaveTextContent("Isolated inspection profile");
    expect(
      within(marker).getByText("Disposable fixture data only"),
    ).toBeVisible();
    expect(
      within(marker).getByText((_content, element) =>
        Boolean(element?.matches(".inspection-banner-session")),
      ),
    ).toHaveTextContent("Session 123e4567");
  });

  it("does not label an ordinary production shell", () => {
    render(
      <ApplicationShell
        activeView="library"
        notice={undefined}
        onDismissNotice={vi.fn()}
        onNavigate={vi.fn()}
      >
        <p>Production workspace</p>
      </ApplicationShell>,
    );

    expect(
      screen.queryByRole("status", {
        name: "Isolated packaged inspection profile",
      }),
    ).not.toBeInTheDocument();
  });

  it("keeps navigation keyboard-operable beside the marker", async () => {
    const onNavigate = vi.fn();
    render(
      <ApplicationShell
        activeView="library"
        inspectionSessionId="123e4567-e89b-42d3-a456-426614174000"
        notice={undefined}
        onDismissNotice={vi.fn()}
        onNavigate={onNavigate}
      >
        <p>Fixture workspace</p>
      </ApplicationShell>,
    );

    const sync = screen.getByRole("button", { name: "Sync" });
    sync.focus();
    await userEvent.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledWith("sync");
  });
});
