import { useEffect, useRef, useState } from "react";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import {
  formatBitDepth,
  formatBitrate,
  formatChannels,
  formatDuration,
  formatFileSize,
  formatSampleRate,
} from "../../shared/domain/audio-technical";

type AlbumTrack = CatalogAlbum["tracks"][number];

export function LibraryTrackDetail({
  busy,
  mode,
  selectionPurpose,
  selectedForBatch,
  track,
  onEdit,
  onMoreInfo,
  onToggleBatch,
  registerEditTrigger,
}: {
  readonly busy: boolean;
  readonly mode: "library" | "technical" | "workbench";
  readonly selectionPurpose: string;
  readonly selectedForBatch: boolean;
  readonly track: AlbumTrack;
  readonly onEdit: () => void;
  readonly onMoreInfo?: () => void;
  readonly onToggleBatch: () => void;
  readonly registerEditTrigger?: (element: HTMLButtonElement | null) => void;
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuReturnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    const closeForOutsidePointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        event.target !== moreButtonRef.current
      )
        setMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeForOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeForOutsidePointer);
  }, [menuOpen]);

  const openMenu = (origin?: HTMLElement | null): void => {
    menuReturnFocusRef.current = origin ?? moreButtonRef.current;
    setMenuOpen(true);
  };

  const closeMenu = (restoreFocus: boolean): void => {
    setMenuOpen(false);
    if (restoreFocus) menuReturnFocusRef.current?.focus();
  };

  const chooseMenuAction = (action: () => void): void => {
    setMenuOpen(false);
    menuReturnFocusRef.current?.focus();
    action();
  };

  const handleMenuKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ) ?? [],
    );
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      setMenuOpen(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? items.length - 1
          : event.key === "ArrowDown"
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  if (mode === "library")
    return (
      <article
        className="library-track-row"
        onContextMenu={(event) => {
          event.preventDefault();
          const active =
            document.activeElement instanceof HTMLElement &&
            event.currentTarget.contains(document.activeElement)
              ? document.activeElement
              : moreButtonRef.current;
          openMenu(active);
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "ContextMenu" &&
            event.key !== "Apps" &&
            !(event.shiftKey && event.key === "F10")
          )
            return;
          event.preventDefault();
          openMenu(
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : moreButtonRef.current,
          );
        }}
      >
        <button
          aria-label={`Edit metadata for ${track.tags.title}`}
          className="library-track-activation"
          disabled={busy}
          onClick={onEdit}
          ref={registerEditTrigger}
          type="button"
        >
          <span className="track-identity">
            <strong>
              {track.tags.discNumber ?? 1}.{track.tags.trackNumber ?? "—"}{" "}
              {track.tags.title}
            </strong>
            <small>{track.tags.artist}</small>
          </span>
          <span className="track-summary-facts">
            <span>{track.format}</span>
            <span>{formatDuration(track.durationSeconds)}</span>
            <span>{formatFileSize(track.size)}</span>
          </span>
        </button>
        <div className="track-more-actions">
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={`More actions for ${track.tags.title}`}
            onClick={() => {
              if (menuOpen) closeMenu(true);
              else openMenu(moreButtonRef.current);
            }}
            ref={moreButtonRef}
            type="button"
          >
            More
          </button>
          {menuOpen && (
            <div
              aria-label={`Actions for ${track.tags.title}`}
              className="track-action-menu"
              onKeyDown={handleMenuKeyDown}
              ref={menuRef}
              role="menu"
            >
              <button
                onClick={() => chooseMenuAction(onEdit)}
                role="menuitem"
                type="button"
              >
                Edit metadata
              </button>
              <button
                onClick={() => chooseMenuAction(() => onMoreInfo?.())}
                role="menuitem"
                type="button"
              >
                More info
              </button>
            </div>
          )}
        </div>
      </article>
    );

  return (
    <details className="track-detail">
      <summary>
        <span className="track-identity">
          <strong>
            {track.tags.discNumber ?? 1}.{track.tags.trackNumber ?? "—"}{" "}
            {track.tags.title}
          </strong>
          <small>{track.tags.artist}</small>
        </span>
        <span className="track-summary-facts">
          <span>{track.format}</span>
          <span>{formatDuration(track.durationSeconds)}</span>
          <span>{formatFileSize(track.size)}</span>
        </span>
      </summary>
      <div className="track-detail-body">
        <dl className="track-facts">
          <dt>Track artist</dt>
          <dd>{track.tags.artist}</dd>
          <dt>Album artist</dt>
          <dd>{track.tags.albumArtist}</dd>
          <dt>Release date</dt>
          <dd>{track.tags.year ?? "Not set"}</dd>
          <dt>Container/format</dt>
          <dd>{track.format}</dd>
          <dt>Codec</dt>
          <dd>{track.codec ?? "Unknown"}</dd>
          <dt>Duration</dt>
          <dd>{formatDuration(track.durationSeconds)}</dd>
          <dt>Bitrate</dt>
          <dd>{formatBitrate(track.bitrate)}</dd>
          <dt>Sample rate</dt>
          <dd>{formatSampleRate(track.sampleRate)}</dd>
          <dt>Bit depth</dt>
          <dd>{formatBitDepth(track.bitDepth)}</dd>
          <dt>Channels</dt>
          <dd>{formatChannels(track.channels)}</dd>
          <dt>File size</dt>
          <dd>{formatFileSize(track.size)}</dd>
        </dl>
        <p className="track-path">
          <strong>File</strong>
          <span>{track.path}</span>
        </p>
        <details className="advanced-metadata">
          <summary>Advanced metadata</summary>
          <div className="advanced-metadata-grid">
            <section aria-label="Normalized track tags">
              <h4>Normalized tags</h4>
              <pre>{JSON.stringify(track.tags, null, 2)}</pre>
            </section>
            <section aria-label="Native track tags">
              <h4>Native tags</h4>
              <pre>{JSON.stringify(track.nativeTags, null, 2)}</pre>
            </section>
          </div>
        </details>
        {mode === "workbench" && (
          <div className="track-actions">
            <label>
              <input
                type="checkbox"
                checked={selectedForBatch}
                onChange={onToggleBatch}
              />
              Select {track.tags.title} for {selectionPurpose}
            </label>
            <button disabled={busy} onClick={onEdit} type="button">
              Edit track metadata
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
