// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { RadarItemDto } from "../../shared/contracts/api";
import { RadarReleases } from "./radar-releases";

const item: RadarItemDto = {
  id: "4f2f7939-d847-47e0-a08e-ae47ac0727b2",
  favoriteArtistId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
  favoriteArtistName: "Fixture Artist",
  musicBrainzReleaseGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  representativeReleaseId: "11111111-1111-4111-8111-111111111111",
  title: "A deliberately long future fixture release title",
  primaryType: "Album",
  secondaryTypes: ["Compilation"],
  firstReleaseDate: "2027-03",
  status: "Official",
  country: "DE",
  firstSeenAt: "2026-07-28T09:00:00.000Z",
  lastSeenAt: "2026-07-28T09:00:00.000Z",
  seenAt: null,
  dismissedAt: null,
  reasons: ["upcoming", "newly-found"],
};

function renderReleases(
  overrides: Partial<React.ComponentProps<typeof RadarReleases>> = {},
): void {
  render(
    <RadarReleases
      actionBusyId={undefined}
      error={undefined}
      includeDismissed={false}
      items={[item]}
      limit={20}
      loading={false}
      offset={0}
      primaryType="all"
      refreshResult={undefined}
      totalItems={21}
      view="all"
      onDismissed={vi.fn()}
      onIncludeDismissedChange={vi.fn()}
      onOpen={vi.fn()}
      onPage={vi.fn()}
      onPrimaryTypeChange={vi.fn()}
      onSeen={vi.fn()}
      onViewChange={vi.fn()}
      {...overrides}
    />,
  );
}

describe("Radar releases", () => {
  it("labels provider facts and first-seen state separately and routes keyboard actions", async () => {
    const onSeen = vi.fn();
    const onDismissed = vi.fn();
    const onOpen = vi.fn();
    renderReleases({ onSeen, onDismissed, onOpen });
    const list = screen.getByRole("list", {
      name: "All current Radar releases",
    });
    expect(within(list).getByText("Upcoming")).toBeVisible();
    expect(within(list).getByText("Newly found in MusicBrainz")).toBeVisible();
    expect(
      within(list).getByText(item.musicBrainzReleaseGroupId),
    ).toBeVisible();
    const user = userEvent.setup();
    const seen = within(list).getByRole("button", { name: "Mark seen" });
    seen.focus();
    await user.keyboard("{Enter}");
    expect(onSeen).toHaveBeenCalledWith(item, true);
    const dismiss = within(list).getByRole("button", {
      name: "Dismiss item",
    });
    dismiss.focus();
    await user.keyboard("{Enter}");
    expect(onDismissed).toHaveBeenCalledWith(item, true);
    const open = within(list).getByRole("button", {
      name: `Open ${item.title} in MusicBrainz`,
    });
    open.focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(item);
  });

  it("changes views, restores dismissed items, and pages without inferring releases", async () => {
    const onViewChange = vi.fn();
    const onIncludeDismissedChange = vi.fn();
    const onPrimaryTypeChange = vi.fn();
    const onPage = vi.fn();
    renderReleases({
      items: [{ ...item, dismissedAt: "2026-07-29T00:00:00.000Z" }],
      includeDismissed: true,
      onViewChange,
      onIncludeDismissedChange,
      onPrimaryTypeChange,
      onPage,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Newly found" }));
    expect(onViewChange).toHaveBeenCalledWith("newly-found");
    await user.click(screen.getByRole("checkbox", { name: "Show dismissed" }));
    expect(onIncludeDismissedChange).toHaveBeenCalledWith(false);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Release type" }),
      "single",
    );
    expect(onPrimaryTypeChange).toHaveBeenCalledWith("single");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(20);
    expect(screen.getByRole("button", { name: "Restore item" })).toBeVisible();
  });

  it("keeps the last successful view visible beside a refresh failure", () => {
    renderReleases({
      error:
        "MusicBrainz is unavailable. Outgroove kept the last successful Radar view unchanged.",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "last successful Radar view unchanged",
    );
    expect(screen.getByText(item.title)).toBeVisible();
  });
});
