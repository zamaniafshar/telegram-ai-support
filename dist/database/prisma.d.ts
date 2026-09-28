import { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
export declare function createPrismaClient(config?: AppConfig, logger?: Logger): PrismaClient;
export declare function databaseHealthy(prisma: PrismaClient): Promise<boolean>;
