import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import { millisecondsFrom } from '../utils/time.js';
import type { HostResourceNotifier } from '../telegram-admin/notifier.js';
export type { HostResourceNotifier };

const STATE_ID = 'host_resource';
const MONITOR_LEASE_MS = 60 * 1_000;

export interface CpuSnapshot {
  idle: number;
  total: number;
}

export function getCpuSnapshot(): CpuSnapshot {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      total += cpu.times[type as keyof typeof cpu.times];
    }
    idle += cpu.times.idle;
  }
  return { idle, total };
}

export function calculateCpuUsage(start: CpuSnapshot, end: CpuSnapshot): number {
  const idleDiff = end.idle - start.idle;
  const totalDiff = end.total - start.total;
  if (totalDiff <= 0) return 0;
  const usage = (1 - idleDiff / totalDiff) * 100;
  return Math.max(0, Math.min(100, Math.round(usage * 10) / 10));
}

export function getMemoryMetrics() {
  const totalBytes = os.totalmem();
  const freeBytes = os.freemem();
  const usedBytes = totalBytes - freeBytes;
  const memoryPercent = Math.max(
    0,
    Math.min(100, Math.round((usedBytes / totalBytes) * 1000) / 10),
  );
  const memoryUsedMb = Math.round(usedBytes / (1024 * 1024));
  const memoryTotalMb = Math.round(totalBytes / (1024 * 1024));
  const processMemoryMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
  return {
    memoryPercent,
    memoryUsedMb,
    memoryTotalMb,
    processMemoryMb,
  };
}

export interface HostMetrics {
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  processMemoryMb: number;
}

export interface HostResourceStatus extends HostMetrics {
  continuousHighUsageSince: string | null;
  continuousHighUsageMinutes: number;
  isOverloaded: boolean;
  thresholdPercent: number;
  overloadDurationHours: number;
  lastCheckedAt: string | null;
}

export class HostResourceMonitor {
  private lastCpuSnapshot: CpuSnapshot | null = null;
  private lastSampleTime = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly notifier: HostResourceNotifier,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async sampleMetrics(quickWindowMs = 100): Promise<HostMetrics> {
    const memory = getMemoryMetrics();
    const now = Date.now();
    let cpuPercent = 0;

    if (this.lastCpuSnapshot && now - this.lastSampleTime < 30_000) {
      const current = getCpuSnapshot();
      cpuPercent = calculateCpuUsage(this.lastCpuSnapshot, current);
      this.lastCpuSnapshot = current;
      this.lastSampleTime = now;
    } else {
      const start = getCpuSnapshot();
      await delay(quickWindowMs);
      const end = getCpuSnapshot();
      cpuPercent = calculateCpuUsage(start, end);
      this.lastCpuSnapshot = end;
      this.lastSampleTime = Date.now();
    }

    return {
      cpuPercent,
      ...memory,
    };
  }

  async runCheckIfDue(workerId: string): Promise<boolean> {
    await this.#ensureState();
    const now = new Date();
    const claimed = await this.prisma.hostResourceMonitorState.updateMany({
      where: {
        id: STATE_ID,
        nextCheckAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        leaseOwner: workerId,
        leaseExpiresAt: millisecondsFrom(now, MONITOR_LEASE_MS),
      },
    });
    if (claimed.count !== 1) return false;

    try {
      const metrics = await this.sampleMetrics();
      const existing = await this.prisma.hostResourceMonitorState.findUniqueOrThrow({
        where: { id: STATE_ID },
      });

      const threshold = this.config.hostMonitor.thresholdPercent;
      const isHighUsage = metrics.cpuPercent >= threshold || metrics.memoryPercent >= threshold;

      let highUsageStartedAt = existing.highUsageStartedAt;
      let continuousMinutes = 0;
      let isOverloaded = false;
      let lastAlertSentAt = existing.lastOverloadAlertAt;

      const overloadDurationMinutes = this.config.hostMonitor.overloadDurationHours * 60;
      const alertCooldownMs = this.config.hostMonitor.alertCooldownHours * 3_600_000;

      if (isHighUsage) {
        if (!highUsageStartedAt) {
          highUsageStartedAt = now;
        }
        continuousMinutes = Math.max(
          1,
          Math.floor((now.getTime() - highUsageStartedAt.getTime()) / 60_000),
        );

        if (continuousMinutes >= overloadDurationMinutes) {
          isOverloaded = true;

          const cooldownExpired =
            !lastAlertSentAt || now.getTime() - lastAlertSentAt.getTime() >= alertCooldownMs;

          if (cooldownExpired) {
            try {
              await this.notifier.hostResourceOverloaded({
                cpuPercent: metrics.cpuPercent,
                memoryPercent: metrics.memoryPercent,
                durationHours: this.config.hostMonitor.overloadDurationHours,
              });
              lastAlertSentAt = now;
              this.logger.warn(
                {
                  metrics,
                  continuousMinutes,
                  overloadDurationMinutes,
                },
                'host resource overload alert sent to admins',
              );
            } catch (alertError) {
              this.logger.error({ err: alertError }, 'failed to send host overload notification');
            }
          }
        }
      } else {
        highUsageStartedAt = null;
        continuousMinutes = 0;
        isOverloaded = false;
      }

      await this.prisma.hostResourceMonitorState.updateMany({
        where: { id: STATE_ID, leaseOwner: workerId },
        data: {
          lastCheckedAt: now,
          cpuPercent: metrics.cpuPercent,
          memoryPercent: metrics.memoryPercent,
          memoryUsedMb: metrics.memoryUsedMb,
          memoryTotalMb: metrics.memoryTotalMb,
          processMemoryMb: metrics.processMemoryMb,
          highUsageStartedAt,
          continuousHighUsageMinutes: continuousMinutes,
          isOverloaded,
          lastOverloadAlertAt: lastAlertSentAt,
          nextCheckAt: millisecondsFrom(now, this.config.hostMonitor.checkIntervalMs),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });

      return true;
    } catch (error) {
      await this.prisma.hostResourceMonitorState.updateMany({
        where: { id: STATE_ID, leaseOwner: workerId },
        data: {
          nextCheckAt: millisecondsFrom(now, 15_000),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      throw error;
    }
  }

  async getStatus(): Promise<HostResourceStatus> {
    await this.#ensureState();
    const [liveMetrics, state] = await Promise.all([
      this.sampleMetrics(),
      this.prisma.hostResourceMonitorState.findUnique({ where: { id: STATE_ID } }),
    ]);

    const threshold = this.config.hostMonitor.thresholdPercent;
    const isLiveHigh =
      liveMetrics.cpuPercent >= threshold || liveMetrics.memoryPercent >= threshold;

    let continuousMinutes = state?.continuousHighUsageMinutes ?? 0;
    let highUsageSince = state?.highUsageStartedAt ? state.highUsageStartedAt.toISOString() : null;
    let isOverloaded = state?.isOverloaded ?? false;

    if (isLiveHigh && !highUsageSince) {
      highUsageSince = new Date().toISOString();
      continuousMinutes = 1;
    }

    return {
      cpuPercent: liveMetrics.cpuPercent,
      memoryPercent: liveMetrics.memoryPercent,
      memoryUsedMb: liveMetrics.memoryUsedMb,
      memoryTotalMb: liveMetrics.memoryTotalMb,
      processMemoryMb: liveMetrics.processMemoryMb,
      continuousHighUsageSince: highUsageSince,
      continuousHighUsageMinutes: continuousMinutes,
      isOverloaded,
      thresholdPercent: threshold,
      overloadDurationHours: this.config.hostMonitor.overloadDurationHours,
      lastCheckedAt: state?.lastCheckedAt ? state.lastCheckedAt.toISOString() : null,
    };
  }

  async #ensureState(): Promise<void> {
    await this.prisma.hostResourceMonitorState.upsert({
      where: { id: STATE_ID },
      create: { id: STATE_ID },
      update: {},
    });
  }
}
