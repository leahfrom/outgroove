import { useEffect, useRef } from "react";

import type {
  DatabaseRestorePreviewDto,
  LibraryRootDto,
  LibraryRootRemovalPreviewDto,
  ScanJobDto,
} from "../../shared/contracts/api";
import {
  SettingsNavigation,
  type SettingsSection,
} from "./settings-navigation";

export function SettingsView({
  activeSection,
  busy,
  libraryRoots,
  restorePreview,
  rootId,
  rootRemovalPreview,
  scanActive,
  scanJob,
  onAddLibraryFolder,
  onCancelRestore,
  onCancelRootRemoval,
  onConfirmRestore,
  onConfirmRootRemoval,
  onCreateBackup,
  onExportDiagnosticReport,
  onPreviewRootRemoval,
  onRestoreBackup,
  onScanRoot,
  onSelectSection,
}: {
  readonly activeSection: SettingsSection;
  readonly busy: boolean;
  readonly libraryRoots: readonly LibraryRootDto[];
  readonly restorePreview: DatabaseRestorePreviewDto | undefined;
  readonly rootId: string | undefined;
  readonly rootRemovalPreview: LibraryRootRemovalPreviewDto | undefined;
  readonly scanActive: boolean;
  readonly scanJob: ScanJobDto | undefined;
  readonly onAddLibraryFolder: () => void;
  readonly onCancelRestore: () => void;
  readonly onCancelRootRemoval: () => void;
  readonly onConfirmRestore: () => void;
  readonly onConfirmRootRemoval: () => void;
  readonly onCreateBackup: () => void;
  readonly onExportDiagnosticReport: () => void;
  readonly onPreviewRootRemoval: (rootId: string) => void;
  readonly onRestoreBackup: () => void;
  readonly onScanRoot: (rootId: string) => void;
  readonly onSelectSection: (section: SettingsSection) => void;
}): React.JSX.Element {
  const rootRemovalHeadingRef = useRef<HTMLHeadingElement>(null);
  const restoreHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (rootRemovalPreview) rootRemovalHeadingRef.current?.focus();
  }, [rootRemovalPreview]);

  useEffect(() => {
    if (restorePreview && activeSection === "database")
      restoreHeadingRef.current?.focus();
  }, [activeSection, restorePreview]);

  return (
    <main className="settings-view">
      <section className="settings-workflow-header">
        <div>
          <p className="eyebrow">Your Outgroove setup</p>
          <h2>Folders, backups, and support</h2>
          <p>
            These tools change only information saved by Outgroove. They never
            move or change your audio or files on your player.
          </p>
        </div>
        <SettingsNavigation
          activeSection={activeSection}
          hasRestorePreview={Boolean(restorePreview)}
          onSelect={onSelectSection}
        />
      </section>

      {activeSection === "library-folders" && (
        <section
          className="settings-workspace"
          aria-labelledby="watched-library-folders"
        >
          <div className="settings-section-heading">
            <div>
              <p className="eyebrow">Where your music lives</p>
              <h2 id="watched-library-folders">Library folders</h2>
              <p>
                Outgroove scans only when you ask, and scanning does not change
                your music.
              </p>
            </div>
            <div className="settings-heading-actions">
              <strong>
                {libraryRoots.length} watched{" "}
                {libraryRoots.length === 1 ? "folder" : "folders"}
              </strong>
              <button
                disabled={busy || scanActive}
                onClick={onAddLibraryFolder}
                type="button"
              >
                Add Library folder
              </button>
            </div>
          </div>

          {rootRemovalPreview && (
            <section
              className="settings-confirmation"
              aria-label="Library folder removal preview"
            >
              <div>
                <p className="eyebrow">Review required</p>
                <h3 ref={rootRemovalHeadingRef} tabIndex={-1}>
                  Stop watching this folder?
                </h3>
                <p className="settings-path">{rootRemovalPreview.path}</p>
              </div>
              <dl className="settings-summary">
                <div>
                  <dt>Visible tracks hidden</dt>
                  <dd>{rootRemovalPreview.visibleTracks}</dd>
                </div>
                <div>
                  <dt>Albums no longer visible</dt>
                  <dd>{rootRemovalPreview.albumsHidden}</dd>
                </div>
                <div>
                  <dt>Scan problems hidden</dt>
                  <dd>{rootRemovalPreview.scanProblemsHidden}</dd>
                </div>
              </dl>
              <p className="settings-safety-statement">
                <strong>No audio or DAP files will be deleted.</strong> Catalog
                identities, edit history, DAP profiles, records of synced files,
                and scan history remain available if this folder is added again.
              </p>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || scanActive}
                  onClick={onConfirmRootRemoval}
                  type="button"
                >
                  Confirm stop watching
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={onCancelRootRemoval}
                  type="button"
                >
                  Keep watching
                </button>
              </div>
            </section>
          )}

          {libraryRoots.length === 0 ? (
            <div className="settings-empty">
              <h3>No Library folders yet</h3>
              <p>
                Add a local folder, review it, then start its first read-only
                scan when you are ready.
              </p>
            </div>
          ) : (
            <ul
              aria-label="Watched Library folders"
              className="library-root-list settings-root-list"
            >
              {libraryRoots.map((root) => {
                const isCurrent = root.id === rootId;
                const isScanning = scanActive && scanJob?.rootId === root.id;
                return (
                  <li key={root.id}>
                    <div className="settings-root-details">
                      <strong className="settings-path" title={root.path}>
                        {root.path}
                      </strong>
                      <div className="settings-root-status">
                        <span>
                          {isScanning
                            ? "Scan in progress"
                            : root.lastScanAt
                              ? "Scanned"
                              : "Never scanned"}
                        </span>
                        {root.lastScanAt && (
                          <time dateTime={root.lastScanAt}>
                            Last completed{" "}
                            {new Date(root.lastScanAt).toLocaleString()}
                          </time>
                        )}
                        {isCurrent && <span>Current scan target</span>}
                      </div>
                    </div>
                    <div className="library-root-actions">
                      <button
                        aria-label={`Scan folder ${root.path}`}
                        disabled={busy || scanActive}
                        onClick={() => onScanRoot(root.id)}
                        type="button"
                      >
                        Scan folder
                      </button>
                      <button
                        aria-label={`Stop watching ${root.path}`}
                        className="secondary"
                        disabled={busy || scanActive}
                        onClick={() => onPreviewRootRemoval(root.id)}
                        type="button"
                      >
                        Stop watching
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {activeSection === "database" && (
        <section
          className="settings-workspace"
          aria-labelledby="database-safety"
        >
          <div className="settings-section-heading">
            <div>
              <p className="eyebrow">Protect your setup</p>
              <h2 id="database-safety">Backups and support</h2>
              <p>
                A backup saves your Outgroove catalog and setup, including edit
                history, saved filters, favorite artists, and DAP profiles. It
                does not include or change your music or player files.
              </p>
            </div>
          </div>

          {restorePreview && (
            <section
              className="settings-confirmation settings-restore-confirmation"
              aria-label="Backup restore confirmation"
            >
              <div>
                <p className="eyebrow">Backup checked · review required</p>
                <h3 ref={restoreHeadingRef} tabIndex={-1}>
                  Replace your current Outgroove data?
                </h3>
                <p>
                  Outgroove checked <strong>{restorePreview.sourceName}</strong>{" "}
                  and can read it safely.
                </p>
              </div>
              <dl className="settings-summary settings-database-summary">
                <div>
                  <dt>Library folders</dt>
                  <dd>{restorePreview.summary.libraryRoots}</dd>
                </div>
                <div>
                  <dt>Albums</dt>
                  <dd>{restorePreview.summary.albums}</dd>
                </div>
                <div>
                  <dt>Tracks</dt>
                  <dd>{restorePreview.summary.tracks}</dd>
                </div>
                <div>
                  <dt>DAP profiles</dt>
                  <dd>{restorePreview.summary.syncProfiles}</dd>
                </div>
                <div>
                  <dt>Saved Library filters</dt>
                  <dd>{restorePreview.summary.savedLibraryFilters}</dd>
                </div>
                <div>
                  <dt>Favorite artists</dt>
                  <dd>{restorePreview.summary.favoriteArtists}</dd>
                </div>
                <div>
                  <dt>Radar items</dt>
                  <dd>{restorePreview.summary.radarItems}</dd>
                </div>
                <div>
                  <dt>Backup version</dt>
                  <dd>{restorePreview.schemaVersion}</dd>
                </div>
              </dl>
              <p className="settings-safety-statement">
                This replaces your current catalog and saved setup, then
                restarts Outgroove. First, Outgroove saves and checks a safety
                backup of what you have now. Your music and player files remain
                untouched.
              </p>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || scanActive}
                  onClick={onConfirmRestore}
                  type="button"
                >
                  Restore this backup and restart
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={onCancelRestore}
                  type="button"
                >
                  Keep current Outgroove data
                </button>
              </div>
            </section>
          )}

          <div className="settings-database-actions">
            <article>
              <p className="eyebrow">Keep a copy</p>
              <h3>Save an Outgroove backup</h3>
              <p>
                Choose where to save a checked copy of your catalog, edit
                history, filters, favorites, and DAP profiles.
              </p>
              <button
                disabled={busy || scanActive}
                onClick={onCreateBackup}
                type="button"
              >
                Save Outgroove backup
              </button>
            </article>
            <article className="settings-restore-action">
              <p className="eyebrow">Bring back a backup</p>
              <h3>Use an earlier backup</h3>
              <p>
                Outgroove checks the backup and shows what it contains. Nothing
                is replaced until you review it and confirm.
              </p>
              <button
                aria-label="Choose an Outgroove backup"
                className="secondary"
                disabled={busy || scanActive}
                onClick={onRestoreBackup}
                type="button"
              >
                Choose an Outgroove backup
              </button>
            </article>
            <article>
              <p className="eyebrow">Help with a problem</p>
              <h3>Save a privacy-safe support report</h3>
              <p>
                The report includes app and system versions plus overall Library
                counts. It leaves out paths, filenames, tags, online results,
                identifying IDs, and error details.
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={onExportDiagnosticReport}
                type="button"
              >
                Save support report
              </button>
            </article>
          </div>
        </section>
      )}
    </main>
  );
}
