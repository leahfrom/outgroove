import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { app, type BrowserWindow, Notification } from "electron";

import type { RadarNotificationCapabilityDto } from "../../../shared/contracts/api";
import { channels } from "../../../shared/contracts/channels";
import type { RadarNotifier } from "../../application/radar-background-refresh";

declare const OUTGROOVE_MAC_NOTIFICATIONS_READY: boolean;

export interface RadarNotificationEnvironment {
  readonly platform: NodeJS.Platform;
  readonly packaged: boolean;
  readonly supported: boolean;
  readonly macSigned: boolean;
  readonly windowsInstalled: boolean;
}

export function evaluateRadarNotificationCapability(
  environment: RadarNotificationEnvironment,
): RadarNotificationCapabilityDto {
  if (!environment.packaged)
    return { available: false, unavailableReason: "development" };
  if (!environment.supported)
    return { available: false, unavailableReason: "unsupported" };
  if (environment.platform === "darwin" && !environment.macSigned)
    return { available: false, unavailableReason: "unsigned-macos-build" };
  if (environment.platform === "win32" && !environment.windowsInstalled)
    return { available: false, unavailableReason: "portable-windows-build" };
  if (
    environment.platform !== "darwin" &&
    environment.platform !== "win32" &&
    environment.platform !== "linux"
  )
    return { available: false, unavailableReason: "unsupported" };
  return { available: true, unavailableReason: null };
}

export class ElectronRadarNotifier implements RadarNotifier {
  constructor(
    private readonly window: BrowserWindow,
    private readonly environment: RadarNotificationEnvironment,
    private readonly createNotification: (
      options: Electron.NotificationConstructorOptions,
    ) => Notification = (options) => new Notification(options),
  ) {}

  capability(): RadarNotificationCapabilityDto {
    return evaluateRadarNotificationCapability(this.environment);
  }

  notifyNewReleases(releases: number, artists: number): void {
    if (!this.capability().available) return;
    const notification = this.createNotification({
      title: "New releases in Radar",
      body: `${releases} new ${releases === 1 ? "release" : "releases"} from ${artists} favorite ${artists === 1 ? "artist" : "artists"}.`,
      silent: false,
    });
    notification.on("click", () => {
      if (this.window.isDestroyed()) return;
      if (this.window.isMinimized()) this.window.restore();
      this.window.show();
      this.window.focus();
      this.window.webContents.send(channels.openRadarRequested);
    });
    notification.show();
  }
}

export function createElectronRadarNotifier(
  window: BrowserWindow,
): ElectronRadarNotifier {
  return new ElectronRadarNotifier(window, {
    platform: process.platform,
    packaged: app.isPackaged,
    supported: Notification.isSupported(),
    macSigned: OUTGROOVE_MAC_NOTIFICATIONS_READY,
    windowsInstalled:
      process.platform === "win32" &&
      existsSync(join(dirname(process.execPath), "..", "Update.exe")),
  });
}
