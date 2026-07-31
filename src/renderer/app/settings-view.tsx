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
                identities, edit history, DAP profiles, manifests, and scan
                history remain available if this folder is added again.
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
                Backups contain the local catalog, edit history, saved filters,
                favorite artists, and DAP profiles—never audio or DAP files.
              </p>
            </div>
          </div>

          {restorePreview && (
            <section
              className="settings-confirmation settings-restore-confirmation"
              aria-label="Database restore confirmation"
            >
              <div>
                <p className="eyebrow">Backup checked · review required</p>
                <h3 ref={restoreHeadingRef} tabIndex={-1}>
                  Replace the current Outgroove database?
                </h3>
                <p>
                  <strong>{restorePreview.sourceName}</strong> passed integrity
                  and schema checks.
                </p>
              </div>
              <dl className="settings-summary settings-database-summary">
                <div>
                  <dt>Library roots</dt>
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
                  <dt>Schema</dt>
                  <dd>v{restorePreview.schemaVersion}</dd>
                </div>
              </dl>
              <p className="settings-safety-statement">
                Restoring replaces the current database and restarts Outgroove.
                An automatic rollback backup is created and verified first.
                Source audio and DAP files remain untouched.
              </p>
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy || scanActive}
                  onClick={onConfirmRestore}
                  type="button"
                >
                  Confirm restore and restart
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={onCancelRestore}
                  type="button"
                >
                  Keep current database
                </button>
              </div>
            </section>
          )}

          <div className="settings-database-actions">
            <article>
              <p className="eyebrow">Keep a copy</p>
              <h3>Create a backup</h3>
              <p>
                Choose a destination for a verified copy of Outgroove’s current
                database.
              </p>
              <button
                disabled={busy || scanActive}
                onClick={onCreateBackup}
                type="button"
              >
                Create database backup
              </button>
            </article>
            <article className="settings-restore-action">
              <p className="eyebrow">Bring back a backup</p>
              <h3>Restore from a backup</h3>
              <p>
                The selected file is verified first. Nothing is replaced until
                you review its contents and confirm a restart.
              </p>
              <button
                aria-label="Restore from backup"
                className="secondary"
                disabled={busy || scanActive}
                onClick={onRestoreBackup}
                type="button"
              >
                Choose backup to restore
              </button>
            </article>
            <article>
              <p className="eyebrow">Help with a problem</p>
              <h3>Export a private support report</h3>
              <p>
                Save runtime versions and aggregate catalog counts for
                troubleshooting. Paths, filenames, tags, provider responses,
                stable identifiers, and error text are excluded.
              </p>
              <button
                className="secondary"
                disabled={busy}
                onClick={onExportDiagnosticReport}
                type="button"
              >
                Export private support report
              </button>
            </article>
          </div>
        </section>
      )}
    </main>
  );
}
