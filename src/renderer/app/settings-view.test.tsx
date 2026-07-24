// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DatabaseRestorePreviewDto,
  LibraryRootRemovalPreviewDto,
} from "../../shared/contracts/api";
import { SettingsView } from "./settings-view";

const callbacks = {
  onAddLibraryFolder: vi.fn(),
  onCancelRestore: vi.fn(),
  onCancelRootRemoval: vi.fn(),
  onConfirmRestore: vi.fn(),
  onConfirmRootRemoval: vi.fn(),
  onCreateBackup: vi.fn(),
  onPreviewRootRemoval: vi.fn(),
  onRestoreBackup: vi.fn(),
  onScanRoot: vi.fn(),
  onSelectSection: vi.fn(),
};

const longPath =
  "/fixture/a very long folder name/with nested metadata/音乐 collection";

const rootRemovalPreview: LibraryRootRemovalPreviewDto = {
  operationId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
  confirmationToken: "root-removal-confirmation-token",
  rootId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
  path: longPath,
  visibleTracks: 12,
  albumsHidden: 2,
  scanProblemsHidden: 1,
};

const restorePreview: DatabaseRestorePreviewDto = {
  operationId: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
  confirmationToken: "database-confirmation-token-long-enough",
  sourceName: "outgroove-backup.sqlite3",
  schemaVersion: 17,
  summary: {
    libraryRoots: 2,
    albums: 30,
    tracks: 300,
    syncProfiles: 1,
    savedLibraryFilters: 2,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SettingsView", () => {
  it("keeps long folder paths in context while exposing concise keyboard actions", async () => {
    const user = userEvent.setup();
    render(
      <SettingsView
        {...callbacks}
        activeSection="library-folders"
        busy={false}
        libraryRoots={[
          {
            id: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
            path: longPath,
            lastScanAt: null,
          },
        ]}
        restorePreview={undefined}
        rootId="6fdf7677-0e73-4f9a-85fd-6612ef381bdf"
        rootRemovalPreview={undefined}
        scanActive={false}
        scanJob={undefined}
      />,
    );

    const roots = screen.getByRole("list", {
      name: "Watched Library folders",
    });
    expect(within(roots).getByText(longPath)).toBeVisible();
    const scan = within(roots).getByRole("button", {
      name: `Scan folder ${longPath}`,
    });
    expect(scan).toHaveTextContent("Scan folder");
    scan.focus();
    await user.keyboard("{Enter}");
    expect(callbacks.onScanRoot).toHaveBeenCalledWith(
      "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
    );
  });

  it("focuses the stop-watching review without changing files", () => {
    render(
      <SettingsView
        {...callbacks}
        activeSection="library-folders"
        busy={false}
        libraryRoots={[]}
        restorePreview={undefined}
        rootId={undefined}
        rootRemovalPreview={rootRemovalPreview}
        scanActive={false}
        scanJob={undefined}
      />,
    );

    const preview = screen.getByLabelText("Library folder removal preview");
    expect(
      within(preview).getByRole("heading", {
        name: "Stop watching this folder?",
      }),
    ).toHaveFocus();
    expect(preview).toHaveTextContent("No audio or DAP files will be deleted");
    expect(callbacks.onConfirmRootRemoval).not.toHaveBeenCalled();
  });

  it("separates safe backup export from a focused restore confirmation", async () => {
    const user = userEvent.setup();
    render(
      <SettingsView
        {...callbacks}
        activeSection="database"
        busy={false}
        libraryRoots={[]}
        restorePreview={restorePreview}
        rootId={undefined}
        rootRemovalPreview={undefined}
        scanActive={false}
        scanJob={undefined}
      />,
    );

    const preview = screen.getByLabelText("Database restore confirmation");
    expect(
      within(preview).getByRole("heading", {
        name: "Replace the current Outgroove database?",
      }),
    ).toHaveFocus();
    expect(preview).toHaveTextContent(
      "An automatic rollback backup is created and verified first",
    );
    const keepCurrent = within(preview).getByRole("button", {
      name: "Keep current database",
    });
    keepCurrent.focus();
    await user.keyboard("{Enter}");
    expect(callbacks.onCancelRestore).toHaveBeenCalledOnce();
  });
});
