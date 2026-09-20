import Fastify from 'fastify';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type { Services } from '../app.js';
export declare function buildServer(config: AppConfig, services: Services, logger: Logger): Promise<Fastify.FastifyInstance<import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, Logger, Fastify.FastifyTypeProviderDefault>>;
