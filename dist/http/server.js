import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { validWebhookSecret } from '../security/webhook-secret.js';
import { telegramUpdateSchema } from '../telegram-business/types.js';
import { AppError } from '../utils/errors.js';
import { registerMiniAppApi } from '../mini-app/routes.js';
import { registerMiniAppStatic } from '../mini-app/static.js';
export async function buildServer(config, services, logger) {
    const app = Fastify({
        loggerInstance: logger,
        trustProxy: config.http.trustProxy,
        bodyLimit: 1_048_576,
        requestIdHeader: 'x-request-id',
        genReqId: () => randomUUID(),
    });
    await app.register(helmet, {
        global: true,
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", 'https://telegram.org'],
                styleSrc: ["'self'"],
                imgSrc: ["'self'", 'data:'],
                fontSrc: ["'self'"],
                connectSrc: ["'self'"],
                objectSrc: ["'none'"],
                baseUri: ["'none'"],
                formAction: ["'self'"],
                frameAncestors: ["'self'", 'https://web.telegram.org', 'https://*.telegram.org'],
            },
        },
    });
    await app.register(sensible);
    await app.register(rateLimit, {
        global: false,
        max: config.http.rateLimitMax,
        timeWindow: config.http.rateLimitWindow,
    });
    app.addHook('onRequest', (request, reply, done) => {
        void reply.header('x-request-id', request.id);
        request.log.trace({
            category: 'HTTP',
            method: request.method,
            url: request.url,
            headers: request.headers,
            ip: request.ip,
            reqId: request.id,
        }, 'incoming http request');
        done();
    });
    app.addHook('preHandler', (request, _reply, done) => {
        if (request.body !== undefined) {
            request.log.trace({
                category: 'HTTP',
                method: request.method,
                url: request.url,
                body: request.body,
                reqId: request.id,
            }, 'http request payload');
        }
        done();
    });
    app.addHook('onResponse', (request, reply, done) => {
        request.log.trace({
            category: 'HTTP',
            method: request.method,
            url: request.url,
            statusCode: reply.statusCode,
            responseTimeMs: reply.elapsedTime,
            reqId: request.id,
        }, 'http response sent');
        done();
    });
    app.get('/health/live', () => ({ status: 'ok' }));
    app.get('/health/ready', async (_request, reply) => {
        const report = await services.health.readiness();
        return reply.code(report.ready ? 200 : 503).send(report);
    });
    app.post(config.telegram.businessWebhookPath, {
        config: {
            rateLimit: { max: config.http.rateLimitMax, timeWindow: config.http.rateLimitWindow },
        },
    }, async (request, reply) => {
        const header = request.headers['x-telegram-bot-api-secret-token'];
        if (!validWebhookSecret(Array.isArray(header) ? header[0] : header, config.telegram.businessWebhookSecret)) {
            request.log.warn({
                category: 'WEBHOOK',
                messageFa: 'توکن وب‌هوک تجاری اشتباه است',
                errorCode: 'WEBHOOK_UNAUTHORIZED',
                path: config.telegram.businessWebhookPath,
            }, 'business webhook unauthorized - secret mismatch');
            return reply.code(401).send({ error: 'unauthorized' });
        }
        let update;
        try {
            update = telegramUpdateSchema.parse(request.body);
        }
        catch (err) {
            request.log.warn({
                category: 'WEBHOOK',
                messageFa: 'بدنه وب‌هوک تجاری نامعتبر بود',
                errorCode: 'WEBHOOK_INVALID_PAYLOAD',
                err,
            }, 'business webhook invalid payload');
            throw err;
        }
        const result = await services.businessIngestor.ingest(update, request.id);
        request.log.info({ updateId: update.update_id, updateType: result.type, duplicate: result.duplicate }, 'business update processed');
        return reply.code(200).send({ ok: true });
    });
    await registerMiniAppApi(app, services.miniAppAuth, services.miniAppManagement);
    registerMiniAppStatic(app);
    app.post(config.telegram.adminWebhookPath, {
        config: {
            rateLimit: { max: config.http.rateLimitMax, timeWindow: config.http.rateLimitWindow },
        },
    }, async (request, reply) => {
        const header = request.headers['x-telegram-bot-api-secret-token'];
        if (!validWebhookSecret(Array.isArray(header) ? header[0] : header, config.telegram.adminWebhookSecret)) {
            return reply.code(401).send({ error: 'unauthorized' });
        }
        const update = telegramUpdateSchema.parse(request.body);
        await services.adminHandler.handle(update, request.id);
        request.log.info({ updateId: update.update_id }, 'admin update processed');
        return reply.code(200).send({ ok: true });
    });
    app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: 'not_found' }));
    app.setErrorHandler(async (error, request, reply) => {
        const sc = typeof error === 'object' &&
            error !== null &&
            'statusCode' in error &&
            typeof error.statusCode === 'number'
            ? error.statusCode
            : 500;
        if (sc >= 500) {
            request.log.error({
                err: error,
                category: 'HTTP',
                messageFa: 'درخواست با خطای سرور مواجه شد',
                errorCode: 'INTERNAL_ERROR',
                statusCode: sc,
            }, `request failed ${request.method} ${request.url}: ${error instanceof Error ? error.message : String(error)}`);
        }
        else {
            request.log.warn({ err: error, statusCode: sc }, 'request client error');
        }
        const genericStatus = typeof error === 'object' &&
            error !== null &&
            'statusCode' in error &&
            typeof error.statusCode === 'number'
            ? error.statusCode
            : 500;
        const statusCode = error instanceof AppError ? error.statusCode : genericStatus;
        const errorCode = statusCode >= 500
            ? 'INTERNAL_ERROR'
            : error instanceof AppError
                ? error.code === 'UNAUTHORIZED'
                    ? 'ACCESS_DENIED'
                    : error.code
                : 'INVALID_REQUEST';
        const message = statusCode >= 500
            ? 'خطایی در سامانه رخ داد. دوباره تلاش کنید.'
            : statusCode === 401 || statusCode === 403
                ? 'دسترسی شما مجاز نیست یا نشست شما پایان یافته است.'
                : statusCode === 404
                    ? 'این مورد در دسترس نیست یا اجازه مشاهده آن را ندارید.'
                    : statusCode === 429
                        ? 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.'
                        : statusCode === 409
                            ? 'وضعیت این مورد تغییر کرده است. صفحه را تازه کنید.'
                            : 'اطلاعات ارسال‌شده معتبر نیست.';
        return reply.code(statusCode).send({
            error: { code: errorCode, message },
            requestId: request.id,
        });
    });
    return app;
}
//# sourceMappingURL=server.js.map