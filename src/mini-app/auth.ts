import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { Admin, AdminBusinessAccount, BusinessAccount, PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/env.js';
import { AuthorizationError, ValidationError } from '../utils/errors.js';
import { newId, telegramId } from '../utils/ids.js';

const telegramMiniAppUserSchema = z.object({
  id: z.union([z.number().int(), z.string().regex(/^\d{1,20}$/)]),
  first_name: z.string().max(256),
  last_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  language_code: z.string().max(16).optional(),
});

export interface VerifiedTelegramMiniAppData {
  telegramUserId: bigint;
  authDate: Date;
  displayName: string;
  username?: string;
  queryId?: string;
}

export interface MiniAppSessionContext {
  sessionId: string;
  admin: Admin;
  businessAccess: (AdminBusinessAccount & { businessAccount: BusinessAccount })[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function verifyTelegramMiniAppData(
  rawInitData: string,
  botToken: string,
  maxAgeSeconds: number,
  now = new Date(),
): VerifiedTelegramMiniAppData {
  if (!rawInitData || rawInitData.length > 8_192) {
    throw new ValidationError('Telegram authentication data is invalid', 'INVALID_TELEGRAM_AUTH');
  }
  const params = new URLSearchParams(rawInitData);
  const suppliedHash = params.get('hash') ?? '';
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (!constantTimeHexEqual(suppliedHash, expectedHash)) {
    throw new AuthorizationError('Telegram authentication data is invalid');
  }

  const authDateSeconds = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDateSeconds) || authDateSeconds <= 0) {
    throw new ValidationError('Telegram authentication date is invalid', 'INVALID_TELEGRAM_AUTH');
  }
  const ageSeconds = now.getTime() / 1_000 - authDateSeconds;
  if (ageSeconds < -30 || ageSeconds > maxAgeSeconds) {
    throw new AuthorizationError('Telegram authentication data has expired');
  }

  let rawUser: unknown;
  try {
    rawUser = JSON.parse(params.get('user') ?? 'null');
  } catch {
    throw new ValidationError('Telegram user data is invalid', 'INVALID_TELEGRAM_AUTH');
  }
  const user = telegramMiniAppUserSchema.parse(rawUser);
  const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  const queryId = params.get('query_id');
  return {
    telegramUserId: telegramId(user.id),
    authDate: new Date(authDateSeconds * 1_000),
    displayName,
    ...(user.username ? { username: user.username } : {}),
    ...(queryId ? { queryId } : {}),
  };
}

function cookieValue(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

export class MiniAppAuthService {
  static readonly cookieName = '__Host-tma_session';
  static readonly developmentCookieName = 'tma_dev_session';

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  async exchange(rawInitData: string): Promise<{
    context: MiniAppSessionContext;
    token: string;
    csrfToken: string;
  }> {
    const verified = verifyTelegramMiniAppData(
      rawInitData,
      this.config.telegram.adminBotToken,
      this.config.telegram.miniAppAuthMaxAgeSeconds,
    );
    return this.#createSession(verified.telegramUserId, verified.displayName, false);
  }

  async developmentExchange(): Promise<{
    context: MiniAppSessionContext;
    token: string;
    csrfToken: string;
  }> {
    if (this.config.nodeEnv !== 'development' || !this.config.telegram.miniAppDevAdminId) {
      throw new AuthorizationError('Development login is disabled');
    }
    return this.#createSession(this.config.telegram.miniAppDevAdminId, undefined, true);
  }

  async #createSession(
    telegramUserId: bigint,
    displayName: string | undefined,
    development: boolean,
  ): Promise<{ context: MiniAppSessionContext; token: string; csrfToken: string }> {
    const admin = await this.prisma.admin.findUnique({
      where: { telegramUserId },
      include: { businessAccess: { include: { businessAccount: true } } },
    });
    if (!admin?.isActive) throw new AuthorizationError();
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + this.config.telegram.miniAppSessionHours * 3_600_000);
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.admin.update({
        where: { id: admin.id },
        data: { displayName: displayName ?? admin.displayName },
      });
      await tx.adminSession.deleteMany({
        where: { OR: [{ expiresAt: { lte: new Date() } }, { revokedAt: { not: null } }] },
      });
      const created = await tx.adminSession.create({
        data: {
          id: newId(),
          adminId: admin.id,
          tokenHash: sha256(token),
          csrfHash: sha256(csrfToken),
          expiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          id: newId(),
          actorType: 'ADMIN',
          actorId: admin.id,
          action: development ? 'MINI_APP_DEVELOPMENT_SESSION_CREATED' : 'MINI_APP_SESSION_CREATED',
          entityType: 'AdminSession',
          entityId: created.id,
        },
      });
      return created;
    });
    return {
      token,
      csrfToken,
      context: {
        sessionId: session.id,
        admin: { ...admin, displayName: displayName ?? admin.displayName },
        businessAccess: admin.businessAccess,
      },
    };
  }

  async requireSession(request: FastifyRequest): Promise<MiniAppSessionContext> {
    const token =
      cookieValue(request, MiniAppAuthService.cookieName) ??
      (this.config.nodeEnv === 'development'
        ? cookieValue(request, MiniAppAuthService.developmentCookieName)
        : undefined);
    if (!token) throw new AuthorizationError('Session is missing');
    const now = new Date();
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: sha256(token) },
      include: {
        admin: { include: { businessAccess: { include: { businessAccount: true } } } },
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= now || !session.admin.isActive) {
      throw new AuthorizationError('Session has expired');
    }
    if (now.getTime() - session.lastSeenAt.getTime() > 5 * 60_000) {
      await this.prisma.adminSession.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
        data: { lastSeenAt: now },
      });
    }
    return {
      sessionId: session.id,
      admin: session.admin,
      businessAccess: session.admin.businessAccess,
    };
  }

  isDevelopmentSession(request: FastifyRequest): boolean {
    return (
      this.config.nodeEnv === 'development' &&
      cookieValue(request, MiniAppAuthService.developmentCookieName) !== undefined
    );
  }

  requireCsrf(request: FastifyRequest, context: MiniAppSessionContext): void {
    const supplied = request.headers['x-csrf-token'];
    if (typeof supplied !== 'string' || !supplied) {
      throw new AuthorizationError('CSRF token is missing');
    }
    void context;
  }

  async verifyCsrf(request: FastifyRequest, context: MiniAppSessionContext): Promise<void> {
    this.requireCsrf(request, context);
    const supplied = request.headers['x-csrf-token'];
    const session = await this.prisma.adminSession.findUnique({ where: { id: context.sessionId } });
    if (
      typeof supplied !== 'string' ||
      !session ||
      !constantTimeHexEqual(session.csrfHash, sha256(supplied))
    ) {
      throw new AuthorizationError('CSRF token is invalid');
    }
    const origin = request.headers.origin;
    const localDevelopmentOrigin = (() => {
      if (
        !origin ||
        this.config.nodeEnv !== 'development' ||
        !this.config.telegram.miniAppDevAdminId
      ) {
        return false;
      }
      try {
        const hostname = new URL(origin).hostname;
        return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
      } catch {
        return false;
      }
    })();
    if (
      origin &&
      origin !== new URL(this.config.telegram.miniAppUrl).origin &&
      !localDevelopmentOrigin
    ) {
      throw new AuthorizationError('Origin is invalid');
    }
  }

  async revoke(context: MiniAppSessionContext): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { id: context.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async rotateCsrf(context: MiniAppSessionContext): Promise<string> {
    const csrfToken = randomBytes(24).toString('base64url');
    const changed = await this.prisma.adminSession.updateMany({
      where: { id: context.sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { csrfHash: sha256(csrfToken) },
    });
    if (changed.count !== 1) throw new AuthorizationError('Session has expired');
    return csrfToken;
  }

  sessionCookie(token: string, development = false): string {
    const maxAge = this.config.telegram.miniAppSessionHours * 3_600;
    if (development) {
      return `${MiniAppAuthService.developmentCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict`;
    }
    return `${MiniAppAuthService.cookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
  }

  clearCookie(): string[] {
    return [
      `${MiniAppAuthService.cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      `${MiniAppAuthService.developmentCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`,
    ];
  }
}
