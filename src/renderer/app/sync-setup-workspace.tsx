import type { Ref } from "react";

import type {
  SyncProfileDto,
  SyncProfileRemovalPreviewDto,
  SyncProfileTargetPreviewDto,
} from "../../shared/contracts/api";

export type SyncSetupSection = "selection" | "profiles";

interface SyncAlbumSummary {
  readonly id: string;
  readonly title: string;
  readonly albumArtist: string;
}

export function SyncSetupWorkspace({
  activeSection,
  selectedAlbum,
  selectedAlbums,
  editingProfile,
  profiles,
  activeProfileId,
  renamingProfileId,
  profileNameDraft,
  targetPreview,
  targetPreviewHeadingRef,
  removalPreview,
  removalPreviewHeadingRef,
  busy,
  onSelectSection,
  onToggleAlbum,
  onBrowseLibrary,
  onChooseTarget,
  onClearSelection,
  onSaveAlbumSelection,
  onCancelAlbumSelection,
  onOpenProfile,
  onEditProfileAlbums,
  onChooseProfileTarget,
  onStartRename,
  onProfileNameDraftChange,
  onRenameProfile,
  onCancelRename,
  onConfirmTarget,
  onCancelTarget,
  onPreviewRemoval,
  onConfirmRemoval,
  onCancelRemoval,
}: {
  readonly activeSection: SyncSetupSection;
  readonly selectedAlbum: SyncAlbumSummary | undefined;
  readonly selectedAlbums: readonly SyncAlbumSummary[];
  readonly editingProfile: SyncProfileDto | undefined;
  readonly profiles: readonly SyncProfileDto[];
  readonly activeProfileId: string | undefined;
  readonly renamingProfileId: string | undefined;
  readonly profileNameDraft: string;
  readonly targetPreview: SyncProfileTargetPreviewDto | undefined;
  readonly targetPreviewHeadingRef: Ref<HTMLHeadingElement>;
  readonly removalPreview: SyncProfileRemovalPreviewDto | undefined;
  readonly removalPreviewHeadingRef: Ref<HTMLHeadingElement>;
  readonly busy: boolean;
  readonly onSelectSection: (section: SyncSetupSection) => void;
  readonly onToggleAlbum: (album: SyncAlbumSummary) => void;
  readonly onBrowseLibrary: () => void;
  readonly onChooseTarget: () => void;
  readonly onClearSelection: () => void;
  readonly onSaveAlbumSelection: () => void;
  readonly onCancelAlbumSelection: () => void;
  readonly onOpenProfile: (profile: SyncProfileDto) => void;
  readonly onEditProfileAlbums: (profile: SyncProfileDto) => void;
  readonly onChooseProfileTarget: (profile: SyncProfileDto) => void;
  readonly onStartRename: (profile: SyncProfileDto) => void;
  readonly onProfileNameDraftChange: (name: string) => void;
  readonly onRenameProfile: (profile: SyncProfileDto) => void;
  readonly onCancelRename: () => void;
  readonly onConfirmTarget: () => void;
  readonly onCancelTarget: () => void;
  readonly onPreviewRemoval: (profile: SyncProfileDto) => void;
  readonly onConfirmRemoval: () => void;
  readonly onCancelRemoval: () => void;
}): React.JSX.Element {
  const selectedAlbumIsInDraft = selectedAlbum
    ? selectedAlbums.some((album) => album.id === selectedAlbum.id)
    : false;

  return (
    <section
      className="card sync-setup-workspace"
      aria-labelledby="sync-setup-title"
    >
      <div className="workflow-heading">
        <div>
          <p className="eyebrow">Choose your music</p>
          <h2 id="sync-setup-title">Set up a sync</h2>
          <p>
            Choose albums or open a saved profile. Nothing on your player is
            read or changed until you preview the sync.
          </p>
        </div>
      </div>

      <nav aria-label="Albums and profiles setup" className="sync-setup-nav">
        <button
          aria-label={`Current selection, ${selectedAlbums.length} of 100 ${selectedAlbums.length === 1 ? "album" : "albums"}`}
          aria-current={activeSection === "selection" ? "page" : undefined}
          onClick={() => onSelectSection("selection")}
          type="button"
        >
          <span>Current selection</span>
          <small>
            {selectedAlbums.length} of 100{" "}
            {selectedAlbums.length === 1 ? "album" : "albums"}
          </small>
        </button>
        <button
          aria-label={`Saved profiles, ${profiles.length} saved ${profiles.length === 1 ? "profile" : "profiles"}`}
          aria-current={activeSection === "profiles" ? "page" : undefined}
          onClick={() => onSelectSection("profiles")}
          type="button"
        >
          <span>Saved profiles</span>
          <small>
            {profiles.length} saved{" "}
            {profiles.length === 1 ? "profile" : "profiles"}
          </small>
        </button>
      </nav>

      {activeSection === "selection" ? (
        <section
          className="sync-selection-workspace"
          aria-labelledby="sync-selection-title"
        >
          <div className="sync-setup-section-heading">
            <div>
              <p className="eyebrow">
                {editingProfile ? "Editing saved albums" : "New sync"}
              </p>
              <h3 id="sync-selection-title">
                {editingProfile
                  ? `Edit albums in ${editingProfile.name}`
                  : "Albums for your next sync"}
              </h3>
              <p>
                Choosing albums does not change your Library or read anything
                from your player.
              </p>
            </div>
            <p className="sync-selection-count" aria-live="polite">
              <strong>{selectedAlbums.length}</strong>
              <span>of 100 selected</span>
            </p>
          </div>

          {editingProfile && (
            <section
              className="sync-editing-profile"
              aria-label="Profile draft"
            >
              <div>
                <strong>Unsaved selection for {editingProfile.name}</strong>
                <span className="sync-target-path">
                  Target stays {editingProfile.targetPath}
                </span>
              </div>
              <span>Preview required again after saving</span>
            </section>
          )}

          {selectedAlbum && (
            <section
              className="sync-current-album"
              aria-label="Current Library album"
            >
              <div>
                <p className="eyebrow">Current Library album</p>
                <strong>{selectedAlbum.title}</strong>
                <span>{selectedAlbum.albumArtist}</span>
              </div>
              <button
                aria-pressed={selectedAlbumIsInDraft}
                disabled={
                  busy ||
                  (selectedAlbums.length >= 100 && !selectedAlbumIsInDraft)
                }
                onClick={() => onToggleAlbum(selectedAlbum)}
                type="button"
              >
                {selectedAlbumIsInDraft
                  ? `Remove ${selectedAlbum.title}`
                  : `Add ${selectedAlbum.title}`}
              </button>
            </section>
          )}

          {selectedAlbums.length === 0 ? (
            <div className="workflow-empty">
              <h4>No albums selected</h4>
              <p>
                Browse Library and use an album’s contextual Sync action to
                begin.
              </p>
              <button onClick={onBrowseLibrary} type="button">
                Browse Library
              </button>
            </div>
          ) : (
            <section className="sync-draft-albums">
              <div>
                <h4>Selected albums</h4>
                <span>
                  Review the complete selection before choosing a target.
                </span>
              </div>
              <ul aria-label="Albums selected for DAP sync">
                {selectedAlbums.map((album) => (
                  <li key={album.id}>
                    <div>
                      <strong>{album.title}</strong>
                      <span>{album.albumArtist}</span>
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => onToggleAlbum(album)}
                      type="button"
                    >
                      Remove {album.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="sync-setup-actions">
            {editingProfile ? (
              <>
                <button
                  className="primary"
                  disabled={busy || selectedAlbums.length === 0}
                  onClick={onSaveAlbumSelection}
                  type="button"
                >
                  Save album selection for {editingProfile.name}
                </button>
                <button
                  disabled={busy}
                  onClick={onCancelAlbumSelection}
                  type="button"
                >
                  Cancel album selection changes
                </button>
              </>
            ) : (
              <>
                <button
                  className="primary"
                  disabled={busy || selectedAlbums.length === 0}
                  onClick={onChooseTarget}
                  type="button"
                >
                  Choose DAP target
                </button>
                <button
                  disabled={busy || selectedAlbums.length === 0}
                  onClick={onClearSelection}
                  type="button"
                >
                  Clear selection
                </button>
              </>
            )}
          </div>
        </section>
      ) : (
        <section
          className="sync-profiles-workspace"
          aria-labelledby="sync-profiles-title"
        >
          <div className="sync-setup-section-heading">
            <div>
              <p className="eyebrow">Saved syncs</p>
              <h3 id="sync-profiles-title">DAP profiles</h3>
              <p>
                A profile remembers your albums and destination. Opening one
                does not change anything until you preview and confirm a sync.
              </p>
            </div>
          </div>

          {profiles.length === 0 ? (
            <div className="workflow-empty">
              <h4>No profiles saved yet</h4>
              <p>
                Create one from a selection of up to 100 Library albums and a
                folder-backed target.
              </p>
              <button
                onClick={() => onSelectSection("selection")}
                type="button"
              >
                Start a selection
              </button>
            </div>
          ) : (
            <ul className="sync-profile-list" aria-label="Saved DAP profiles">
              {profiles.map((saved) => (
                <li
                  data-active={activeProfileId === saved.id ? "true" : "false"}
                  key={saved.id}
                >
                  <div className="sync-profile-heading">
                    <div>
                      <strong>{saved.name}</strong>
                      <span className="sync-target-path">
                        {saved.targetPath}
                      </span>
                    </div>
                    <span className="sync-profile-album-count">
                      {saved.albums.length}{" "}
                      {saved.albums.length === 1 ? "album" : "albums"}
                    </span>
                  </div>

                  <div className="sync-profile-primary-action">
                    <button
                      className="primary"
                      aria-label={`Open DAP profile ${saved.name}`}
                      disabled={busy || Boolean(renamingProfileId)}
                      aria-pressed={activeProfileId === saved.id}
                      onClick={() => onOpenProfile(saved)}
                      type="button"
                    >
                      Open {saved.name}
                    </button>
                    {activeProfileId === saved.id && (
                      <span>Active profile</span>
                    )}
                  </div>

                  <details className="sync-profile-albums">
                    <summary>View saved albums</summary>
                    <ul aria-label={`Albums saved in ${saved.name}`}>
                      {saved.albums.map((album) => (
                        <li key={album.id}>
                          <strong>{album.title}</strong>
                          <span>{album.albumArtist}</span>
                        </li>
                      ))}
                    </ul>
                  </details>

                  <details
                    className="sync-profile-management"
                    open={renamingProfileId === saved.id || undefined}
                  >
                    <summary>Manage {saved.name}</summary>
                    <div className="sync-profile-management-actions">
                      <button
                        aria-label={`Edit albums in DAP profile ${saved.name}`}
                        disabled={busy || Boolean(renamingProfileId)}
                        onClick={() => onEditProfileAlbums(saved)}
                        type="button"
                      >
                        Edit albums
                      </button>
                      <button
                        aria-label={`Change DAP target for ${saved.name}`}
                        disabled={
                          busy ||
                          Boolean(editingProfile) ||
                          Boolean(renamingProfileId)
                        }
                        onClick={() => onChooseProfileTarget(saved)}
                        type="button"
                      >
                        Change target
                      </button>
                      {renamingProfileId === saved.id ? (
                        <form
                          aria-label={`Rename DAP profile ${saved.name}`}
                          onSubmit={(event) => {
                            event.preventDefault();
                            onRenameProfile(saved);
                          }}
                        >
                          <label htmlFor={`sync-profile-name-${saved.id}`}>
                            New name for {saved.name}
                          </label>
                          <input
                            autoFocus
                            id={`sync-profile-name-${saved.id}`}
                            maxLength={100}
                            value={profileNameDraft}
                            onChange={(event) =>
                              onProfileNameDraftChange(event.target.value)
                            }
                          />
                          <div className="actions">
                            <button
                              aria-label="Save DAP profile name"
                              disabled={
                                busy || profileNameDraft.trim().length === 0
                              }
                              type="submit"
                            >
                              Save name
                            </button>
                            <button
                              aria-label="Cancel DAP profile rename"
                              disabled={busy}
                              onClick={onCancelRename}
                              type="button"
                            >
                              Cancel rename
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <button
                            aria-label={`Rename DAP profile ${saved.name}`}
                            disabled={
                              busy ||
                              Boolean(editingProfile) ||
                              Boolean(renamingProfileId)
                            }
                            onClick={() => onStartRename(saved)}
                            type="button"
                          >
                            Rename profile
                          </button>
                          <button
                            aria-label={`Remove DAP profile ${saved.name}`}
                            disabled={
                              busy ||
                              Boolean(editingProfile) ||
                              Boolean(renamingProfileId)
                            }
                            onClick={() => onPreviewRemoval(saved)}
                            type="button"
                          >
                            Remove profile
                          </button>
                        </>
                      )}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}

          {targetPreview && (
            <section
              className="sync-target-preview"
              aria-label="DAP target confirmation"
            >
              <div>
                <p className="eyebrow">
                  {targetPreview.identityRefresh
                    ? "Recheck saved storage"
                    : "New destination"}
                </p>
                <h4 ref={targetPreviewHeadingRef} tabIndex={-1}>
                  {targetPreview.identityRefresh
                    ? `Recheck the destination for ${targetPreview.profileName}`
                    : `Review the new destination for ${targetPreview.profileName}`}
                </h4>
                <p>
                  {targetPreview.identityRefresh
                    ? "This updates only the saved information Outgroove uses to recognize this storage."
                    : "This updates only the saved destination and the information Outgroove uses to recognize it."}{" "}
                  No source audio or target files are copied, replaced, or
                  deleted.
                </p>
              </div>
              <dl>
                <div>
                  <dt>Current target</dt>
                  <dd>{targetPreview.currentTargetPath}</dd>
                </div>
                <div>
                  <dt>
                    {targetPreview.identityRefresh
                      ? "Rechecked target"
                      : "New target"}
                  </dt>
                  <dd>{targetPreview.proposedTargetPath}</dd>
                </div>
              </dl>
              <p>
                {targetPreview.identityRefresh
                  ? "Completed syncs and Outgroove’s record of files it synced stay with this profile and destination."
                  : "Completed syncs stay with this profile. Outgroove will build a separate record of synced files for the new destination."}
              </p>
              <p>
                {targetPreview.proposedVolumeEvidenceAvailable
                  ? "Outgroove can remember this storage and check it again before future syncs."
                  : "Outgroove could not get a reliable identity for this storage. You will be asked to confirm it before future syncs."}
              </p>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={onConfirmTarget}
                  type="button"
                >
                  {targetPreview.identityRefresh
                    ? "Confirm volume identity refresh"
                    : "Confirm DAP target change"}
                </button>
                <button disabled={busy} onClick={onCancelTarget} type="button">
                  {targetPreview.identityRefresh
                    ? "Cancel identity refresh"
                    : "Cancel DAP target change"}
                </button>
              </div>
            </section>
          )}

          {removalPreview && (
            <section
              className="sync-profile-removal-preview"
              aria-label="DAP profile removal confirmation"
            >
              <div>
                <p className="eyebrow">Before you remove this profile</p>
                <h4 ref={removalPreviewHeadingRef} tabIndex={-1}>
                  Remove {removalPreview.profileName} from Outgroove?
                </h4>
                <p>
                  This removes only the saved profile, its sync history, and
                  Outgroove’s record of files it synced. No audio or destination
                  file is read, changed, or deleted.
                </p>
              </div>
              <dl>
                <div>
                  <dt>Saved target</dt>
                  <dd>{removalPreview.targetPath}</dd>
                </div>
                <div>
                  <dt>Selected albums</dt>
                  <dd>{removalPreview.albums.length}</dd>
                </div>
                <div>
                  <dt>Successful sync records</dt>
                  <dd>{removalPreview.successfulSyncs}</dd>
                </div>
                <div>
                  <dt>Destinations with synced-file records</dt>
                  <dd>{removalPreview.manifestTargets.length}</dd>
                </div>
              </dl>
              <details>
                <summary>Review saved albums and destinations</summary>
                <div className="sync-profile-removal-details">
                  <section>
                    <h5>Albums</h5>
                    <ul>
                      {removalPreview.albums.map((album) => (
                        <li key={album.id}>
                          <strong>{album.title}</strong>
                          <span>{album.albumArtist}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section>
                    <h5>Saved destinations</h5>
                    {removalPreview.manifestTargets.length === 0 ? (
                      <p>No successful sync manifest is stored.</p>
                    ) : (
                      <ul>
                        {removalPreview.manifestTargets.map((target) => (
                          <li key={target.targetPath}>
                            <strong>{target.targetPath}</strong>
                            <span>
                              {target.ownedFileCount}{" "}
                              {target.ownedFileCount === 1 ? "file" : "files"}{" "}
                              recorded from its latest completed sync
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </details>
              <p>
                Outgroove will no longer recognize files left at these
                destinations. Adding the folder again will not claim, replace,
                or remove those files automatically.
              </p>
              <div className="actions">
                <button
                  disabled={busy}
                  onClick={onConfirmRemoval}
                  type="button"
                >
                  Remove profile from Outgroove
                </button>
                <button disabled={busy} onClick={onCancelRemoval} type="button">
                  Keep profile
                </button>
              </div>
            </section>
          )}
        </section>
      )}
    </section>
  );
}
