import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { request, jsonBody } from '../../core/api';
import { faLabel, formatDate } from '../../core/format';
import type { AdminAccount } from '../../core/types';
import { Badge, Button, Dialog, EmptyState, PageHeader, QueryState } from '../../components/ui';
import { useSession } from '../../app/SessionProvider';
import { useToast } from '../../app/ToastProvider';
import { useConfirmation } from '../../app/ConfirmationProvider';

const adminSchema = z.object({
  displayName: z.string().max(200),
  telegramUserId: z.string().regex(/^\d{1,20}$/, 'شناسه عددی تلگرام نامعتبر است'),
  role: z.enum(['ADMIN', 'SUPPORT']),
});
type AdminForm = z.infer<typeof adminSchema>;

export function AdminsPage() {
  const { businessPath } = useSession();
  const toast = useToast();
  const confirm = useConfirmation();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const form = useForm<AdminForm>({
    resolver: zodResolver(adminSchema),
    defaultValues: { displayName: '', telegramUserId: '', role: 'SUPPORT' },
  });
  const key = ['admins', businessPath('')];
  const query = useQuery({
    queryKey: key,
    queryFn: () => request<AdminAccount[]>(businessPath('/admins')),
  });
  const mutation = useMutation({
    mutationFn: ({ path, method, body }: { path: string; method: string; body?: unknown }) =>
      request(businessPath(path), {
        method,
        ...(body === undefined ? {} : { body: jsonBody(body) }),
      }),
    onSuccess: async () => {
      toast('دسترسی‌ها به‌روزرسانی شد.');
      setOpen(false);
      form.reset();
      await client.invalidateQueries({ queryKey: key });
    },
    onError: (error) => toast(error.message, 'error'),
  });
  const confirmMutation = async (
    message: string,
    input: Parameters<typeof mutation.mutate>[0],
    destructive = false,
  ) => {
    const confirmed = await confirm({
      title: destructive ? 'حذف دسترسی' : 'تغییر دسترسی',
      message,
      confirmLabel: destructive ? 'حذف' : 'تأیید تغییر',
      tone: destructive ? 'danger' : 'primary',
    });
    if (confirmed) mutation.mutate(input);
  };
  return (
    <>
      <PageHeader
        title="مدیران و دسترسی‌ها"
        subtitle={
          query.data
            ? `${query.data.length.toLocaleString('fa-IR')} حساب`
            : 'نقش‌ها و حساب‌های مجاز'
        }
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            افزودن مدیر
          </Button>
        }
      />
      <QueryState pending={query.isPending} error={query.error}>
        <div className="list">
          {query.data?.map((item) => (
            <article className="list-card" key={item.id}>
              <div className="list-main">
                <strong>{item.displayName ?? 'بدون نام'}</strong>
                <span>
                  <bdi className="ltr">{item.telegramUserId}</bdi>
                </span>
              </div>
              <div className="list-meta">
                <Badge status={item.role}>{faLabel(item.role)}</Badge>
                <Badge status={item.isActive ? 'READY' : 'FAILED'}>
                  {item.isActive ? 'فعال' : 'غیرفعال'}
                </Badge>
              </div>
              {!item.protected && (
                <div className="button-row">
                  <Button
                    onClick={() =>
                      void confirmMutation(
                        `نقش این حساب به «${faLabel(item.role === 'ADMIN' ? 'SUPPORT' : 'ADMIN')}» تغییر کند؟`,
                        {
                          path: `/admins/${item.id}`,
                          method: 'PATCH',
                          body: { role: item.role === 'ADMIN' ? 'SUPPORT' : 'ADMIN' },
                        },
                      )
                    }
                  >
                    تغییر به {item.role === 'ADMIN' ? 'پشتیبان' : 'مدیر'}
                  </Button>
                  <Button
                    onClick={() =>
                      void confirmMutation('وضعیت دسترسی این حساب تغییر کند؟', {
                        path: `/admins/${item.id}`,
                        method: 'PATCH',
                        body: { isActive: !item.isActive },
                      })
                    }
                  >
                    {item.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      void confirmMutation(
                        'دسترسی این حساب از کسب‌وکار حذف شود؟',
                        {
                          path: `/admins/${item.id}/access`,
                          method: 'DELETE',
                        },
                        true,
                      )
                    }
                  >
                    حذف دسترسی
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      </QueryState>
      {open && (
        <Dialog
          title="افزودن مدیر"
          description="شناسه عددی تلگرام و نقش دسترسی را وارد کنید."
          onClose={() => setOpen(false)}
        >
          <form
            onSubmit={form.handleSubmit((values) =>
              mutation.mutate({
                path: '/admins',
                method: 'POST',
                body: { ...values, displayName: values.displayName || undefined },
              }),
            )}
          >
            <label className="field">
              نام نمایشی
              <input {...form.register('displayName')} maxLength={200} />
            </label>
            <label className="field">
              شناسه عددی تلگرام
              <input {...form.register('telegramUserId')} className="ltr" inputMode="numeric" />
              {form.formState.errors.telegramUserId && (
                <small className="field-error">
                  {form.formState.errors.telegramUserId.message}
                </small>
              )}
            </label>
            <label className="field">
              نقش
              <select {...form.register('role')}>
                <option value="SUPPORT">پشتیبان</option>
                <option value="ADMIN">مدیر</option>
              </select>
            </label>
            <div className="button-row">
              <Button type="button" onClick={() => setOpen(false)}>
                انصراف
              </Button>
              <Button variant="primary" type="submit">
                افزودن دسترسی
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

interface AuditItem {
  id: string;
  action: string;
  actorType: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}
export function AuditPage() {
  const { businessPath } = useSession();
  const query = useQuery({
    queryKey: ['audit', businessPath('')],
    queryFn: () => request<AuditItem[]>(businessPath('/audit')),
  });
  return (
    <>
      <PageHeader
        title="گزارش فعالیت‌ها"
        subtitle={
          query.data
            ? `${query.data.length.toLocaleString('fa-IR')} رویداد اخیر`
            : 'تاریخچه تغییرات حساس سامانه'
        }
      />
      <QueryState pending={query.isPending} error={query.error}>
        <div className="list">
          {query.data?.length ? (
            query.data.map((item) => (
              <article className="list-card" key={item.id}>
                <div className="list-main">
                  <strong>{faLabel(item.action)}</strong>
                  <span>
                    {item.actorType === 'SYSTEM' ? 'سامانه' : 'مدیر'} · {faLabel(item.entityType)}
                  </span>
                </div>
                <div className="list-meta">
                  <time>{formatDate(item.createdAt)}</time>
                  <bdi className="ltr">{item.entityId.slice(0, 12)}</bdi>
                </div>
              </article>
            ))
          ) : (
            <EmptyState
              icon="◷"
              title="فعالیتی ثبت نشده است"
              description="تغییرات حساس پس از انجام در این بخش ثبت می‌شوند."
            />
          )}
        </div>
      </QueryState>
    </>
  );
}

interface NotificationDelivery {
  id: string;
  readAt: string | null;
  createdAt: string;
  notification: { title: string; summary: string; severity: string; destinationPath: string };
}
export function NotificationsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['notifications'],
    queryFn: () => request<NotificationDelivery[]>('/api/v1/notifications'),
  });
  const read = useMutation({
    mutationFn: (id: string) =>
      request(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
    onError: (error) => toast(error.message, 'error'),
  });
  const open = (item: NotificationDelivery) => {
    if (!item.readAt) read.mutate(item.id);
    void navigate(item.notification.destinationPath);
  };
  return (
    <>
      <PageHeader
        title="اعلان‌ها"
        subtitle={
          query.data
            ? `${query.data.filter((item) => !item.readAt).length.toLocaleString('fa-IR')} اعلان خوانده‌نشده`
            : 'پیام‌های عملیاتی و وضعیت مطالعه'
        }
      />
      <QueryState pending={query.isPending} error={query.error}>
        <div className="list">
          {query.data?.length ? (
            query.data.map((item) => (
              <button className="list-card list-button" onClick={() => open(item)} key={item.id}>
                <div className="list-main">
                  <strong>{item.notification.title}</strong>
                  <span>{item.notification.summary}</span>
                </div>
                <div className="list-meta">
                  <Badge status={item.notification.severity}>
                    {item.readAt ? 'خوانده‌شده' : 'جدید'}
                  </Badge>
                  <time>{formatDate(item.createdAt, true)}</time>
                </div>
              </button>
            ))
          ) : (
            <EmptyState
              icon="♢"
              title="اعلانی ندارید"
              description="هشدارها و رویدادهای مهم در این بخش باقی می‌مانند."
            />
          )}
        </div>
      </QueryState>
    </>
  );
}

const descriptions: Record<string, string> = {
  '/knowledge': 'محتوای پاسخ‌گویی',
  '/connections': 'ارتباط حساب پشتیبانی',
  '/system': 'سرویس‌ها و صف‌ها',
  '/admins': 'نقش‌ها و دسترسی',
  '/audit': 'تغییرات حساس',
  '/notifications': 'هشدارهای اخیر',
  '/settings': 'پیکربندی عملیاتی',
};
export function MorePage() {
  const { hasCapability } = useSession();
  const links = [
    ...(hasCapability('knowledge:manage') ? [['/knowledge', '▤', 'مدیریت دانش']] : []),
    ['/connections', '⌁', 'اتصال تجاری'],
    ['/system', '♡', 'سلامت سامانه'],
    ...(hasCapability('admin:manage') ? [['/admins', '♙', 'مدیران']] : []),
    ...(hasCapability('audit:read') ? [['/audit', '◷', 'فعالیت‌ها']] : []),
    ['/notifications', '♢', 'اعلان‌ها'],
    ...(hasCapability('settings:read') ? [['/settings', '⚙', 'تنظیمات']] : []),
  ];
  return (
    <>
      <PageHeader title="بیشتر" subtitle="مدیریت دانش، سلامت و دسترسی‌ها" />
      <div className="more-grid">
        {links.map(([path, icon, label]) => (
          <Link className="more-link" to={path} key={path}>
            <span aria-hidden="true">{icon}</span>
            <strong>{label}</strong>
            <small>{descriptions[path]}</small>
          </Link>
        ))}
      </div>
    </>
  );
}
