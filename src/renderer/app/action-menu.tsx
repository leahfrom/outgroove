import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface ActionMenuAnchor {
  readonly x: number;
  readonly y: number;
  readonly align: "start" | "end";
}

export interface ActionMenuItem {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

const viewportInset = 8;

export function ActionMenu({
  anchor,
  ariaLabel,
  className,
  items,
  returnFocus,
  onDismiss,
}: {
  readonly anchor: ActionMenuAnchor;
  readonly ariaLabel: string;
  readonly className?: string;
  readonly items: readonly ActionMenuItem[];
  readonly returnFocus: HTMLElement | null;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    const preferredLeft =
      anchor.align === "end" ? anchor.x - bounds.width : anchor.x;
    const preferredTop =
      anchor.y + bounds.height > window.innerHeight - viewportInset
        ? anchor.y - bounds.height
        : anchor.y;
    setPosition({
      left: Math.max(
        viewportInset,
        Math.min(
          preferredLeft,
          window.innerWidth - bounds.width - viewportInset,
        ),
      ),
      top: Math.max(
        viewportInset,
        Math.min(
          preferredTop,
          window.innerHeight - bounds.height - viewportInset,
        ),
      ),
    });
  }, [anchor]);

  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
      ?.focus();
    const closeForOutsidePointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      )
        onDismiss();
    };
    document.addEventListener("pointerdown", closeForOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeForOutsidePointer);
  }, [onDismiss]);

  const closeAndRestoreFocus = (): void => {
    onDismiss();
    returnFocus?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]:not([disabled])',
      ) ?? [],
    );
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (event.key === "Tab") {
      onDismiss();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = menuItems.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? menuItems.length - 1
          : event.key === "ArrowDown"
            ? (current + 1) % menuItems.length
            : (current - 1 + menuItems.length) % menuItems.length;
    menuItems[next]?.focus();
  };

  return (
    <div
      aria-label={ariaLabel}
      className={`action-menu${className ? ` ${className}` : ""}`}
      onKeyDown={handleKeyDown}
      ref={menuRef}
      role="menu"
      style={{ left: position.left, top: position.top }}
    >
      {items.map((item) => (
        <button
          disabled={item.disabled}
          key={item.label}
          onClick={() => {
            closeAndRestoreFocus();
            item.onSelect();
          }}
          role="menuitem"
          type="button"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
