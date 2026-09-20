import type { FastifyBaseLogger, FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from 'fastify';
export declare function registerMiniAppStatic<LoggerType extends FastifyBaseLogger>(app: FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, LoggerType>): void;
