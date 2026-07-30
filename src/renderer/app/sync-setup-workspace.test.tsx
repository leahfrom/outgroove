// @vitest-environment jsdom
import { createRef, useState } from "react";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  SyncProfileDto,
  SyncProfileRemovalPreviewDto,
  SyncProfileTargetPreviewDto,
} from "../../shared/contracts/api";
import {
  SyncSetupWorkspace,
  type SyncSetupSection,
} from "./sync-setup-workspace";

const firstAlbum = {
  id: "3d5640e5-d3fd-4779-bfb4-1ac85a2aa360",
  title: "Fixture Album",
  albumArtist: "Fixture Artist",
};
const secondAlbum = {
  id: "86fb71a8-9faf-49f9-ad60-39e5bb28c02d",
  title: "Second Album",
  albumArtist: "Other Artist",
};
const profile: SyncProfileDto = {
  id: "853a8e28-560a-4261-b152-1fe31c26dc42",
  name: "Road DAP",
  targetPath:
    "/fixture/a/very/long/target/path/that/needs/to/wrap/on/narrow/windows",
  albumIds: [firstAlbum.id],
  albums: [firstAlbum],
  createdAt: "2026-07-22T10:00:00.000Z",
};
const targetPreview: SyncProfileTargetPreviewDto = {
  operationId: "31e37f6f-738f-4888-91d3-63d74fc17680",
  confirmationToken: "sync-target-confirmation-token-long-enough",
  profileId: profile.id,
  profileName: profile.name,
  currentTargetPath: profile.targetPath,
  proposedTargetPath:
    "/fixture/a/different/very/long/target/path/for/the/same/profile",
};
const removalPreview: SyncProfileRemovalPreviewDto = {
  operationId: "d7fd6481-b31f-4ce4-8500-60276cbd494b",
  confirmationToken: "sync-removal-confirmation-token-long-enough",
  profileId: profile.id,
  profileName: profile.name,
  targetPath: profile.targetPath,
  albums: profile.albums,
  successfulSyncs: 2,
  manifestTargets: [{ targetPath: profile.targetPath, ownedFileCount: 12 }],
};

function workspace({
  activeSection = "selection",
  selectedAlbums = [firstAlbum],
  profiles = [profile],
  currentTargetPreview,
  currentRemovalPreview,
  renamingProfileId,
  onSelectSection = vi.fn(),
  onToggleAlbum = vi.fn(),
  onOpenProfile = vi.fn(),
  onEditProfileAlbums = vi.fn(),
  onChooseProfileTarget = vi.fn(),
  onStartRename = vi.fn(),
  onConfirmTarget = vi.fn(),
  onCancelTarget = vi.fn(),
  onPreviewRemoval = vi.fn(),
  onConfirmRemoval = vi.fn(),
  onCancelRemoval = vi.fn(),
}: {
  activeSection?: SyncSetupSection;
  selectedAlbums?: readonly (typeof firstAlbum)[];
  profiles?: readonly SyncProfileDto[];
  currentTargetPreview?: SyncProfileTargetPreviewDto;
  currentRemovalPreview?: SyncProfileRemovalPreviewDto;
  renamingProfileId?: string;
  onSelectSection?: (section: SyncSetupSection) => void;
  onToggleAlbum?: (album: typeof firstAlbum) => void;
  onOpenProfile?: (saved: SyncProfileDto) => void;
  onEditProfileAlbums?: (saved: SyncProfileDto) => void;
  onChooseProfileTarget?: (saved: SyncProfileDto) => void;
  onStartRename?: (saved: SyncProfileDto) => void;
  onConfirmTarget?: () => void;
  onCancelTarget?: () => void;
  onPreviewRemoval?: (saved: SyncProfileDto) => void;
  onConfirmRemoval?: () => void;
  onCancelRemoval?: () => void;
} = {}) {
  return (
    <SyncSetupWorkspace
      activeProfileId={undefined}
      activeSection={activeSection}
      busy={false}
      editingProfile={undefined}
      profileNameDraft="Road DAP"
      profiles={profiles}
      renamingProfileId={renamingProfileId}
      selectedAlbum={secondAlbum}
      selectedAlbums={selectedAlbums}
      removalPreview={currentRemovalPreview}
      removalPreviewHeadingRef={createRef<HTMLHeadingElement>()}
      targetPreview={currentTargetPreview}
      targetPreviewHeadingRef={createRef<HTMLHeadingElement>()}
      onBrowseLibrary={vi.fn()}
      onCancelAlbumSelection={vi.fn()}
      onCancelRename={vi.fn()}
      onCancelTarget={onCancelTarget}
      onCancelRemoval={onCancelRemoval}
      onChooseProfileTarget={onChooseProfileTarget}
      onChooseTarget={vi.fn()}
      onClearSelection={vi.fn()}
      onConfirmTarget={onConfirmTarget}
      onConfirmRemoval={onConfirmRemoval}
      onEditProfileAlbums={onEditProfileAlbums}
      onOpenProfile={onOpenProfile}
      onProfileNameDraftChange={vi.fn()}
      onPreviewRemoval={onPreviewRemoval}
      onRenameProfile={vi.fn()}
      onSaveAlbumSelection={vi.fn()}
      onSelectSection={onSelectSection}
      onStartRename={onStartRename}
      onToggleAlbum={onToggleAlbum}
    />
  );
}

describe("SyncSetupWorkspace", () => {
  it("preserves the selection while navigating its two contextual sections", async () => {
    const user = userEvent.setup();

    function Harness(): React.JSX.Element {
      const [section, setSection] = useState<SyncSetupSection>("selection");
      return workspace({ activeSection: section, onSelectSection: setSection });
    }

    render(<Harness />);
    const selectionTab = screen.getByRole("button", {
      name: "Selection draft, 1 of 100 album",
    });
    expect(selectionTab).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("list", { name: "Albums selected for DAP sync" }),
    ).toHaveTextContent("Fixture Album");

    const profilesTab = screen.getByRole("button", {
      name: "Saved profiles, 1 saved profile",
    });
    profilesTab.focus();
    await user.keyboard("{Enter}");
    expect(profilesTab).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("list", { name: "Saved DAP profiles" }),
    ).toBeVisible();

    selectionTab.focus();
    await user.keyboard("{Enter}");
    expect(
      screen.getByRole("list", { name: "Albums selected for DAP sync" }),
    ).toHaveTextContent("Fixture Album");
  });

  it("adds and removes albums directly from the selection draft", async () => {
    const user = userEvent.setup();
    const onToggleAlbum = vi.fn();
    render(workspace({ onToggleAlbum }));

    const add = screen.getByRole("button", { name: "Add Second Album" });
    add.focus();
    await user.keyboard("{Enter}");
    expect(onToggleAlbum).toHaveBeenCalledWith(secondAlbum);

    const selected = screen.getByRole("list", {
      name: "Albums selected for DAP sync",
    });
    const remove = within(selected).getByRole("button", {
      name: "Remove Fixture Album",
    });
    remove.focus();
    await user.keyboard("{Enter}");
    expect(onToggleAlbum).toHaveBeenCalledWith(firstAlbum);
  });

  it("keeps profile management behind disclosures and previews target changes explicitly", async () => {
    const user = userEvent.setup();
    const onOpenProfile = vi.fn();
    const onEditProfileAlbums = vi.fn();
    const onChooseProfileTarget = vi.fn();
    const onStartRename = vi.fn();
    const onConfirmTarget = vi.fn();
    const onCancelTarget = vi.fn();
    render(
      workspace({
        activeSection: "profiles",
        currentTargetPreview: targetPreview,
        onChooseProfileTarget,
        onConfirmTarget,
        onCancelTarget,
        onEditProfileAlbums,
        onOpenProfile,
        onStartRename,
      }),
    );

    const profiles = screen.getByRole("list", { name: "Saved DAP profiles" });
    expect(profiles).toHaveTextContent(profile.targetPath);
    expect(
      within(profiles).getByText("Manage Road DAP").closest("details"),
    ).not.toHaveAttribute("open");

    const open = within(profiles).getByRole("button", {
      name: "Open DAP profile Road DAP",
    });
    open.focus();
    await user.keyboard("{Enter}");
    expect(onOpenProfile).toHaveBeenCalledWith(profile);

    const albumDisclosure = within(profiles).getByText("View saved albums");
    await user.click(albumDisclosure);
    expect(
      within(profiles).getByRole("list", {
        name: "Albums saved in Road DAP",
      }),
    ).toHaveTextContent("Fixture Album");

    const manage = within(profiles).getByText("Manage Road DAP");
    manage.focus();
    await user.keyboard("{Enter}");
    const edit = within(profiles).getByRole("button", {
      name: "Edit albums in DAP profile Road DAP",
    });
    await user.click(edit);
    expect(onEditProfileAlbums).toHaveBeenCalledWith(profile);
    await user.click(
      within(profiles).getByRole("button", {
        name: "Change DAP target for Road DAP",
      }),
    );
    expect(onChooseProfileTarget).toHaveBeenCalledWith(profile);
    await user.click(
      within(profiles).getByRole("button", {
        name: "Rename DAP profile Road DAP",
      }),
    );
    expect(onStartRename).toHaveBeenCalledWith(profile);

    const preview = screen.getByLabelText("DAP target confirmation");
    expect(preview).toHaveTextContent(targetPreview.currentTargetPath);
    expect(preview).toHaveTextContent(targetPreview.proposedTargetPath);
    expect(preview).toHaveTextContent(
      "No source audio or target files are read, copied, replaced, or deleted.",
    );
    expect(onConfirmTarget).not.toHaveBeenCalled();

    const confirm = within(preview).getByRole("button", {
      name: "Confirm DAP target change",
    });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(onConfirmTarget).toHaveBeenCalledTimes(1);

    const cancel = within(preview).getByRole("button", {
      name: "Cancel DAP target change",
    });
    cancel.focus();
    await user.keyboard("{Enter}");
    expect(onCancelTarget).toHaveBeenCalledTimes(1);
  });

  it("previews profile removal with retained-file consequences before confirmation", async () => {
    const user = userEvent.setup();
    const onPreviewRemoval = vi.fn();
    const onConfirmRemoval = vi.fn();
    const onCancelRemoval = vi.fn();
    render(
      workspace({
        activeSection: "profiles",
        currentRemovalPreview: removalPreview,
        onPreviewRemoval,
        onConfirmRemoval,
        onCancelRemoval,
      }),
    );

    const profiles = screen.getByRole("list", { name: "Saved DAP profiles" });
    const manage = within(profiles).getByText("Manage Road DAP");
    manage.focus();
    await user.keyboard("{Enter}");
    const remove = within(profiles).getByRole("button", {
      name: "Remove DAP profile Road DAP",
    });
    remove.focus();
    await user.keyboard("{Enter}");
    expect(onPreviewRemoval).toHaveBeenCalledWith(profile);

    const preview = screen.getByLabelText("DAP profile removal confirmation");
    expect(preview).toHaveTextContent(profile.targetPath);
    expect(preview).toHaveTextContent("2");
    expect(preview).toHaveTextContent(
      "No source audio or target file is read, changed, or deleted.",
    );
    expect(preview).toHaveTextContent(
      "Re-adding the folder later will not adopt, replace, or delete them automatically.",
    );
    expect(onConfirmRemoval).not.toHaveBeenCalled();

    const disclosure = within(preview).getByText(
      "Review albums and ownership records before removal",
    );
    await user.click(disclosure);
    expect(preview).toHaveTextContent("Fixture Album");
    expect(preview).toHaveTextContent("12 files in its latest manifest");

    const confirm = within(preview).getByRole("button", {
      name: "Remove profile from Outgroove",
    });
    confirm.focus();
    await user.keyboard("{Enter}");
    expect(onConfirmRemoval).toHaveBeenCalledTimes(1);

    const keep = within(preview).getByRole("button", {
      name: "Keep profile",
    });
    keep.focus();
    await user.keyboard("{Enter}");
    expect(onCancelRemoval).toHaveBeenCalledTimes(1);
  });
});
