import { describe, expect, it, vi } from "vitest";

import type {
  RadarBackgroundRefreshSettingsDto,
  RadarRefreshAllResultDto,
} from "../../shared/contracts/api";
import {
  RadarBackgroundRefresh,
  radarBackgroundDelays,
} from "./radar-background-refresh";

const initial: RadarBackgroundRefreshSettingsDto = {
  enabled: true,
  pauseOnBattery: true,
  nextRefreshAt: null,
  lastCheckedAt: null,
  lastSuccessfulRefreshAt: null,
  lastOutcome: null,
  lastCompleted: 0,
  lastSucceeded: 0,
  lastFailed: 0,
};

function harness(
  result: RadarRefreshAllResultDto | undefined = {
    totalFavorites: 2,
    completed: 2,
    successful: 2,
    failed: 0,
    cancelled: false,
    results: [],
    failures: [],
  },
) {
  let settings = initial;
  let now = new Date("2026-07-28T09:00:00.000Z");
  let callback: (() => void) | undefined;
  let delay = -1;
  const save = vi.fn((next: RadarBackgroundRefreshSettingsDto) => {
    settings = next;
    return settings;
  });
  const refreshAllIfIdle = vi.fn<
    () => Promise<RadarRefreshAllResultDto | undefined>
  >(() => Promise.resolve(result));
  const environment = {
    isOnline: vi.fn(() => true),
    isOnBatteryPower: vi.fn(() => false),
  };
  const updated = vi.fn();
  const service = new RadarBackgroundRefresh(
    {
      getRadarBackgroundRefreshSettings: () => settings,
      saveRadarBackgroundRefreshSettings: save,
    },
    { refreshAllIfIdle, cancelBackground: vi.fn(() => ({ cancelled: false })) },
    environment,
    vi.fn(),
    updated,
    {
      now: () => now,
      random: () => 0,
      setTimer: (scheduled, scheduledDelay) => {
        callback = scheduled;
        delay = scheduledDelay;
        return scheduled;
      },
      clearTimer: vi.fn(),
    },
  );
  return {
    service,
    save,
    refreshAllIfIdle,
    environment,
    updated,
    settings: () => settings,
    delay: () => delay,
    run: async () => {
      const scheduled = callback;
      if (!scheduled) throw new Error("No Radar timer was scheduled.");
      const savesBeforeRun = save.mock.calls.length;
      now = new Date(now.getTime() + delay);
      scheduled();
      await vi.waitFor(() =>
        expect(save.mock.calls.length).toBeGreaterThan(savesBeforeRun),
      );
    },
  };
}

describe("Radar background refresh scheduling", () => {
  it("persists startup jitter and reuses a future due time after restart", () => {
    const first = harness();
    const scheduled = first.service.start();
    expect(first.delay()).toBe(radarBackgroundDelays.startup.minimum);
    expect(scheduled.nextRefreshAt).toBe("2026-07-28T09:01:00.000Z");
    expect(first.save).toHaveBeenCalledTimes(1);

    first.service.stop();
    const resumed = first.service.start();
    expect(resumed.nextRefreshAt).toBe(scheduled.nextRefreshAt);
    expect(first.save).toHaveBeenCalledTimes(1);
  });

  it("records an offline pause without contacting the provider and retries later", async () => {
    const test = harness();
    test.environment.isOnline.mockReturnValue(false);
    test.service.start();
    await test.run();

    expect(test.refreshAllIfIdle).not.toHaveBeenCalled();
    expect(test.settings()).toMatchObject({
      lastOutcome: "offline",
      lastCheckedAt: "2026-07-28T09:01:00.000Z",
      lastSuccessfulRefreshAt: null,
    });
    expect(test.delay()).toBe(radarBackgroundDelays.retry.minimum);
  });

  it("honors the default battery pause without contacting the provider", async () => {
    const test = harness();
    test.environment.isOnBatteryPower.mockReturnValue(true);
    test.service.start();
    await test.run();

    expect(test.refreshAllIfIdle).not.toHaveBeenCalled();
    expect(test.settings()).toMatchObject({
      lastOutcome: "battery",
      lastSuccessfulRefreshAt: null,
    });
  });

  it("honestly records a complete success and schedules the next daily window", async () => {
    const test = harness();
    test.service.start();
    await test.run();

    expect(test.refreshAllIfIdle).toHaveBeenCalledTimes(1);
    expect(test.settings()).toMatchObject({
      lastOutcome: "success",
      lastCheckedAt: "2026-07-28T09:01:00.000Z",
      lastSuccessfulRefreshAt: "2026-07-28T09:01:00.000Z",
      lastCompleted: 2,
      lastSucceeded: 2,
      lastFailed: 0,
    });
    expect(test.delay()).toBe(radarBackgroundDelays.normal.minimum);
  });

  it("defers rather than interrupting a foreground Radar operation", async () => {
    const test = harness();
    test.refreshAllIfIdle.mockResolvedValueOnce(undefined);
    test.service.start();
    await test.run();

    expect(test.settings()).toMatchObject({
      lastOutcome: "busy",
      lastCompleted: 0,
      lastSucceeded: 0,
      lastFailed: 0,
    });
    expect(test.delay()).toBe(radarBackgroundDelays.retry.minimum);
  });

  it("records partial results without advancing the fully successful time", async () => {
    const test = harness({
      totalFavorites: 2,
      completed: 2,
      successful: 1,
      failed: 1,
      cancelled: false,
      results: [],
      failures: [],
    });
    test.service.start();
    await test.run();

    expect(test.settings()).toMatchObject({
      lastOutcome: "partial",
      lastSuccessfulRefreshAt: null,
      lastCompleted: 2,
      lastSucceeded: 1,
      lastFailed: 1,
    });
    expect(test.delay()).toBe(radarBackgroundDelays.retry.minimum);
  });

  it("disabling clears the durable due time and never starts a check", () => {
    const test = harness();
    test.service.start();
    expect(test.service.updatePreferences(false, false)).toMatchObject({
      enabled: false,
      pauseOnBattery: false,
      nextRefreshAt: null,
    });
    expect(test.refreshAllIfIdle).not.toHaveBeenCalled();
  });
});
