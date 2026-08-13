import { ConversationMode, type Prisma, type PrismaClient } from '@prisma/client';
import { ValidationError } from '../utils/errors.js';

export const WEEKDAYS = [
  'SATURDAY',
  'SUNDAY',
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
] as const;
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

export type AiAvailabilityReason =
  | 'AVAILABLE'
  | 'MASTER_DISABLED'
  | 'OUTSIDE_WORKING_HOURS'
  | 'HUMAN_MODE'
  | 'CONNECTION_DISABLED'
  | 'CAN_REPLY_MISSING'
  | 'TELEGRAM_REPLY_WINDOW_EXPIRED';

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

const jsDayByName: Record<Weekday, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};
const nameByJsDay = Object.fromEntries(
  Object.entries(jsDayByName).map(([name, day]) => [day, name]),
) as Record<number, Weekday>;

export function defaultWeeklySchedule(): WeeklySchedule {
  return WEEKDAYS.map((day) => ({ day, enabled: true, allDay: true, intervals: [] }));
}

export function validIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
    return timezone.includes('/');
  } catch {
    return false;
  }
}

function minuteOfDay(value: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ValidationError('Time must use HH:mm', 'INVALID_AI_SCHEDULE_TIME');
  }
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

export function validateWeeklySchedule(schedule: WeeklySchedule): WeeklySchedule {
  if (!Array.isArray(schedule) || schedule.length !== 7) {
    throw new ValidationError('All seven weekdays are required', 'INVALID_AI_SCHEDULE');
  }
  if (new Set(schedule.map((item) => item.day)).size !== 7) {
    throw new ValidationError('Each weekday must occur once', 'INVALID_AI_SCHEDULE');
  }
  const spans: { start: number; end: number; day: Weekday }[] = [];
  for (const item of schedule) {
    if (!WEEKDAYS.includes(item.day)) {
      throw new ValidationError('Unknown weekday', 'INVALID_AI_SCHEDULE');
    }
    if (!item.enabled && (item.allDay || item.intervals.length > 0)) {
      throw new ValidationError('Disabled days cannot contain hours', 'INVALID_AI_SCHEDULE');
    }
    if (item.allDay && item.intervals.length > 0) {
      throw new ValidationError('24-hour days cannot contain intervals', 'INVALID_AI_SCHEDULE');
    }
    if (item.enabled && !item.allDay && item.intervals.length === 0) {
      throw new ValidationError('Enabled days require hours', 'INVALID_AI_SCHEDULE');
    }
    const base = jsDayByName[item.day] * 1_440;
    if (item.enabled && item.allDay) spans.push({ start: base, end: base + 1_440, day: item.day });
    for (const interval of item.intervals) {
      const start = minuteOfDay(interval.start);
      const end = minuteOfDay(interval.end);
      if (start === end) {
        throw new ValidationError('Use the 24-hour option for a full day', 'INVALID_AI_SCHEDULE');
      }
      if (interval.overnight !== end < start) {
        throw new ValidationError(
          'Overnight intervals must be marked explicitly',
          'INVALID_AI_SCHEDULE_OVERNIGHT',
        );
      }
      spans.push({
        start: base + start,
        end: base + (interval.overnight ? 1_440 + end : end),
        day: item.day,
      });
    }
  }
  const week = 7 * 1_440;
  const normalized = spans.flatMap((span) => {
    if (span.end <= week) return [span];
    return [
      { ...span, end: week },
      { ...span, start: 0, end: span.end - week },
    ];
  });
  normalized.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (previous && current && current.start < previous.end) {
      throw new ValidationError(
        `Schedule intervals overlap near ${current.day}`,
        'AI_SCHEDULE_OVERLAP',
      );
    }
  }
  return schedule;
}

interface LocalParts {
  weekday: Weekday;
  minute: number;
}

function localParts(at: Date, timezone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, Weekday> = {
    Sun: 'SUNDAY',
    Mon: 'MONDAY',
    Tue: 'TUESDAY',
    Wed: 'WEDNESDAY',
    Thu: 'THURSDAY',
    Fri: 'FRIDAY',
    Sat: 'SATURDAY',
  };
  return {
    weekday: weekdayMap[value['weekday'] ?? ''] ?? 'SATURDAY',
    minute: (Number(value['hour']) % 24) * 60 + Number(value['minute']),
  };
}

export function scheduleAllows(schedule: WeeklySchedule, timezone: string, at: Date): boolean {
  const local = localParts(at, timezone);
  const today = schedule.find((item) => item.day === local.weekday);
  if (today?.enabled && today.allDay) return true;
  if (
    today?.enabled &&
    today.intervals.some((interval) => {
      const start = minuteOfDay(interval.start);
      const end = minuteOfDay(interval.end);
      return interval.overnight
        ? local.minute >= start
        : local.minute >= start && local.minute < end;
    })
  ) {
    return true;
  }
  const previousDayNumber = (jsDayByName[local.weekday] + 6) % 7;
  const previous = schedule.find((item) => item.day === nameByJsDay[previousDayNumber]);
  return Boolean(
    previous?.enabled &&
    !previous.allDay &&
    previous.intervals.some(
      (interval) => interval.overnight && local.minute < minuteOfDay(interval.end),
    ),
  );
}

function parseSchedule(value: Prisma.JsonValue | null | undefined): WeeklySchedule {
  if (!value) return defaultWeeklySchedule();
  return validateWeeklySchedule(value as unknown as WeeklySchedule);
}

export class AiAvailabilityService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly defaultTimezone: string,
  ) {}

  async businessSettings(businessAccountId: string): Promise<BusinessAiSettingsValue> {
    const settings = await this.prisma.businessAiSettings.findUnique({
      where: { businessAccountId },
    });
    return {
      enabled: settings?.enabled ?? true,
      timezone: settings?.timezone ?? this.defaultTimezone,
      weeklySchedule: parseSchedule(settings?.weeklySchedule),
      outsideHoursPolicy: (settings?.outsideHoursPolicy as QueuePolicy | undefined) ?? 'QUEUE',
      manualShutdownPolicy: (settings?.manualShutdownPolicy as QueuePolicy | undefined) ?? 'QUEUE',
      backlogMaxAgeHours: settings?.backlogMaxAgeHours ?? 24,
    };
  }

  async check(input: {
    businessAccountId: string;
    conversationId?: string;
    now?: Date;
    includeTelegramChecks?: boolean;
  }): Promise<AiAvailabilityResult> {
    const now = input.now ?? new Date();
    const settings = await this.businessSettings(input.businessAccountId);
    let reason: AiAvailabilityReason = 'AVAILABLE';
    if (!settings.enabled) reason = 'MASTER_DISABLED';
    else if (!scheduleAllows(settings.weeklySchedule, settings.timezone, now)) {
      reason = 'OUTSIDE_WORKING_HOURS';
    } else if (input.conversationId) {
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: input.conversationId, businessAccountId: input.businessAccountId },
        include: {
          businessAccount: {
            include: { connections: { orderBy: { updatedAt: 'desc' }, take: 1 } },
          },
        },
      });
      if (conversation && conversation.mode !== ConversationMode.AI) reason = 'HUMAN_MODE';
      else if (conversation && input.includeTelegramChecks) {
        const connection = conversation.businessAccount.connections[0];
        if (!connection?.enabled) reason = 'CONNECTION_DISABLED';
        else if (!connection.canReply) reason = 'CAN_REPLY_MISSING';
        else if (
          !conversation.telegramReplyWindowExpiresAt ||
          conversation.telegramReplyWindowExpiresAt <= now
        ) {
          reason = 'TELEGRAM_REPLY_WINDOW_EXPIRED';
        }
      }
    }
    const scheduleAvailable = settings.enabled
      ? scheduleAllows(settings.weeklySchedule, settings.timezone, now)
      : false;
    const next = this.#nextScheduleTransition(settings, now, scheduleAvailable);
    return {
      available: reason === 'AVAILABLE',
      reason,
      timezone: settings.timezone,
      evaluatedAt: now,
      nextTransitionAt: next,
      nextTransitionReason: next ? (scheduleAvailable ? 'DEACTIVATES' : 'ACTIVATES') : null,
    };
  }

  #nextScheduleTransition(
    settings: BusinessAiSettingsValue,
    now: Date,
    current: boolean,
  ): Date | null {
    if (!settings.enabled) return null;
    if (settings.weeklySchedule.every((day) => day.enabled && day.allDay)) return null;
    if (settings.weeklySchedule.every((day) => !day.enabled)) return null;
    const cursor = new Date(now);
    cursor.setUTCSeconds(0, 0);
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    for (let index = 0; index <= 8 * 24 * 60; index += 1) {
      if (scheduleAllows(settings.weeklySchedule, settings.timezone, cursor) !== current) {
        return new Date(cursor);
      }
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
    }
    return null;
  }
}
