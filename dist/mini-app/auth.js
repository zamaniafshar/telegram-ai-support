import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AuthorizationError, ValidationError } from '../utils/errors.js';
import { newId, telegramId } from '../utils/ids.js';
const telegramMiniAppUserSchema = z.object({
    id: z.union([z.number().int(), z.string().regex(/^\d{1,20}$/)]),
    first_name: z.string().max(256),
    last_name: z.string().max(256).optional(),
    username: z.string().max(64).optional(),
    language_code: z.string().max(16).optional(),
});
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
function constantTimeHexEqual(left, right) {
    if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right))
        return false;
    const leftBytes = Buffer.from(left, 'hex');
    const rightBytes = Buffer.from(right, 'hex');
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
export function verifyTelegramMiniAppData(rawInitData, botToken, maxAgeSeconds, now = new Date()) {
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
    let rawUser;
    try {
        rawUser = JSON.parse(params.get('user') ?? 'null');
    }
    catch {
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
function cookieValue(request, name) {
    const header = request.headers.cookie;
    if (!header)
        return undefined;
    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator === -1)
            continue;
        if (part.slice(0, separator).trim() === name) {
            return decodeURIComponent(part.slice(separator + 1).trim());
        }
    }
    return undefined;
}
export class MiniAppAuthService {
    prisma;
    config;
    static cookieName = '__Host-tma_session';
    static developmentCookieName = 'tma_dev_session';
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
    }
    async exchange(rawInitData) {
        const verified = verifyTelegramMiniAppData(rawInitData, this.config.telegram.adminBotToken, this.config.telegram.miniAppAuthMaxAgeSeconds);
        return this.#createSession(verified.telegramUserId, verified.displayName, false);
    }
    async developmentExchange() {
        if (this.config.nodeEnv !== 'development' || !this.config.telegram.miniAppDevAdminId) {
            throw new AuthorizationError('Development login is disabled');
        }
        return this.#createSession(this.config.telegram.miniAppDevAdminId, undefined, true);
    }
    async #createSession(telegramUserId, displayName, development) {
        const admin = await this.prisma.admin.findUnique({
            where: { telegramUserId },
            include: { businessAccess: { include: { businessAccount: true } } },
        });
        if (!admin?.isActive)
            throw new AuthorizationError();
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
    async requireSession(request) {
        const token = cookieValue(request, MiniAppAuthService.cookieName) ??
            (this.config.nodeEnv === 'development'
                ? cookieValue(request, MiniAppAuthService.developmentCookieName)
                : undefined);
        if (!token)
            throw new AuthorizationError('Session is missing');
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
    isDevelopmentSession(request) {
        return (this.config.nodeEnv === 'development' &&
            cookieValue(request, MiniAppAuthService.developmentCookieName) !== undefined);
    }
    requireCsrf(request, context) {
        const supplied = request.headers['x-csrf-token'];
        if (typeof supplied !== 'string' || !supplied) {
            throw new AuthorizationError('CSRF token is missing');
        }
        void context;
    }
    async verifyCsrf(request, context) {
        this.requireCsrf(request, context);
        const supplied = request.headers['x-csrf-token'];
        const session = await this.prisma.adminSession.findUnique({ where: { id: context.sessionId } });
        if (typeof supplied !== 'string' ||
            !session ||
            !constantTimeHexEqual(session.csrfHash, sha256(supplied))) {
            throw new AuthorizationError('CSRF token is invalid');
        }
        const origin = request.headers.origin;
        const localDevelopmentOrigin = (() => {
            if (!origin ||
                this.config.nodeEnv !== 'development' ||
                !this.config.telegram.miniAppDevAdminId) {
                return false;
            }
            try {
                const hostname = new URL(origin).hostname;
                return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
            }
            catch {
                return false;
            }
        })();
        if (origin &&
            origin !== new URL(this.config.telegram.miniAppUrl).origin &&
            !localDevelopmentOrigin) {
            throw new AuthorizationError('Origin is invalid');
        }
    }
    async revoke(context) {
        await this.prisma.adminSession.updateMany({
            where: { id: context.sessionId, revokedAt: null },
            data: { revokedAt: new Date() },
        });
    }
    async rotateCsrf(context) {
        const csrfToken = randomBytes(24).toString('base64url');
        const changed = await this.prisma.adminSession.updateMany({
            where: { id: context.sessionId, revokedAt: null, expiresAt: { gt: new Date() } },
            data: { csrfHash: sha256(csrfToken) },
        });
        if (changed.count !== 1)
            throw new AuthorizationError('Session has expired');
        return csrfToken;
    }
    sessionCookie(token, development = false) {
        const maxAge = this.config.telegram.miniAppSessionHours * 3_600;
        if (development) {
            return `${MiniAppAuthService.developmentCookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict`;
        }
        return `${MiniAppAuthService.cookieName}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
    }
    clearCookie() {
        return [
            `${MiniAppAuthService.cookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
            `${MiniAppAuthService.developmentCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`,
        ];
    }
}
//# sourceMappingURL=auth.js.map