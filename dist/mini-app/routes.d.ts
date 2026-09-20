import type { FastifyBaseLogger, FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from 'fastify';
import type { MiniAppAuthService } from './auth.js';
import type { MiniAppManagementService } from './service.js';
export declare function registerMiniAppApi<LoggerType extends FastifyBaseLogger>(app: FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, LoggerType>, auth: MiniAppAuthService, management: MiniAppManagementService): Promise<void>;
