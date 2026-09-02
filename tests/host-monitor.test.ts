import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  calculateCpuUsage,
  getMemoryMetrics,
  HostResourceMonitor,
  type HostResourceNotifier,
  type CpuSnapshot,
} from '../src/observability/host-monitor.js';
import { silentLogger, testConfig } from './helpers.js';

describe('HostResourceMonitor', () => {
  const config = testConfig({
    HOST_MONITOR_THRESHOLD_PERCENT: '80',
    HOST_MONITOR_OVERLOAD_DURATION_HOURS: '2',
    HOST_MONITOR_CHECK_INTERVAL_MS: '60000',
    HOST_MONITOR_ALERT_COOLDOWN_HOURS: '6',
  });

  it('calculates CPU usage percentage accurately from snapshots', () => {
    const start: CpuSnapshot = { idle: 1000, total: 2000 };
    // idle increased by 200, total increased by 1000 -> usage = (1 - 200/1000)*100 = 80%
    const end: CpuSnapshot = { idle: 1200, total: 3000 };
    const usage = calculateCpuUsage(start, end);
    expect(usage).toBe(80);
  });

  it('calculates memory metrics within valid bounds', () => {
    const metrics = getMemoryMetrics();
    expect(metrics.memoryPercent).toBeGreaterThanOrEqual(0);
    expect(metrics.memoryPercent).toBeLessThanOrEqual(100);
    expect(metrics.memoryTotalMb).toBeGreaterThan(0);
    expect(metrics.memoryUsedMb).toBeGreaterThan(0);
    expect(metrics.processMemoryMb).toBeGreaterThan(0);
  });

  it('detects high usage and alerts when sustained over 2 hours', async () => {
    let state = {
      id: 'host_resource',
      nextCheckAt: new Date(Date.now() - 10_000),
      leaseOwner: null as string | null,
      leaseExpiresAt: null as Date | null,
      lastCheckedAt: null as Date | null,
      cpuPercent: 0,
      memoryPercent: 0,
      memoryUsedMb: 0,
      memoryTotalMb: 0,
      processMemoryMb: 0,
      highUsageStartedAt: null as Date | null,
      continuousHighUsageMinutes: 0,
      isOverloaded: false,
      lastOverloadAlertAt: null as Date | null,
    };

    const mockPrisma: Partial<PrismaClient> = {
      hostResourceMonitorState: {
        upsert: vi.fn().mockResolvedValue(state),
        updateMany: vi.fn().mockImplementation((args: { data: Partial<typeof state> }) => {
          Object.assign(state, args.data);
          return { count: 1 };
        }),
        findUniqueOrThrow: vi.fn().mockImplementation(() => state),
        findUnique: vi.fn().mockImplementation(() => state),
      } as unknown as PrismaClient['hostResourceMonitorState'],
    };

    const mockNotifier: HostResourceNotifier = {
      hostResourceOverloaded: vi.fn().mockResolvedValue(undefined),
    };

    const monitor = new HostResourceMonitor(
      mockPrisma as PrismaClient,
      mockNotifier,
      config,
      silentLogger,
    );

    // Mock sampleMetrics to simulate 85% CPU usage
    vi.spyOn(monitor, 'sampleMetrics').mockResolvedValue({
      cpuPercent: 85,
      memoryPercent: 60,
      memoryUsedMb: 1200,
      memoryTotalMb: 2000,
      processMemoryMb: 80,
    });

    // Check 1: High usage starts now (continuous minutes = 1)
    await monitor.runCheckIfDue('worker-1');
    expect(state.highUsageStartedAt).not.toBeNull();
    expect(state.continuousHighUsageMinutes).toBe(1);
    expect(state.isOverloaded).toBe(false);
    expect(mockNotifier.hostResourceOverloaded).not.toHaveBeenCalled();

    // Fast-forward: Set highUsageStartedAt to 2.5 hours ago (150 minutes ago)
    state.highUsageStartedAt = new Date(Date.now() - 150 * 60 * 1000);
    state.nextCheckAt = new Date(Date.now() - 10_000);

    // Check 2: Should trigger alert and set isOverloaded = true (Red Flag)
    await monitor.runCheckIfDue('worker-1');
    expect(state.isOverloaded).toBe(true);
    expect(state.continuousHighUsageMinutes).toBe(150);
    expect(mockNotifier.hostResourceOverloaded).toHaveBeenCalledTimes(1);
    expect(mockNotifier.hostResourceOverloaded).toHaveBeenCalledWith({
      cpuPercent: 85,
      memoryPercent: 60,
      durationHours: 2,
    });

    // Check 3: Check again within cooldown period -> should NOT send another alert
    state.nextCheckAt = new Date(Date.now() - 10_000);
    await monitor.runCheckIfDue('worker-1');
    expect(mockNotifier.hostResourceOverloaded).toHaveBeenCalledTimes(1);
    expect(state.isOverloaded).toBe(true);

    // Check 4: Usage drops below 80% (recovery)
    vi.spyOn(monitor, 'sampleMetrics').mockResolvedValue({
      cpuPercent: 40,
      memoryPercent: 50,
      memoryUsedMb: 1000,
      memoryTotalMb: 2000,
      processMemoryMb: 80,
    });
    state.nextCheckAt = new Date(Date.now() - 10_000);
    await monitor.runCheckIfDue('worker-1');
    expect(state.isOverloaded).toBe(false);
    expect(state.highUsageStartedAt).toBeNull();
    expect(state.continuousHighUsageMinutes).toBe(0);
  });
});
