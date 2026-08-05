import type { TelegramBotKind } from '@prisma/client';

export function telegramUpdateIdentity(
  botKind: TelegramBotKind,
  updateId: number | bigint,
): string {
  return `${botKind}:${updateId.toString()}`;
}
