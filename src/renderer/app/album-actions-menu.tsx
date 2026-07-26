import { useCallback, useRef, useState } from "react";

import { ActionMenu, type ActionMenuAnchor } from "./action-menu";

export function AlbumActionsMenu({
  albumTitle,
  busy,
  syncDisabled,
  onEditMetadata,
  onEditTrackOrder,
  onOpenHistory,
  onAddToSync,
}: {
  readonly albumTitle: string;
  readonly busy: boolean;
  readonly syncDisabled: boolean;
  readonly onEditMetadata: () => void;
  readonly onEditTrackOrder: () => void;
  readonly onOpenHistory: () => void;
  readonly onAddToSync: () => void;
}): React.JSX.Element {
  const [menuAnchor, setMenuAnchor] = useState<ActionMenuAnchor>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dismissMenu = useCallback(() => setMenuAnchor(undefined), []);

  const openMenu = (): void => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    setMenuAnchor({
      x: bounds?.right ?? 0,
      y: (bounds?.bottom ?? 0) + 4,
      align: "end",
    });
  };

  return (
    <div className="album-actions-menu">
      <button
        aria-expanded={Boolean(menuAnchor)}
        aria-haspopup="menu"
        disabled={busy}
        onClick={() => {
          if (menuAnchor) {
            dismissMenu();
            triggerRef.current?.focus();
          } else openMenu();
        }}
        ref={triggerRef}
        type="button"
      >
        Album actions
      </button>
      {menuAnchor && (
        <ActionMenu
          anchor={menuAnchor}
          ariaLabel={`Actions for ${albumTitle}`}
          className="album-action-menu"
          items={[
            { label: "Edit album metadata", onSelect: onEditMetadata },
            { label: "Edit track order", onSelect: onEditTrackOrder },
            { label: "History & undo", onSelect: onOpenHistory },
            {
              label: `Add ${albumTitle} to Sync`,
              disabled: syncDisabled,
              onSelect: onAddToSync,
            },
          ]}
          returnFocus={triggerRef.current}
          onDismiss={dismissMenu}
        />
      )}
    </div>
  );
}
