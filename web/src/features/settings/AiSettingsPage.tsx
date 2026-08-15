import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, jsonBody, request } from '../../core/api';
import { formatDate } from '../../core/format';
import { Badge, Button, Card, Dialog, PageHeader, QueryState } from '../../components/ui';
import { useSession } from '../../app/SessionProvider';
import { useToast } from '../../app/ToastProvider';

type Weekday = 'SATURDAY' | 'SUNDAY' | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY';
interface Interval {
  start: string;
  end: string;
  overnight: boolean;
}
interface DaySchedule {
  day: Weekday;
  enabled: boolean;
  allDay: boolean;
  intervals: Interval[];
}
interface AiSettings {
  business: { id: string; name: string };
  enabled: boolean;
  timezone: string;
  weeklySchedule: DaySchedule[];
  outsideHoursPolicy: 'QUEUE' | 'HANDOFF' | 'SILENT';
  manualShutdownPolicy: 'QUEUE' | 'HANDOFF' | 'SILENT';
  backlogMaxAgeHours: number;
  version: number;
  updatedAt: string | null;
  updatedBy: { id: string; displayName: string | null } | null;
  lastChangeReason: string | null;
  canEdit: boolean;
  availability: {
    available: boolean;
    reason: string;
    nextTransitionAt: string | null;
    nextTransitionReason: 'ACTIVATES' | 'DEACTIVATES' | null;
  } | null;
}

const days: { key: Weekday; label: string }[] = [
  { key: 'SATURDAY', label: 'شنبه' },
  { key: 'SUNDAY', label: 'یکشنبه' },
  { key: 'MONDAY', label: 'دوشنبه' },
  { key: 'TUESDAY', label: 'سه‌شنبه' },
  { key: 'WEDNESDAY', label: 'چهارشنبه' },
  { key: 'THURSDAY', label: 'پنجشنبه' },
  { key: 'FRIDAY', label: 'جمعه' },
];

const deepCopy = (schedule: DaySchedule[]) => structuredClone(schedule);
const minute = (value: string) => {
  const [hour = '0', part = '0'] = value.split(':');
  return Number(hour) * 60 + Number(part);
};

function scheduleErrors(schedule: DaySchedule[]): Record<Weekday, string> {
  const errors = {} as Record<Weekday, string>;
  schedule.forEach((day, dayIndex) => {
    if (!day.enabled || day.allDay) return;
    if (!day.intervals.length) errors[day.day] = 'برای روز فعال دست‌کم یک بازه وارد کنید.';
    const spans = day.intervals.map((item) => {
      const start = minute(item.start);
      const end = minute(item.end);
      if (start === end) errors[day.day] = 'برای پوشش کامل روز از گزینهٔ ۲۴ ساعته استفاده کنید.';
      if (item.overnight !== end < start) {
        errors[day.day] = 'بازه‌ای که از نیمه‌شب عبور می‌کند باید «روز بعد» باشد.';
      }
      return {
        start: dayIndex * 1440 + start,
        end: dayIndex * 1440 + (item.overnight ? 1440 + end : end),
      };
    });
    spans.sort((a, b) => a.start - b.start);
    if (spans.some((span, index) => index > 0 && span.start < (spans[index - 1]?.end ?? 0))) {
      errors[day.day] = 'بازه‌های این روز با هم هم‌پوشانی دارند.';
    }
  });
  return errors;
}

function statusText(settings: AiSettings): string {
  if (!settings.enabled) return 'پاسخ‌گویی هوشمند غیرفعال است';
  if (settings.availability?.reason === 'OUTSIDE_WORKING_HOURS') {
    return settings.availability.nextTransitionAt
      ? `خارج از ساعت پاسخ‌گویی؛ شروع بعدی ${formatDate(settings.availability.nextTransitionAt, true)}`
      : 'خارج از ساعت پاسخ‌گویی';
  }
  if (settings.availability?.nextTransitionAt) {
    return `فعال؛ پایان پاسخ‌گویی ${formatDate(settings.availability.nextTransitionAt, true)}`;
  }
  return 'پاسخ‌گویی هوشمند فعال است';
}

export function SettingsPage() {
  const { businessPath, businessId } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const queryKey = ['ai-settings', businessId];
  const query = useQuery({
    queryKey,
    queryFn: () => request<AiSettings>(businessPath('/ai-settings')),
  });
  const [schedule, setSchedule] = useState<DaySchedule[]>([]);
  const [timezone, setTimezone] = useState('Asia/Tehran');
  const [outsideHoursPolicy, setOutsideHoursPolicy] =
    useState<AiSettings['outsideHoursPolicy']>('QUEUE');
  const [manualShutdownPolicy, setManualShutdownPolicy] =
    useState<AiSettings['manualShutdownPolicy']>('QUEUE');
  const [backlogMaxAgeHours, setBacklogMaxAgeHours] = useState(24);
  const [confirmState, setConfirmState] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [initializedVersion, setInitializedVersion] = useState<number | null>(null);

  useEffect(() => {
    if (!query.data || initializedVersion === query.data.version) return;
    setSchedule(deepCopy(query.data.weeklySchedule));
    setTimezone(query.data.timezone);
    setOutsideHoursPolicy(query.data.outsideHoursPolicy);
    setManualShutdownPolicy(query.data.manualShutdownPolicy);
    setBacklogMaxAgeHours(query.data.backlogMaxAgeHours);
    setInitializedVersion(query.data.version);
  }, [initializedVersion, query.data]);

  const dirty = Boolean(
    query.data &&
    (timezone !== query.data.timezone ||
      outsideHoursPolicy !== query.data.outsideHoursPolicy ||
      manualShutdownPolicy !== query.data.manualShutdownPolicy ||
      backlogMaxAgeHours !== query.data.backlogMaxAgeHours ||
      JSON.stringify(schedule) !== JSON.stringify(query.data.weeklySchedule)),
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const errors = useMemo(() => scheduleErrors(schedule), [schedule]);
  const mutation = useMutation({
    mutationFn: (input: {
      enabled: boolean;
      schedule: DaySchedule[];
      timezone: string;
      reason?: string;
    }) => {
      if (!query.data) throw new Error('تنظیمات هنوز دریافت نشده است.');
      return request<AiSettings>(businessPath('/ai-settings'), {
        method: 'PUT',
        body: jsonBody({
          enabled: input.enabled,
          timezone: input.timezone,
          weeklySchedule: input.schedule,
          outsideHoursPolicy,
          manualShutdownPolicy,
          backlogMaxAgeHours,
          version: query.data.version,
          ...(input.reason ? { reason: input.reason } : {}),
        }),
      });
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(queryKey, saved);
      setSchedule(deepCopy(saved.weeklySchedule));
      setTimezone(saved.timezone);
      setOutsideHoursPolicy(saved.outsideHoursPolicy);
      setManualShutdownPolicy(saved.manualShutdownPolicy);
      setBacklogMaxAgeHours(saved.backlogMaxAgeHours);
      setInitializedVersion(saved.version);
      setConfirmState(null);
      setReason('');
      await query.refetch();
      toast('تنظیمات پاسخ‌گویی هوشمند ذخیره شد.');
    },
    onError: (error) => {
      toast(
        error instanceof ApiError && error.status === 409
          ? 'مدیر دیگری تنظیمات را تغییر داده است. تغییرات شما حفظ شد؛ صفحه را تازه کنید.'
          : 'ذخیره انجام نشد. تغییرات شما حفظ شده است.',
        'error',
      );
    },
  });

  const patchDay = (index: number, patch: Partial<DaySchedule>) => {
    setSchedule((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  };
  const saveSchedule = () => {
    if (!query.data || Object.keys(errors).length) return;
    mutation.mutate({ enabled: query.data.enabled, schedule, timezone });
  };
  const setAllDay = () =>
    setSchedule(days.map(({ key }) => ({ day: key, enabled: true, allDay: true, intervals: [] })));
  const clearSchedule = () =>
    setSchedule(
      days.map(({ key }) => ({ day: key, enabled: false, allDay: false, intervals: [] })),
    );
  const workdays = () =>
    setSchedule(
      days.map(({ key }, index) => ({
        day: key,
        enabled: index < 5,
        allDay: false,
        intervals: index < 5 ? [{ start: '09:00', end: '17:00', overnight: false }] : [],
      })),
    );

  return (
    <>
      <PageHeader title="زمان‌بندی پاسخ‌گویی هوشمند" subtitle="تنظیمات مستقل هر کسب‌وکار" />
      <QueryState pending={query.isPending} error={query.error}>
        {query.data && (
          <div className="ai-settings-stack">
            <Card className={`availability-card ${query.data.enabled ? 'is-on' : 'is-off'}`}>
              <div className="availability-title">
                <div>
                  <Badge status={query.data.availability?.available ? 'READY' : 'ATTENTION'}>
                    {query.data.availability?.available ? 'در دسترس' : 'در دسترس نیست'}
                  </Badge>
                  <h3>{statusText(query.data)}</h3>
                </div>
                <span className="availability-dot" aria-hidden="true" />
              </div>
              <dl className="settings-meta">
                <div>
                  <dt>کسب‌وکار</dt>
                  <dd>{query.data.business.name}</dd>
                </div>
                <div>
                  <dt>منطقه زمانی</dt>
                  <dd dir="ltr">
                    <bdi>{query.data.timezone}</bdi>
                  </dd>
                </div>
                <div>
                  <dt>تغییر بعدی</dt>
                  <dd>
                    {query.data.availability?.nextTransitionAt
                      ? formatDate(query.data.availability.nextTransitionAt, true)
                      : 'بدون تغییر برنامه‌ریزی‌شده'}
                  </dd>
                </div>
                <div>
                  <dt>آخرین ویرایش</dt>
                  <dd>
                    {query.data.updatedAt
                      ? formatDate(query.data.updatedAt, true)
                      : 'تنظیم پیش‌فرض'}
                  </dd>
                </div>
                <div>
                  <dt>ویرایش‌کننده</dt>
                  <dd>{query.data.updatedBy?.displayName ?? 'سامانه'}</dd>
                </div>
              </dl>
            </Card>

            <Card>
              <div className="master-switch-row">
                <div>
                  <h3>فعال‌سازی پاسخ‌گویی هوشمند</h3>
                  <p className="muted">این کلید بر تمام گفتگوهای این کسب‌وکار اولویت دارد.</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={query.data.enabled}
                  aria-label="فعال‌سازی پاسخ‌گویی هوشمند"
                  className="toggle-switch"
                  disabled={!query.data.canEdit || mutation.isPending}
                  onClick={() => setConfirmState(!query.data.enabled)}
                >
                  <span />
                </button>
              </div>
              {!query.data.canEdit && (
                <p className="readonly-note">نقش پشتیبانی فقط اجازهٔ مشاهدهٔ تنظیمات را دارد.</p>
              )}
            </Card>

            <Card title="سیاست پیام‌های زمان توقف">
              <p className="muted">
                مشخص کنید پیام‌های دریافت‌شده هنگام توقف پاسخ‌گویی چه سرنوشتی داشته باشند.
              </p>
              <label className="field">
                خارج از ساعت کاری
                <select
                  value={outsideHoursPolicy}
                  disabled={!query.data.canEdit}
                  onChange={(event) =>
                    setOutsideHoursPolicy(event.target.value as AiSettings['outsideHoursPolicy'])
                  }
                >
                  <option value="QUEUE">نگهداری پیام‌ها و پاسخ پس از فعال‌شدن</option>
                  <option value="HANDOFF">ارجاع فوری به پشتیبان انسانی</option>
                  <option value="SILENT">ذخیره بدون پاسخ خودکار</option>
                </select>
                <small>
                  نگهداری، پیام‌ها را پس از شروع ساعت کاری در یک پاسخ یکپارچه پردازش می‌کند.
                </small>
              </label>
              <label className="field">
                خاموش‌کردن دستی
                <select
                  value={manualShutdownPolicy}
                  disabled={!query.data.canEdit}
                  onChange={(event) =>
                    setManualShutdownPolicy(
                      event.target.value as AiSettings['manualShutdownPolicy'],
                    )
                  }
                >
                  <option value="QUEUE">نگهداری پیام‌ها و پاسخ پس از فعال‌شدن</option>
                  <option value="HANDOFF">ارجاع فوری به پشتیبان انسانی</option>
                  <option value="SILENT">ذخیره بدون پاسخ خودکار</option>
                </select>
                <small>
                  ارجاع، رسیدگی را بلافاصله انسانی می‌کند؛ ذخیرهٔ خاموش بعداً پاسخ خودکار نمی‌فرستد.
                </small>
              </label>
              <label className="field">
                حداکثر زمان انتظار پیام‌ها برای پاسخ خودکار
                <input
                  type="number"
                  min={1}
                  max={48}
                  value={backlogMaxAgeHours}
                  disabled={!query.data.canEdit}
                  onChange={(event) => setBacklogMaxAgeHours(Number(event.target.value))}
                />
                <small>ساعت؛ پاسخ هرگز پس از پایان پنجرهٔ معتبر تلگرام ارسال نمی‌شود.</small>
              </label>
            </Card>

            <Card title="برنامهٔ هفتگی">
              <div className="timezone-row field">
                <label htmlFor="ai-timezone">منطقه زمانی کسب‌وکار</label>
                <select
                  id="ai-timezone"
                  dir="ltr"
                  value={timezone}
                  disabled={!query.data.canEdit}
                  onChange={(event) => setTimezone(event.target.value)}
                >
                  {['Asia/Tehran', 'Asia/Dubai', 'UTC', 'Europe/London', 'America/New_York'].map(
                    (zone) => (
                      <option key={zone}>{zone}</option>
                    ),
                  )}
                </select>
                <small>
                  زمان‌ها ساعت محلی همین منطقه هستند و از ساعت دستگاه مدیر استفاده نمی‌شود.
                </small>
              </div>
              {query.data.canEdit && (
                <div className="preset-row" aria-label="الگوهای سریع">
                  <Button type="button" onClick={setAllDay}>
                    تمام‌وقت؛ ۲۴ ساعته
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      const source = schedule[0];
                      setSchedule(
                        days.map(({ key }) => ({ ...structuredClone(source), day: key })),
                      );
                    }}
                  >
                    هر روز با ساعت یکسان
                  </Button>
                  <Button type="button" onClick={workdays}>
                    روزهای کاری
                  </Button>
                  <Button type="button" variant="danger" onClick={clearSchedule}>
                    پاک‌کردن برنامه (عدم دسترسی)
                  </Button>
                </div>
              )}
              <div className="weekly-schedule">
                {schedule.map((day, dayIndex) => (
                  <section className="day-editor" key={day.day} aria-labelledby={`day-${day.day}`}>
                    <div className="day-head">
                      <strong id={`day-${day.day}`}>
                        {days.find((item) => item.key === day.day)?.label}
                      </strong>
                      <div className="day-actions">
                        <label>
                          <input
                            type="checkbox"
                            checked={day.enabled}
                            disabled={!query.data.canEdit}
                            onChange={(event) =>
                              patchDay(dayIndex, {
                                enabled: event.target.checked,
                                allDay: event.target.checked ? day.allDay : false,
                                intervals: event.target.checked
                                  ? day.intervals.length
                                    ? day.intervals
                                    : [{ start: '09:00', end: '17:00', overnight: false }]
                                  : [],
                              })
                            }
                          />{' '}
                          فعال
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={day.allDay}
                            disabled={!query.data.canEdit || !day.enabled}
                            onChange={(event) =>
                              patchDay(dayIndex, {
                                allDay: event.target.checked,
                                intervals: event.target.checked
                                  ? []
                                  : [{ start: '09:00', end: '17:00', overnight: false }],
                              })
                            }
                          />{' '}
                          ۲۴ ساعته
                        </label>
                        {query.data.canEdit && (
                          <button
                            type="button"
                            className="text-action"
                            disabled={!day.enabled}
                            onClick={() =>
                              setSchedule(
                                days.map(({ key }) => ({ ...structuredClone(day), day: key })),
                              )
                            }
                          >
                            کپی در همه روزها
                          </button>
                        )}
                      </div>
                    </div>
                    {!day.enabled && (
                      <p className="day-closed">پاسخ‌گویی در این روز انجام نمی‌شود.</p>
                    )}
                    {day.enabled && day.allDay && (
                      <p className="day-open">از ساعت ۰۰:۰۰ تا ۲۴:۰۰ در دسترس است.</p>
                    )}
                    {day.enabled &&
                      !day.allDay &&
                      day.intervals.map((interval, intervalIndex) => (
                        <div className="interval-row" key={`${day.day}-${intervalIndex}`}>
                          <label>
                            از{' '}
                            <input
                              dir="ltr"
                              type="time"
                              value={interval.start}
                              disabled={!query.data.canEdit}
                              onChange={(event) =>
                                patchDay(dayIndex, {
                                  intervals: day.intervals.map((item, index) =>
                                    index === intervalIndex
                                      ? {
                                          ...item,
                                          start: event.target.value,
                                          overnight: minute(item.end) < minute(event.target.value),
                                        }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </label>
                          <span>تا</span>
                          <label>
                            <input
                              dir="ltr"
                              type="time"
                              value={interval.end}
                              disabled={!query.data.canEdit}
                              onChange={(event) =>
                                patchDay(dayIndex, {
                                  intervals: day.intervals.map((item, index) =>
                                    index === intervalIndex
                                      ? {
                                          ...item,
                                          end: event.target.value,
                                          overnight:
                                            minute(event.target.value) < minute(item.start),
                                        }
                                      : item,
                                  ),
                                })
                              }
                            />
                          </label>
                          {interval.overnight && <Badge status="ATTENTION">روز بعد</Badge>}
                          {query.data.canEdit && (
                            <button
                              type="button"
                              className="remove-interval"
                              aria-label="حذف بازه"
                              onClick={() =>
                                patchDay(dayIndex, {
                                  intervals: day.intervals.filter(
                                    (_, index) => index !== intervalIndex,
                                  ),
                                })
                              }
                            >
                              ×
                            </button>
                          )}
                          {interval.overnight && (
                            <small className="overnight-copy">
                              {interval.start} تا {interval.end} روز بعد
                            </small>
                          )}
                        </div>
                      ))}
                    {day.enabled && !day.allDay && query.data.canEdit && (
                      <Button
                        type="button"
                        onClick={() =>
                          patchDay(dayIndex, {
                            intervals: [
                              ...day.intervals,
                              { start: '09:00', end: '17:00', overnight: false },
                            ],
                          })
                        }
                      >
                        + افزودن بازه
                      </Button>
                    )}
                    {errors[day.day] && (
                      <p className="field-error" role="alert">
                        {errors[day.day]}
                      </p>
                    )}
                  </section>
                ))}
              </div>
              {query.data.canEdit && (
                <div className="sticky-save">
                  <span>{dirty ? 'تغییرات ذخیره‌نشده دارید.' : 'همهٔ تغییرات ذخیره شده‌اند.'}</span>
                  <Button
                    type="button"
                    variant="primary"
                    disabled={!dirty || mutation.isPending || Object.keys(errors).length > 0}
                    onClick={saveSchedule}
                  >
                    {mutation.isPending ? 'در حال ذخیره…' : 'ذخیرهٔ برنامه'}
                  </Button>
                </div>
              )}
            </Card>
          </div>
        )}
      </QueryState>
      {confirmState !== null && query.data && (
        <Dialog
          title={confirmState ? 'فعال‌کردن پاسخ‌گویی هوشمند' : 'توقف پاسخ‌گویی هوشمند'}
          description={
            confirmState
              ? 'فقط پیام‌های جدید پس از فعال‌سازی وارد روند پاسخ خودکار می‌شوند.'
              : 'هوش مصنوعی به پیام‌های جدید پاسخ نمی‌دهد؛ پیام‌ها همچنان ذخیره می‌شوند، پشتیبانی انسانی خودکار فعال نمی‌شود و پیام‌های ردشده بعداً پاسخ داده نخواهند شد.'
          }
          placement="top"
          onClose={() => setConfirmState(null)}
        >
          <div className="field">
            <label htmlFor="change-reason">دلیل تغییر (اختیاری)</label>
            <textarea
              id="change-reason"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="برای نمونه: پایان شیفت پاسخ‌گویی"
            />
          </div>
          <div className="button-row">
            <Button type="button" onClick={() => setConfirmState(null)}>
              انصراف
            </Button>
            <Button
              type="button"
              variant={confirmState ? 'primary' : 'danger'}
              disabled={mutation.isPending}
              onClick={() =>
                mutation.mutate({
                  enabled: confirmState,
                  schedule: query.data.weeklySchedule,
                  timezone: query.data.timezone,
                  reason,
                })
              }
            >
              {mutation.isPending ? 'در حال ثبت…' : 'تأیید و ثبت'}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}
