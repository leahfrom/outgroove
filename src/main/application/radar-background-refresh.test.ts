import { describe, expect, it, vi } from "vitest";

import type {
  RadarBackgroundRefreshPreferencesDto,
  RadarNotificationCapabilityDto,
  RadarRefreshAllResultDto,
} from "../../shared/contracts/api";
import {
  RadarBackgroundRefresh,
  radarBackgroundDelays,
} from "./radar-background-refresh";

const initial: RadarBackgroundRefreshPreferencesDto = {
  enabled: true,
  pauseOnBattery: true,
  notificationsEnabled: false,
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
  const save = vi.fn((next: RadarBackgroundRefreshPreferencesDto) => {
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
  const notifier = {
    capability: vi.fn<() => RadarNotificationCapabilityDto>(() => ({
      available: true,
      unavailableReason: null,
    })),
    notifyNewReleases: vi.fn(),
  };
  const service = new RadarBackgroundRefresh(
    {
      getRadarBackgroundRefreshSettings: () => settings,
      saveRadarBackgroundRefreshSettings: save,
    },
    { refreshAllIfIdle, cancelBackground: vi.fn(() => ({ cancelled: false })) },
    environment,
    vi.fn(),
    updated,
    notifier,
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
    notifier,
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
    expect(test.service.updatePreferences(false, false, false)).toMatchObject({
      enabled: false,
      pauseOnBattery: false,
      nextRefreshAt: null,
    });
    expect(test.refreshAllIfIdle).not.toHaveBeenCalled();
  });

  it("notifies only after a complete automatic sweep finds genuinely new releases", async () => {
    const test = harness({
      totalFavorites: 2,
      completed: 2,
      successful: 2,
      failed: 0,
      cancelled: false,
      results: [
        {
          favoriteArtistId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
          favoriteArtistName: "Fixture Artist",
          added: 2,
          newlyDiscovered: 2,
          updated: 0,
          unchanged: 1,
          total: 3,
          source: "network",
          providerFetchedAt: "2026-07-28T08:00:00.000Z",
          refreshedAt: "2026-07-28T09:00:00.000Z",
          truncated: false,
        },
        {
          favoriteArtistId: "1f5053fe-7aab-4ca8-861b-4ed97bc69f91",
          favoriteArtistName: "Baseline Artist",
          added: 4,
          newlyDiscovered: 0,
          updated: 0,
          unchanged: 0,
          total: 4,
          source: "cache",
          providerFetchedAt: "2026-07-28T08:00:00.000Z",
          refreshedAt: "2026-07-28T09:00:00.000Z",
          truncated: false,
        },
      ],
      failures: [],
    });
    test.service.start();
    test.service.updatePreferences(true, true, true);
    await test.run();

    expect(test.notifier.notifyNewReleases).toHaveBeenCalledWith(2, 1);
  });

  it("does not notify for a partial sweep or when no new release was discovered", async () => {
    const test = harness({
      totalFavorites: 1,
      completed: 1,
      successful: 1,
      failed: 0,
      cancelled: false,
      results: [
        {
          favoriteArtistId: "6fdf7677-0e73-4f9a-85fd-6612ef381bdf",
          favoriteArtistName: "Fixture Artist",
          added: 3,
          newlyDiscovered: 0,
          updated: 0,
          unchanged: 0,
          total: 3,
          source: "network",
          providerFetchedAt: "2026-07-28T08:00:00.000Z",
          refreshedAt: "2026-07-28T09:00:00.000Z",
          truncated: false,
        },
      ],
      failures: [],
    });
    test.service.start();
    test.service.updatePreferences(true, true, true);
    await test.run();

    expect(test.notifier.notifyNewReleases).not.toHaveBeenCalled();
  });

  it("rejects enabling notifications when this build has no platform identity", () => {
    const test = harness();
    test.notifier.capability.mockReturnValue({
      available: false,
      unavailableReason: "unsigned-macos-build",
    });
    expect(() => test.service.updatePreferences(true, true, true)).toThrow(
      /unavailable/iu,
    );
    expect(test.settings().notificationsEnabled).toBe(false);
  });
});
