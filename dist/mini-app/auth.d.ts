import type { Admin, AdminBusinessAccount, BusinessAccount, PrismaClient } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../config/env.js';
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
    businessAccess: (AdminBusinessAccount & {
        businessAccount: BusinessAccount;
    })[];
}
export declare function verifyTelegramMiniAppData(rawInitData: string, botToken: string, maxAgeSeconds: number, now?: Date): VerifiedTelegramMiniAppData;
export declare class MiniAppAuthService {
    #private;
    private readonly prisma;
    private readonly config;
    static readonly cookieName = "__Host-tma_session";
    static readonly developmentCookieName = "tma_dev_session";
    constructor(prisma: PrismaClient, config: AppConfig);
    exchange(rawInitData: string): Promise<{
        context: MiniAppSessionContext;
        token: string;
        csrfToken: string;
    }>;
    developmentExchange(): Promise<{
        context: MiniAppSessionContext;
        token: string;
        csrfToken: string;
    }>;
    requireSession(request: FastifyRequest): Promise<MiniAppSessionContext>;
    isDevelopmentSession(request: FastifyRequest): boolean;
    requireCsrf(request: FastifyRequest, context: MiniAppSessionContext): void;
    verifyCsrf(request: FastifyRequest, context: MiniAppSessionContext): Promise<void>;
    revoke(context: MiniAppSessionContext): Promise<void>;
    rotateCsrf(context: MiniAppSessionContext): Promise<string>;
    sessionCookie(token: string, development?: boolean): string;
    clearCookie(): string[];
}
