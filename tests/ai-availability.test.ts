import { describe, expect, it, vi } from 'vitest';
import {
  AiAvailabilityService,
  defaultWeeklySchedule,
  scheduleAllows,
  validateWeeklySchedule,
  type WeeklySchedule,
} from '../src/ai/availability.js';

function closedWeek(): WeeklySchedule {
  return defaultWeeklySchedule().map((day) => ({
    ...day,
    enabled: false,
    allDay: false,
  }));
}

function setDay(
  schedule: WeeklySchedule,
  day: WeeklySchedule[number]['day'],
  intervals: WeeklySchedule[number]['intervals'],
): WeeklySchedule {
  return schedule.map((item) =>
    item.day === day ? { ...item, enabled: true, allDay: false, intervals } : item,
  );
}

describe('AI weekly availability', () => {
  it('defaults to 24 hours a day, seven days a week', () => {
    expect(
      scheduleAllows(defaultWeeklySchedule(), 'Asia/Tehran', new Date('2026-08-15T12:00:00Z')),
    ).toBe(true);
  });

  it('uses inclusive opening and exclusive closing boundaries', () => {
    const schedule = setDay(closedWeek(), 'SATURDAY', [
      { start: '06:00', end: '10:00', overnight: false },
    ]);
    expect(scheduleAllows(schedule, 'Asia/Tehran', new Date('2026-08-15T02:30:00Z'))).toBe(true);
    expect(scheduleAllows(schedule, 'Asia/Tehran', new Date('2026-08-15T06:29:00Z'))).toBe(true);
    expect(scheduleAllows(schedule, 'Asia/Tehran', new Date('2026-08-15T06:30:00Z'))).toBe(false);
  });

  it('carries an explicit 06:00–01:00 overnight interval into the following day', () => {
    const schedule = setDay(closedWeek(), 'SATURDAY', [
      { start: '06:00', end: '01:00', overnight: true },
    ]);
    expect(scheduleAllows(schedule, 'Asia/Tehran', new Date('2026-08-15T20:00:00Z'))).toBe(true);
    expect(scheduleAllows(schedule, 'Asia/Tehran', new Date('2026-08-15T21:29:00Z'))).toBe(true);
    expect(scheduleAllows(schedule, 'Asia/Tehran', new Date('2026-08-15T21:30:00Z'))).toBe(false);
  });

  it('supports multiple non-overlapping intervals and disabled days', () => {
    const schedule = setDay(closedWeek(), 'MONDAY', [
      { start: '08:00', end: '12:00', overnight: false },
      { start: '14:00', end: '18:00', overnight: false },
    ]);
    expect(scheduleAllows(schedule, 'UTC', new Date('2026-08-17T09:00:00Z'))).toBe(true);
    expect(scheduleAllows(schedule, 'UTC', new Date('2026-08-17T13:00:00Z'))).toBe(false);
    expect(scheduleAllows(schedule, 'UTC', new Date('2026-08-18T09:00:00Z'))).toBe(false);
  });

  it('rejects invalid times, ambiguous overnight flags, and same/cross-day overlaps', () => {
    expect(() =>
      validateWeeklySchedule(
        setDay(closedWeek(), 'MONDAY', [{ start: '25:00', end: '26:00', overnight: false }]),
      ),
    ).toThrow();
    expect(() =>
      validateWeeklySchedule(
        setDay(closedWeek(), 'MONDAY', [{ start: '18:00', end: '08:00', overnight: false }]),
      ),
    ).toThrow();
    expect(() =>
      validateWeeklySchedule(
        setDay(closedWeek(), 'MONDAY', [
          { start: '08:00', end: '12:00', overnight: false },
          { start: '11:00', end: '13:00', overnight: false },
        ]),
      ),
    ).toThrow();
    const crossDay = setDay(
      setDay(closedWeek(), 'SATURDAY', [{ start: '22:00', end: '02:00', overnight: true }]),
      'SUNDAY',
      [{ start: '01:00', end: '03:00', overnight: false }],
    );
    expect(() => validateWeeklySchedule(crossDay)).toThrow();
  });

  it('handles week, month, and year transitions as absolute instants', () => {
    const week = setDay(closedWeek(), 'FRIDAY', [
      { start: '23:00', end: '01:00', overnight: true },
    ]);
    expect(scheduleAllows(week, 'UTC', new Date('2027-01-01T23:30:00Z'))).toBe(true);
    expect(scheduleAllows(week, 'UTC', new Date('2027-01-02T00:59:00Z'))).toBe(true);
    expect(scheduleAllows(week, 'UTC', new Date('2027-01-02T01:00:00Z'))).toBe(false);
  });

  it('evaluates the same instant differently by business timezone', () => {
    const schedule = setDay(closedWeek(), 'SATURDAY', [
      { start: '08:00', end: '09:00', overnight: false },
    ]);
    const instant = new Date('2026-08-15T08:30:00Z');
    expect(scheduleAllows(schedule, 'UTC', instant)).toBe(true);
    expect(scheduleAllows(schedule, 'Asia/Tehran', instant)).toBe(false);
  });

  it('uses IANA daylight-saving rules during the spring-forward transition', () => {
    const schedule = setDay(closedWeek(), 'SUNDAY', [
      { start: '01:00', end: '04:00', overnight: false },
    ]);
    expect(scheduleAllows(schedule, 'America/New_York', new Date('2026-03-08T06:30:00Z'))).toBe(
      true,
    );
    expect(scheduleAllows(schedule, 'America/New_York', new Date('2026-03-08T07:30:00Z'))).toBe(
      true,
    );
    expect(scheduleAllows(schedule, 'America/New_York', new Date('2026-03-08T08:00:00Z'))).toBe(
      false,
    );
  });
});

describe('AI availability precedence and consistency', () => {
  it('re-reads the master state from the database for every check', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({
        enabled: true,
        timezone: 'UTC',
        weeklySchedule: defaultWeeklySchedule(),
      })
      .mockResolvedValueOnce({
        enabled: false,
        timezone: 'UTC',
        weeklySchedule: defaultWeeklySchedule(),
      });
    const service = new AiAvailabilityService(
      { businessAiSettings: { findUnique } } as never,
      'UTC',
    );
    expect((await service.check({ businessAccountId: 'business-1' })).reason).toBe('AVAILABLE');
    expect((await service.check({ businessAccountId: 'business-1' })).reason).toBe(
      'MASTER_DISABLED',
    );
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('lets the master switch override an otherwise-open schedule', async () => {
    const prisma = {
      businessAiSettings: {
        findUnique: vi.fn().mockResolvedValue({
          enabled: false,
          timezone: 'UTC',
          weeklySchedule: defaultWeeklySchedule(),
        }),
      },
    };
    const result = await new AiAvailabilityService(prisma as never, 'UTC').check({
      businessAccountId: 'business-1',
    });
    expect(result).toMatchObject({ available: false, reason: 'MASTER_DISABLED' });
  });
});
