import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routes = readFileSync(new URL('../src/mini-app/routes.ts', import.meta.url), 'utf8');
const ui = [
  '../web/src/features/support/SupportPages.tsx',
  '../web/src/features/knowledge/KnowledgePages.tsx',
  '../web/src/features/admin/AdminPages.tsx',
  '../web/src/features/settings/AiSettingsPage.tsx',
]
  .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
  .join('\n');
const adminHandler = readFileSync(
  new URL('../src/telegram-admin/handler.ts', import.meta.url),
  'utf8',
);
const telegramTypes = readFileSync(
  new URL('../src/telegram-business/types.ts', import.meta.url),
  'utf8',
);
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../prisma/migrations/20260812030000_mini_app_migration/migration.sql', import.meta.url),
  'utf8',
);

describe('Mini App management feature parity', () => {
  it.each([
    ['dashboard', '/dashboard'],
    ['handoff queue and details', '/handoffs'],
    ['handoff claim', "'claim'"],
    ['handoff acknowledgement', 'acknowledge'],
    ['human-mode extension', 'extend'],
    ['manual AI restoration', 'enable-ai'],
    ['handoff resolution', '/resolve'],
    ['conversation history', '/conversations'],
    ['knowledge list and search', '/knowledge'],
    ['knowledge drafts', '/knowledge/drafts'],
    ['knowledge preview', '/preview'],
    ['knowledge publication', '/publish'],
    ['knowledge activation', '/active'],
    ['indexing retry', '/indexing/retry'],
    ['business connection health', '/connections'],
    ['system health', '/system'],
    ['admin and role management', '/admins'],
    ['audit log', '/audit'],
    ['notifications', '/notifications'],
    ['safe settings', '/settings'],
    ['AI settings', '/ai-settings'],
    ['AI availability', '/ai-availability'],
  ])('has an authenticated API replacement for %s', (_feature, marker) => {
    expect(routes).toContain(marker);
  });

  it('keeps AI availability management in the Persian RTL Mini App only', () => {
    expect(ui).toContain('فعال‌سازی پاسخ‌گویی هوشمند');
    expect(ui).toContain('روز بعد');
    expect(ui).toContain('تغییرات ذخیره‌نشده');
    expect(ui).toContain('dir="ltr"');
    expect(adminHandler).not.toContain('AI_MASTER_DISABLED');
    expect(adminHandler).not.toContain('فعال‌سازی پاسخ‌گویی هوشمند');
  });

  it.each([
    ["act('claim')", 'claim-handoff'],
    ["act('acknowledge')", 'ack-handoff'],
    ["act('extend'", 'extend-handoff'],
    ["act('enable-ai'", 'enable-ai'],
    ["name: 'resolve'", 'resolve-handoff'],
    ['/knowledge/drafts', 'create-draft'],
    ['/active', 'toggle-knowledge'],
    ['/indexing/retry', 'retry-knowledge'],
    ["method: 'DELETE'", 'delete-knowledge'],
    ["path: '/admins'", 'add-admin'],
    ["method: 'PATCH'", 'change-admin-role'],
    ['/access', 'remove-admin'],
  ])('exposes %s only in the Mini App UI', (marker, removedAction) => {
    expect(ui).toContain(marker);
    expect(adminHandler).not.toContain(removedAction);
  });

  it('removes callback and reply-keyboard management infrastructure', () => {
    expect(adminHandler).not.toContain('callback_query');
    expect(adminHandler).not.toContain('callback_data');
    expect(adminHandler).not.toContain('flowState');
    expect(telegramTypes).not.toContain('callback_query');
    expect(telegramTypes).not.toContain('callback_data');
    expect(telegramTypes).not.toContain('ReplyKeyboard');
  });

  it('drops only obsolete flow state after creating replacement structures', () => {
    expect(schema).not.toContain('model AdminFlowState');
    expect(schema).toContain('model AdminSession');
    expect(schema).toContain('model KnowledgeDraft');
    expect(schema).toContain('model NotificationDelivery');
    expect(migration.indexOf('CREATE TABLE `AdminSession`')).toBeLessThan(
      migration.indexOf('DROP TABLE `AdminFlowState`'),
    );
    expect(migration).not.toMatch(
      /DROP TABLE `(AuditLog|KnowledgeItem|Conversation|Handoff|Admin)`/,
    );
  });
});
