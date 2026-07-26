import { useCallback, useRef, useState } from "react";

import type { CatalogAlbum } from "../../shared/domain/catalog";
import {
  formatBitDepth,
  formatBitrate,
  formatChannels,
  formatDuration,
  formatFileSize,
  formatSampleRate,
} from "../../shared/domain/audio-technical";
import { ActionMenu, type ActionMenuAnchor } from "./action-menu";

type AlbumTrack = CatalogAlbum["tracks"][number];

export function LibraryTrackDetail({
  busy,
  mode,
  track,
  onEdit,
  onMoreInfo,
  registerEditTrigger,
}: {
  readonly busy: boolean;
  readonly mode: "library" | "technical";
  readonly track: AlbumTrack;
  readonly onEdit: () => void;
  readonly onMoreInfo?: () => void;
  readonly registerEditTrigger?: (element: HTMLButtonElement | null) => void;
}): React.JSX.Element {
  const [menuAnchor, setMenuAnchor] = useState<ActionMenuAnchor>();
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuReturnFocusRef = useRef<HTMLElement | null>(null);

  const openMenu = (
    anchor: ActionMenuAnchor,
    origin?: HTMLElement | null,
  ): void => {
    menuReturnFocusRef.current = origin ?? moreButtonRef.current;
    setMenuAnchor(anchor);
  };

  const dismissMenu = useCallback(() => setMenuAnchor(undefined), []);

  const anchorToMoreButton = (): ActionMenuAnchor => {
    const bounds = moreButtonRef.current?.getBoundingClientRect();
    return {
      x: bounds?.right ?? 0,
      y: (bounds?.bottom ?? 0) + 4,
      align: "end",
    };
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
          openMenu(
            { x: event.clientX, y: event.clientY, align: "start" },
            active,
          );
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
            anchorToMoreButton(),
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
            aria-expanded={Boolean(menuAnchor)}
            aria-haspopup="menu"
            aria-label={`More actions for ${track.tags.title}`}
            onClick={() => {
              if (menuAnchor) {
                dismissMenu();
                moreButtonRef.current?.focus();
              } else openMenu(anchorToMoreButton(), moreButtonRef.current);
            }}
            ref={moreButtonRef}
            type="button"
          >
            More
          </button>
          {menuAnchor && (
            <ActionMenu
              anchor={menuAnchor}
              ariaLabel={`Actions for ${track.tags.title}`}
              className="track-action-menu"
              items={[
                { label: "Edit metadata", onSelect: onEdit },
                {
                  label: "More info",
                  onSelect: () => onMoreInfo?.(),
                },
              ]}
              returnFocus={menuReturnFocusRef.current}
              onDismiss={dismissMenu}
            />
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
      </div>
    </details>
  );
}
