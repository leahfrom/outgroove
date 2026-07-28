import type {
  RadarBackgroundRefreshOutcome,
  RadarBackgroundRefreshPreferencesDto,
  RadarBackgroundRefreshSettingsDto,
  RadarNotificationCapabilityDto,
  RadarRefreshAllResultDto,
} from "../../shared/contracts/api";

interface RadarBackgroundSettingsStore {
  getRadarBackgroundRefreshSettings(): RadarBackgroundRefreshPreferencesDto;
  saveRadarBackgroundRefreshSettings(
    settings: RadarBackgroundRefreshPreferencesDto,
  ): RadarBackgroundRefreshPreferencesDto;
}

interface IdleRadarRefresher {
  refreshAllIfIdle(
    progress: (completed: number, total: number, detail: string) => void,
  ): Promise<RadarRefreshAllResultDto | undefined>;
  cancelBackground(): { readonly cancelled: boolean };
}

interface RadarBackgroundEnvironment {
  isOnline(): boolean;
  isOnBatteryPower(): boolean;
}

export interface RadarNotifier {
  capability(): RadarNotificationCapabilityDto;
  notifyNewReleases(releases: number, artists: number): void;
}

interface RadarBackgroundClock {
  now(): Date;
  random(): number;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(timer: unknown): void;
}

const hour = 60 * 60 * 1000;
export const radarBackgroundDelays = {
  startup: { minimum: 60_000, maximum: 15 * 60_000 },
  retry: { minimum: 30 * 60_000, maximum: 90 * 60_000 },
  normal: { minimum: 18 * hour, maximum: 24 * hour },
} as const;

const defaultClock: RadarBackgroundClock = {
  now: () => new Date(),
  random: () => Math.random(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export class RadarBackgroundRefresh {
  private timer: unknown;
  private stopped = true;

  constructor(
    private readonly store: RadarBackgroundSettingsStore,
    private readonly radar: IdleRadarRefresher,
    private readonly environment: RadarBackgroundEnvironment,
    private readonly progress: (
      completed: number,
      total: number,
      detail: string,
    ) => void,
    private readonly updated: (
      settings: RadarBackgroundRefreshSettingsDto,
    ) => void,
    private readonly notifier: RadarNotifier,
    private readonly clock: RadarBackgroundClock = defaultClock,
  ) {}

  start(): RadarBackgroundRefreshSettingsDto {
    this.stopped = false;
    const current = this.store.getRadarBackgroundRefreshSettings();
    if (!current.enabled) return this.withCapability(current);
    return this.withCapability(this.scheduleExistingOrStartup(current));
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.radar.cancelBackground();
  }

  getSettings(): RadarBackgroundRefreshSettingsDto {
    return this.withCapability(this.store.getRadarBackgroundRefreshSettings());
  }

  updatePreferences(
    enabled: boolean,
    pauseOnBattery: boolean,
    notificationsEnabled: boolean,
  ): RadarBackgroundRefreshSettingsDto {
    const current = this.store.getRadarBackgroundRefreshSettings();
    if (
      notificationsEnabled &&
      !current.notificationsEnabled &&
      !this.notifier.capability().available
    )
      throw new Error(
        "Radar notifications are unavailable in this Outgroove build.",
      );
    this.clearTimer();
    const next =
      enabled && current.enabled && current.nextRefreshAt
        ? current
        : enabled
          ? this.withNext(current, "startup")
          : { ...current, nextRefreshAt: null };
    const saved = this.save({
      ...next,
      enabled,
      pauseOnBattery,
      notificationsEnabled,
    });
    if (!enabled) this.radar.cancelBackground();
    else if (!this.stopped) this.arm(saved);
    return this.withCapability(saved);
  }

  private scheduleExistingOrStartup(
    current: RadarBackgroundRefreshPreferencesDto,
  ): RadarBackgroundRefreshPreferencesDto {
    const nextTime = current.nextRefreshAt
      ? Date.parse(current.nextRefreshAt)
      : Number.NaN;
    const scheduled =
      Number.isFinite(nextTime) && nextTime > this.clock.now().getTime()
        ? current
        : this.save(this.withNext(current, "startup"));
    this.arm(scheduled);
    return scheduled;
  }

  private arm(settings: RadarBackgroundRefreshPreferencesDto): void {
    if (this.stopped || !settings.enabled || !settings.nextRefreshAt) return;
    const delay = Math.max(
      0,
      Date.parse(settings.nextRefreshAt) - this.clock.now().getTime(),
    );
    this.timer = this.clock.setTimer(() => {
      this.timer = undefined;
      void this.runDue().catch(() => this.recordUnexpectedFailure());
    }, delay);
  }

  private async runDue(): Promise<void> {
    const current = this.store.getRadarBackgroundRefreshSettings();
    if (this.stopped || !current.enabled) return;
    const checkedAt = this.clock.now().toISOString();
    if (!this.environment.isOnline()) {
      this.recordCheck(current, checkedAt, "offline");
      return;
    }
    if (current.pauseOnBattery && this.environment.isOnBatteryPower()) {
      this.recordCheck(current, checkedAt, "battery");
      return;
    }
    const result = await this.radar.refreshAllIfIdle(this.progress);
    const latest = this.store.getRadarBackgroundRefreshSettings();
    if (this.isStopped() || !latest.enabled) return;
    if (!result) {
      this.recordCheck(latest, checkedAt, "busy");
      return;
    }
    const outcome: RadarBackgroundRefreshOutcome = result.cancelled
      ? "cancelled"
      : result.failed === 0
        ? "success"
        : result.successful > 0
          ? "partial"
          : "failed";
    const delay = outcome === "success" ? "normal" : "retry";
    const saved = this.save({
      ...this.withNext(latest, delay),
      lastCheckedAt: checkedAt,
      lastSuccessfulRefreshAt:
        outcome === "success" ? checkedAt : latest.lastSuccessfulRefreshAt,
      lastOutcome: outcome,
      lastCompleted: result.completed,
      lastSucceeded: result.successful,
      lastFailed: result.failed,
    });
    if (outcome === "success" && saved.notificationsEnabled)
      this.notifyNewReleases(result);
    this.arm(saved);
  }

  private recordCheck(
    current: RadarBackgroundRefreshPreferencesDto,
    checkedAt: string,
    outcome: RadarBackgroundRefreshOutcome,
  ): void {
    const saved = this.save({
      ...this.withNext(current, "retry"),
      lastCheckedAt: checkedAt,
      lastOutcome: outcome,
      lastCompleted: 0,
      lastSucceeded: 0,
      lastFailed: 0,
    });
    this.arm(saved);
  }

  private recordUnexpectedFailure(): void {
    if (this.stopped) return;
    const current = this.store.getRadarBackgroundRefreshSettings();
    if (!current.enabled) return;
    this.recordCheck(current, this.clock.now().toISOString(), "failed");
  }

  private withNext(
    settings: RadarBackgroundRefreshPreferencesDto,
    delay: keyof typeof radarBackgroundDelays,
  ): RadarBackgroundRefreshPreferencesDto {
    const range = radarBackgroundDelays[delay];
    const duration =
      range.minimum +
      Math.floor(this.clock.random() * (range.maximum - range.minimum + 1));
    return {
      ...settings,
      nextRefreshAt: new Date(
        this.clock.now().getTime() + duration,
      ).toISOString(),
    };
  }

  private save(
    settings: RadarBackgroundRefreshPreferencesDto,
  ): RadarBackgroundRefreshPreferencesDto {
    const saved = this.store.saveRadarBackgroundRefreshSettings(settings);
    this.updated(this.withCapability(saved));
    return saved;
  }

  private withCapability(
    preferences: RadarBackgroundRefreshPreferencesDto,
  ): RadarBackgroundRefreshSettingsDto {
    return {
      ...preferences,
      notificationCapability: this.notifier.capability(),
    };
  }

  private notifyNewReleases(result: RadarRefreshAllResultDto): void {
    const relevant = result.results.filter((item) => item.newlyDiscovered > 0);
    const releases = relevant.reduce(
      (total, item) => total + item.newlyDiscovered,
      0,
    );
    if (releases === 0) return;
    try {
      this.notifier.notifyNewReleases(releases, relevant.length);
    } catch {
      // A platform notification failure must not turn a completed Radar
      // snapshot into a failed or retrying provider operation.
    }
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.clock.clearTimer(this.timer);
    this.timer = undefined;
  }

  private isStopped(): boolean {
    return this.stopped;
  }
}
