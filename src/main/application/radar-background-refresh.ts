import type {
  RadarBackgroundRefreshOutcome,
  RadarBackgroundRefreshSettingsDto,
  RadarRefreshAllResultDto,
} from "../../shared/contracts/api";

interface RadarBackgroundSettingsStore {
  getRadarBackgroundRefreshSettings(): RadarBackgroundRefreshSettingsDto;
  saveRadarBackgroundRefreshSettings(
    settings: RadarBackgroundRefreshSettingsDto,
  ): RadarBackgroundRefreshSettingsDto;
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
    private readonly clock: RadarBackgroundClock = defaultClock,
  ) {}

  start(): RadarBackgroundRefreshSettingsDto {
    this.stopped = false;
    const current = this.store.getRadarBackgroundRefreshSettings();
    if (!current.enabled) return current;
    return this.scheduleExistingOrStartup(current);
  }

  stop(): void {
    this.stopped = true;
    this.clearTimer();
    this.radar.cancelBackground();
  }

  getSettings(): RadarBackgroundRefreshSettingsDto {
    return this.store.getRadarBackgroundRefreshSettings();
  }

  updatePreferences(
    enabled: boolean,
    pauseOnBattery: boolean,
  ): RadarBackgroundRefreshSettingsDto {
    this.clearTimer();
    const current = this.store.getRadarBackgroundRefreshSettings();
    const next =
      enabled && current.enabled && current.nextRefreshAt
        ? current
        : enabled
          ? this.withNext(current, "startup")
          : { ...current, nextRefreshAt: null };
    const saved = this.save({ ...next, enabled, pauseOnBattery });
    if (!enabled) this.radar.cancelBackground();
    else if (!this.stopped) this.arm(saved);
    return saved;
  }

  private scheduleExistingOrStartup(
    current: RadarBackgroundRefreshSettingsDto,
  ): RadarBackgroundRefreshSettingsDto {
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

  private arm(settings: RadarBackgroundRefreshSettingsDto): void {
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
    this.arm(saved);
  }

  private recordCheck(
    current: RadarBackgroundRefreshSettingsDto,
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
    settings: RadarBackgroundRefreshSettingsDto,
    delay: keyof typeof radarBackgroundDelays,
  ): RadarBackgroundRefreshSettingsDto {
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
    settings: RadarBackgroundRefreshSettingsDto,
  ): RadarBackgroundRefreshSettingsDto {
    const saved = this.store.saveRadarBackgroundRefreshSettings(settings);
    this.updated(saved);
    return saved;
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
