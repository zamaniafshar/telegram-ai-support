import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { HostResourceNotifier } from '../telegram-admin/notifier.js';
export type { HostResourceNotifier };
export interface CpuSnapshot {
    idle: number;
    total: number;
}
export declare function getCpuSnapshot(): CpuSnapshot;
export declare function calculateCpuUsage(start: CpuSnapshot, end: CpuSnapshot): number;
export declare function getMemoryMetrics(): {
    memoryPercent: number;
    memoryUsedMb: number;
    memoryTotalMb: number;
    processMemoryMb: number;
};
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
export declare class HostResourceMonitor {
    #private;
    private readonly prisma;
    private readonly notifier;
    private readonly config;
    private readonly logger;
    private lastCpuSnapshot;
    private lastSampleTime;
    constructor(prisma: PrismaClient, notifier: HostResourceNotifier, config: AppConfig, logger: Logger);
    sampleMetrics(quickWindowMs?: number): Promise<HostMetrics>;
    runCheckIfDue(workerId: string): Promise<boolean>;
    getStatus(): Promise<HostResourceStatus>;
}
