import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => {
  const notification = vi.fn();
  return {
    app: { isPackaged: false },
    Notification: Object.assign(notification, {
      isSupported: () => false,
    }),
  };
});

import {
  ElectronRadarNotifier,
  evaluateRadarNotificationCapability,
} from "./electron-radar-notifier";

describe("Electron Radar notifications", () => {
  it("requires a signed macOS build and an installed Windows identity", () => {
    const common = {
      packaged: true,
      supported: true,
      macSigned: false,
      windowsInstalled: false,
    };
    expect(
      evaluateRadarNotificationCapability({
        ...common,
        platform: "darwin",
      }),
    ).toEqual({
      available: false,
      unavailableReason: "unsigned-macos-build",
    });
    expect(
      evaluateRadarNotificationCapability({
        ...common,
        platform: "win32",
      }),
    ).toEqual({
      available: false,
      unavailableReason: "portable-windows-build",
    });
    expect(
      evaluateRadarNotificationCapability({
        ...common,
        platform: "linux",
      }),
    ).toEqual({ available: true, unavailableReason: null });
  });

  it("keeps development and unsupported environments unavailable", () => {
    expect(
      evaluateRadarNotificationCapability({
        platform: "darwin",
        packaged: false,
        supported: true,
        macSigned: true,
        windowsInstalled: false,
      }),
    ).toEqual({ available: false, unavailableReason: "development" });
    expect(
      evaluateRadarNotificationCapability({
        platform: "linux",
        packaged: true,
        supported: false,
        macSigned: false,
        windowsInstalled: false,
      }),
    ).toEqual({ available: false, unavailableReason: "unsupported" });
  });

  it("shows count-only copy and routes a click to the fixed local Radar event", () => {
    let click: (() => void) | undefined;
    const notification = {
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "click") click = listener;
      }),
      show: vi.fn(),
    };
    const send = vi.fn();
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send },
    };
    const create = vi.fn(() => notification);
    const notifier = new ElectronRadarNotifier(
      window as never,
      {
        platform: "linux",
        packaged: true,
        supported: true,
        macSigned: false,
        windowsInstalled: false,
      },
      create as never,
    );

    notifier.notifyNewReleases(3, 2);
    expect(create).toHaveBeenCalledWith({
      title: "New releases in Radar",
      body: "3 new releases from 2 favorite artists.",
      silent: false,
    });
    expect(notification.show).toHaveBeenCalledOnce();
    click?.();
    expect(window.restore).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith("radar:open-requested");
  });
});
