import { type PrismaClient } from '@prisma/client';
export declare const WEEKDAYS: readonly ["SATURDAY", "SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"];
export type Weekday = (typeof WEEKDAYS)[number];
export interface ScheduleInterval {
    start: string;
    end: string;
    overnight: boolean;
}
export interface DaySchedule {
    day: Weekday;
    enabled: boolean;
    allDay: boolean;
    intervals: ScheduleInterval[];
}
export type WeeklySchedule = DaySchedule[];
export type QueuePolicy = 'QUEUE' | 'HANDOFF' | 'SILENT';
export type OutsideHoursPolicy = QueuePolicy;
export type AiAvailabilityReason = 'AVAILABLE' | 'MASTER_DISABLED' | 'OUTSIDE_WORKING_HOURS' | 'HUMAN_MODE' | 'CONNECTION_DISABLED' | 'CAN_REPLY_MISSING' | 'TELEGRAM_REPLY_WINDOW_EXPIRED';
export interface AiAvailabilityResult {
    available: boolean;
    reason: AiAvailabilityReason;
    timezone: string;
    evaluatedAt: Date;
    nextTransitionAt: Date | null;
    nextTransitionReason: 'ACTIVATES' | 'DEACTIVATES' | null;
}
export interface BusinessAiSettingsValue {
    enabled: boolean;
    timezone: string;
    weeklySchedule: WeeklySchedule;
    outsideHoursPolicy: OutsideHoursPolicy;
    manualShutdownPolicy: QueuePolicy;
    backlogMaxAgeHours: number;
}
export declare function defaultWeeklySchedule(): WeeklySchedule;
export declare function validIanaTimezone(timezone: string): boolean;
export declare function validateWeeklySchedule(schedule: WeeklySchedule): WeeklySchedule;
export declare function scheduleAllows(schedule: WeeklySchedule, timezone: string, at: Date): boolean;
export declare class AiAvailabilityService {
    #private;
    private readonly prisma;
    private readonly defaultTimezone;
    constructor(prisma: PrismaClient, defaultTimezone: string);
    businessSettings(businessAccountId: string): Promise<BusinessAiSettingsValue>;
    check(input: {
        businessAccountId: string;
        conversationId?: string;
        now?: Date;
        includeTelegramChecks?: boolean;
    }): Promise<AiAvailabilityResult>;
}
