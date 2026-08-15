import { AdminRole } from '@prisma/client';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyRequest,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify';
import { z } from 'zod';
import { capabilities } from './authorization.js';
import type { MiniAppAuthService, MiniAppSessionContext } from './auth.js';
import type { MiniAppManagementService } from './service.js';
import { ValidationError } from '../utils/errors.js';

const idSchema = z.string().min(1).max(128);
const businessParams = z.object({ businessId: idSchema });
const entityParams = businessParams.extend({ id: idSchema });
const conversationParams = businessParams.extend({ conversationId: idSchema });
const analyticsTraceParams = businessParams.extend({ traceId: idSchema });
const analyticsFilters = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  outcome: z.string().max(32).optional(),
});
const scheduleIntervalSchema = z
  .object({
    start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    overnight: z.boolean(),
  })
  .strict();
const dayScheduleSchema = z
  .object({
    day: z.enum(['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']),
    enabled: z.boolean(),
    allDay: z.boolean(),
    intervals: z.array(scheduleIntervalSchema).max(12),
  })
  .strict();
const aiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    timezone: z.string().min(3).max(64),
    weeklySchedule: z.array(dayScheduleSchema).length(7),
    version: z.number().int().nonnegative(),
    outsideHoursPolicy: z.enum(['QUEUE', 'HANDOFF', 'SILENT']),
    manualShutdownPolicy: z.enum(['QUEUE', 'HANDOFF', 'SILENT']),
    backlogMaxAgeHours: z.number().int().min(1).max(48),
    reason: z.string().max(500).optional(),
  })
  .strict();

function data<T>(value: T) {
  return { data: value };
}

async function mutationContext(
  request: FastifyRequest,
  auth: MiniAppAuthService,
): Promise<MiniAppSessionContext> {
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
    throw new ValidationError('Idempotency key is missing or invalid', 'INVALID_IDEMPOTENCY_KEY');
  }
  const context = await auth.requireSession(request);
  await auth.verifyCsrf(request, context);
  return context;
}

export async function registerMiniAppApi<LoggerType extends FastifyBaseLogger>(
  app: FastifyInstance<
    RawServerDefault,
    RawRequestDefaultExpression,
    RawReplyDefaultExpression,
    LoggerType
  >,
  auth: MiniAppAuthService,
  management: MiniAppManagementService,
): Promise<void> {
  await app.register((api, _options, done) => {
    api.addHook(
      'onRequest',
      api.rateLimit({ max: 180, timeWindow: '1 minute', groupId: 'mini-app-api' }),
    );
    registerMiniAppRoutes(api, auth, management);
    done();
  });
}

function registerMiniAppRoutes(
  app: FastifyInstance,
  auth: MiniAppAuthService,
  management: MiniAppManagementService,
): void {
  app.post(
    '/api/v1/auth/telegram',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, bodyLimit: 16_384 },
    async (request, reply) => {
      const body = z.object({ initData: z.string().min(1).max(8_192) }).parse(request.body);
      const session = await auth.exchange(body.initData);
      void reply.header('set-cookie', auth.sessionCookie(session.token));
      return data({
        csrfToken: session.csrfToken,
        admin: {
          id: session.context.admin.id,
          displayName: session.context.admin.displayName,
          role: session.context.admin.role,
        },
        businesses: management.businesses(session.context),
        capabilities: capabilities(session.context),
      });
    },
  );

  app.post(
    '/api/v1/auth/development',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, bodyLimit: 1_024 },
    async (request, reply) => {
      const address = request.ip.replace(/^::ffff:/, '');
      if (address !== '127.0.0.1' && address !== '::1') {
        throw new ValidationError(
          'Development login is local only',
          'DEVELOPMENT_LOGIN_LOCAL_ONLY',
        );
      }
      const session = await auth.developmentExchange();
      void reply.header('set-cookie', auth.sessionCookie(session.token, true));
      return data({
        csrfToken: session.csrfToken,
        admin: {
          id: session.context.admin.id,
          displayName: session.context.admin.displayName,
          role: session.context.admin.role,
        },
        businesses: management.businesses(session.context),
        capabilities: capabilities(session.context),
        developmentMode: true,
      });
    },
  );

  app.get('/api/v1/session', async (request) => {
    const context = await auth.requireSession(request);
    return data({
      csrfToken: await auth.rotateCsrf(context),
      admin: {
        id: context.admin.id,
        displayName: context.admin.displayName,
        role: context.admin.role,
      },
      businesses: management.businesses(context),
      capabilities: capabilities(context),
      developmentMode: auth.isDevelopmentSession(request),
    });
  });

  app.delete('/api/v1/session', async (request, reply) => {
    const context = await mutationContext(request, auth);
    await auth.revoke(context);
    void reply.header('set-cookie', auth.clearCookie());
    return reply.code(204).send();
  });

  app.get('/api/v1/businesses/:businessId/dashboard', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    return data(await management.dashboard(context, businessId));
  });

  app.get('/api/v1/businesses/:businessId/analytics/overview', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    const query = analyticsFilters.parse(request.query);
    return data(await management.analyticsOverview(context, businessId, query));
  });

  app.get('/api/v1/businesses/:businessId/analytics/traces', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    const query = analyticsFilters
      .extend({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query);
    return data(await management.analyticsTraces(context, businessId, query));
  });

  app.get('/api/v1/businesses/:businessId/analytics/traces/:traceId', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId, traceId } = analyticsTraceParams.parse(request.params);
    return data(await management.analyticsTraceDetails(context, businessId, traceId));
  });

  app.get('/api/v1/businesses/:businessId/handoffs', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    const query = z
      .object({ status: z.string().max(200).optional(), query: z.string().max(100).optional() })
      .parse(request.query);
    return data(await management.listHandoffs(context, businessId, query));
  });

  app.get('/api/v1/businesses/:businessId/handoffs/:conversationId', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId, conversationId } = conversationParams.parse(request.params);
    return data(await management.handoffDetails(context, businessId, conversationId));
  });

  for (const action of ['claim', 'acknowledge', 'extend', 'enable-ai'] as const) {
    app.post(
      `/api/v1/businesses/:businessId/handoffs/:conversationId/${action}`,
      async (request) => {
        const context = await mutationContext(request, auth);
        const { businessId, conversationId } = conversationParams.parse(request.params);
        if (action === 'claim') await management.claimHandoff(context, businessId, conversationId);
        if (action === 'acknowledge') {
          await management.acknowledgeHandoff(context, businessId, conversationId);
        }
        if (action === 'extend') {
          return data({
            expiresAt: await management.extendHandoff(context, businessId, conversationId),
          });
        }
        if (action === 'enable-ai') await management.enableAi(context, businessId, conversationId);
        return data({ ok: true });
      },
    );
  }

  app.post('/api/v1/businesses/:businessId/handoffs/:conversationId/resolve', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId, conversationId } = conversationParams.parse(request.params);
    const body = z
      .object({ outcome: z.string().min(1).max(80), note: z.string().max(2_000).optional() })
      .parse(request.body);
    await management.resolveHandoff(context, businessId, conversationId, body);
    return data({ ok: true });
  });

  app.get('/api/v1/businesses/:businessId/conversations', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    const query = z
      .object({ mode: z.string().max(32).optional(), query: z.string().max(100).optional() })
      .parse(request.query);
    return data(await management.listConversations(context, businessId, query));
  });

  app.get('/api/v1/businesses/:businessId/conversations/:id', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId, id } = entityParams.parse(request.params);
    return data(await management.conversationDetails(context, businessId, id));
  });

  app.get('/api/v1/businesses/:businessId/ai-backlog', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    return data(await management.aiBacklog(context, businessId));
  });

  app.post('/api/v1/businesses/:businessId/ai-backlog/:conversationId/:action', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId, conversationId } = conversationParams.parse(request.params);
    const { action } = z
      .object({ action: z.enum(['handoff', 'cancel', 'process-now']) })
      .parse(request.params);
    await management.manageAiBacklog(context, businessId, conversationId, action);
    return data({ ok: true });
  });

  app.get('/api/v1/businesses/:businessId/knowledge', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    const query = z.object({ query: z.string().max(200).optional() }).parse(request.query);
    return data(await management.listKnowledge(context, businessId, query));
  });

  app.get('/api/v1/businesses/:businessId/knowledge/:id', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId, id } = entityParams.parse(request.params);
    return data(await management.knowledgeDetails(context, businessId, id));
  });

  app.post('/api/v1/businesses/:businessId/knowledge/drafts', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId } = businessParams.parse(request.params);
    const body = z.object({ knowledgeItemId: idSchema.optional() }).parse(request.body ?? {});
    return data(await management.createKnowledgeDraft(context, businessId, body.knowledgeItemId));
  });

  app.get('/api/v1/businesses/:businessId/knowledge/drafts/:id', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId, id } = entityParams.parse(request.params);
    return data(await management.knowledgeDraftDetails(context, businessId, id));
  });

  app.patch('/api/v1/businesses/:businessId/knowledge/drafts/:id', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId, id } = entityParams.parse(request.params);
    const body = z
      .object({
        revision: z.number().int().positive(),
        title: z.string().max(200).optional(),
        description: z.string().max(100_000).optional(),
      })
      .refine((value) => value.title !== undefined || value.description !== undefined)
      .parse(request.body);
    return data(await management.updateKnowledgeDraft(context, businessId, id, body));
  });

  app.post('/api/v1/businesses/:businessId/knowledge/drafts/:id/preview', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId, id } = entityParams.parse(request.params);
    return data(await management.previewKnowledgeDraft(context, businessId, id));
  });

  app.post('/api/v1/businesses/:businessId/knowledge/drafts/:id/publish', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId, id } = entityParams.parse(request.params);
    const body = z.object({ revision: z.number().int().positive() }).parse(request.body);
    return data(await management.publishKnowledgeDraft(context, businessId, id, body.revision));
  });

  app.patch('/api/v1/businesses/:businessId/knowledge/:id/active', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId, id } = entityParams.parse(request.params);
    const body = z.object({ isActive: z.boolean() }).parse(request.body);
    return data(await management.setKnowledgeActive(context, businessId, id, body.isActive));
  });

  app.post('/api/v1/businesses/:businessId/knowledge/:id/indexing/retry', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId, id } = entityParams.parse(request.params);
    await management.retryKnowledge(context, businessId, id);
    return data({ ok: true });
  });

  app.delete('/api/v1/businesses/:businessId/knowledge/:id', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId, id } = entityParams.parse(request.params);
    const deletion = await management.deleteKnowledge(context, businessId, id);
    return data({ ok: true, ...deletion });
  });

  app.get('/api/v1/businesses/:businessId/connections', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    return data(await management.listConnections(context, businessId));
  });

  app.get('/api/v1/businesses/:businessId/system', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    return data(await management.systemHealth(context, businessId));
  });

  app.get('/api/v1/businesses/:businessId/admins', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    return data(await management.listAdmins(context, businessId));
  });

  app.post('/api/v1/businesses/:businessId/admins', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId } = businessParams.parse(request.params);
    const body = z
      .object({
        telegramUserId: z.string().regex(/^\d{1,20}$/),
        role: z.enum([AdminRole.ADMIN, AdminRole.SUPPORT]),
        displayName: z.string().max(200).optional(),
      })
      .parse(request.body);
    return data(await management.addAdmin(context, businessId, body));
  });

  app.patch('/api/v1/businesses/:businessId/admins/:id', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId, id } = entityParams.parse(request.params);
    const body = z
      .object({
        role: z.enum([AdminRole.ADMIN, AdminRole.SUPPORT]).optional(),
        isActive: z.boolean().optional(),
      })
      .refine((value) => value.role !== undefined || value.isActive !== undefined)
      .parse(request.body);
    return data(await management.updateAdmin(context, businessId, id, body));
  });

  app.delete('/api/v1/businesses/:businessId/admins/:id/access', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId, id } = entityParams.parse(request.params);
    await management.removeAdminAccess(context, businessId, id);
    return data({ ok: true });
  });

  app.get('/api/v1/businesses/:businessId/audit', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    const query = z.object({ action: z.string().max(120).optional() }).parse(request.query);
    return data(await management.audit(context, businessId, query));
  });

  app.get('/api/v1/businesses/:businessId/settings', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    return data(management.settings(context, businessId));
  });

  app.get('/api/v1/businesses/:businessId/ai-settings', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    return data(await management.aiSettings(context, businessId));
  });

  app.put('/api/v1/businesses/:businessId/ai-settings', async (request) => {
    const context = await mutationContext(request, auth);
    const { businessId } = businessParams.parse(request.params);
    const body = aiSettingsSchema.parse(request.body);
    return data(await management.updateAiSettings(context, businessId, body, request.id));
  });

  app.get('/api/v1/businesses/:businessId/ai-availability', async (request) => {
    const context = await auth.requireSession(request);
    const { businessId } = businessParams.parse(request.params);
    return data(await management.aiAvailability(context, businessId));
  });

  app.get('/api/v1/notifications', async (request) => {
    const context = await auth.requireSession(request);
    return data(await management.notifications(context));
  });

  app.post('/api/v1/notifications/:id/read', async (request) => {
    const context = await mutationContext(request, auth);
    const { id } = z.object({ id: idSchema }).parse(request.params);
    await management.markNotificationRead(context, id);
    return data({ ok: true });
  });
}
