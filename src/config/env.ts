import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const positiveInt = (defaultValue: number) =>
  z.coerce.number().int().positive().default(defaultValue);

const nonNegativeInt = (defaultValue: number) =>
  z.coerce.number().int().nonnegative().default(defaultValue);

const bigIntString = z
  .string()
  .regex(/^\d+$/, 'must be an unsigned decimal Telegram ID')
  .transform((value) => BigInt(value));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  PUBLIC_BASE_URL: z.url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PERSONAL_DATA: booleanString,
  SHUTDOWN_TIMEOUT_MS: positiveInt(10_000),
  DATABASE_URL: z.string().startsWith('mysql://'),

  TELEGRAM_BUSINESS_BOT_TOKEN: z.string().min(10),
  TELEGRAM_BUSINESS_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  TELEGRAM_BUSINESS_WEBHOOK_PATH: z
    .string()
    .regex(/^\/[A-Za-z0-9/_-]+$/)
    .default('/webhooks/telegram/business'),
  TELEGRAM_ADMIN_BOT_TOKEN: z.string().min(10),
  TELEGRAM_ADMIN_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  TELEGRAM_ADMIN_WEBHOOK_PATH: z
    .string()
    .regex(/^\/[A-Za-z0-9/_-]+$/)
    .default('/webhooks/telegram/admin'),
  TELEGRAM_OWNER_ID: bigIntString,
  TELEGRAM_INITIAL_ADMIN_IDS: z.string().default(''),
  TELEGRAM_MARK_READ: booleanString,
  TELEGRAM_TRANSPORT: z.enum(['webhook', 'polling']).default('webhook'),
  MINI_APP_URL: z.union([z.literal(''), z.url()]).default(''),
  MINI_APP_AUTH_MAX_AGE_SECONDS: positiveInt(300),
  MINI_APP_SESSION_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  MINI_APP_DEV_ADMIN_ID: z.string().regex(/^\d+$/).optional(),
  BUSINESS_DEFAULT_TIMEZONE: z.string().min(3).max(64).default('Asia/Tehran'),

  OPENAI_API_KEY: z.string().min(10),
  OPENAI_BASE_URL: z.url().default('https://nano-gpt.com/api/v1'),
  OPENAI_CHAT_MODEL: z.string().min(1),
  OPENAI_EMBEDDING_MODEL: z.string().min(1),
  OPENAI_EMBEDDING_DIMENSIONS: nonNegativeInt(0),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  OPENAI_TIMEOUT_MS: positiveInt(30_000),
  NANOGPT_BALANCE_URL: z.url().default('https://nano-gpt.com/api/check-balance'),
  NANOGPT_LOW_BALANCE_USD: z.coerce.number().positive().default(3),
  NANOGPT_BALANCE_CHECK_INTERVAL_HOURS: positiveInt(24),
  NANOGPT_INSUFFICIENT_ALERT_COOLDOWN_HOURS: positiveInt(24),

  QDRANT_URL: z.url(),
  QDRANT_API_KEY: z.string().default(''),
  QDRANT_COLLECTION: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default('telegram_support_knowledge'),
  QDRANT_TIMEOUT_MS: positiveInt(10_000),

  RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.72),
  RETRIEVAL_LIMIT: z.coerce.number().int().min(1).max(50).default(8),
  CONVERSATION_CONTEXT_MESSAGES: z.coerce.number().int().min(0).max(30).default(8),
  SAFE_GREETING_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  MAX_CUSTOMER_MESSAGE_LENGTH: positiveInt(8_000),
  MAX_KNOWLEDGE_TITLE_LENGTH: positiveInt(200),
  MAX_KNOWLEDGE_DESCRIPTION_LENGTH: positiveInt(100_000),
  CHUNK_MAX_CHARS: z.coerce.number().int().min(300).max(10_000).default(1_800),
  CHUNK_OVERLAP_CHARS: z.coerce.number().int().min(0).max(2_000).default(250),
  MESSAGE_DEBOUNCE_MS: nonNegativeInt(1_200),
  HANDOFF_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  TELEGRAM_REPLY_WINDOW_HOURS: z.coerce.number().int().min(1).max(48).default(24),
  HANDOFF_CUSTOMER_MESSAGE: z
    .string()
    .min(1)
    .max(1_000)
    .default(
      'برای پاسخ دقیق‌تر، گفت‌وگوی شما به پشتیبانی انسانی ارجاع داده شد. همکاران ما پیام شما را بررسی خواهند کرد.',
    ),
  HANDOFF_CUSTOMER_MESSAGE_ENABLED: booleanString,

  WORKER_POLL_INTERVAL_MS: positiveInt(1_500),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  JOB_LEASE_MS: positiveInt(120_000),
  INDEXING_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
  INDEXING_BACKOFF_BASE_MS: positiveInt(5_000),
  ADMIN_NOTIFY_ADDITIONAL_MESSAGES: booleanString,
  RUN_WORKERS_IN_API: booleanString,

  TRUST_PROXY: booleanString,
  WEBHOOK_RATE_LIMIT_MAX: positiveInt(300),
  WEBHOOK_RATE_LIMIT_WINDOW: z.string().default('1 minute'),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(source);
  const initialAdminIds = env.TELEGRAM_INITIAL_ADMIN_IDS.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => bigIntString.parse(value));

  if (env.CHUNK_OVERLAP_CHARS >= env.CHUNK_MAX_CHARS) {
    throw new Error('CHUNK_OVERLAP_CHARS must be smaller than CHUNK_MAX_CHARS');
  }

  if (env.TELEGRAM_BUSINESS_WEBHOOK_PATH === env.TELEGRAM_ADMIN_WEBHOOK_PATH) {
    throw new Error('Business and admin webhook paths must be different');
  }

  if (env.TELEGRAM_BUSINESS_WEBHOOK_SECRET === env.TELEGRAM_ADMIN_WEBHOOK_SECRET) {
    throw new Error('Business and admin webhook secrets must be different');
  }

  if (env.NODE_ENV === 'production' && env.TELEGRAM_TRANSPORT !== 'webhook') {
    throw new Error('Production requires TELEGRAM_TRANSPORT=webhook');
  }

  if (env.NODE_ENV === 'production' && !env.PUBLIC_BASE_URL.startsWith('https://')) {
    throw new Error('Production requires an HTTPS PUBLIC_BASE_URL');
  }

  const miniAppUrl = (
    env.MINI_APP_URL || `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/mini-app/`
  ).replace(/\/$/, '');
  if (env.NODE_ENV === 'production' && !miniAppUrl.startsWith('https://')) {
    throw new Error('Production requires an HTTPS MINI_APP_URL');
  }
  if (env.NODE_ENV === 'production' && env.MINI_APP_DEV_ADMIN_ID) {
    throw new Error('MINI_APP_DEV_ADMIN_ID must never be set in production');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: env.BUSINESS_DEFAULT_TIMEZONE }).format();
  } catch {
    throw new Error('BUSINESS_DEFAULT_TIMEZONE must be a valid IANA timezone');
  }

  return {
    nodeEnv: env.NODE_ENV,
    http: {
      host: env.HOST,
      port: env.PORT,
      publicBaseUrl: env.PUBLIC_BASE_URL.replace(/\/$/, ''),
      trustProxy: env.TRUST_PROXY,
      rateLimitMax: env.WEBHOOK_RATE_LIMIT_MAX,
      rateLimitWindow: env.WEBHOOK_RATE_LIMIT_WINDOW,
    },
    log: { level: env.LOG_LEVEL, personalData: env.LOG_PERSONAL_DATA },
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    databaseUrl: env.DATABASE_URL,
    telegram: {
      businessBotToken: env.TELEGRAM_BUSINESS_BOT_TOKEN,
      businessWebhookSecret: env.TELEGRAM_BUSINESS_WEBHOOK_SECRET,
      businessWebhookPath: env.TELEGRAM_BUSINESS_WEBHOOK_PATH,
      adminBotToken: env.TELEGRAM_ADMIN_BOT_TOKEN,
      adminWebhookSecret: env.TELEGRAM_ADMIN_WEBHOOK_SECRET,
      adminWebhookPath: env.TELEGRAM_ADMIN_WEBHOOK_PATH,
      ownerId: env.TELEGRAM_OWNER_ID,
      initialAdminIds,
      markRead: env.TELEGRAM_MARK_READ,
      transport: env.TELEGRAM_TRANSPORT,
      replyWindowHours: env.TELEGRAM_REPLY_WINDOW_HOURS,
      miniAppUrl,
      miniAppAuthMaxAgeSeconds: env.MINI_APP_AUTH_MAX_AGE_SECONDS,
      miniAppSessionHours: env.MINI_APP_SESSION_HOURS,
      miniAppDevAdminId: env.MINI_APP_DEV_ADMIN_ID ? BigInt(env.MINI_APP_DEV_ADMIN_ID) : undefined,
    },
    openai: {
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL.replace(/\/$/, ''),
      chatModel: env.OPENAI_CHAT_MODEL,
      embeddingModel: env.OPENAI_EMBEDDING_MODEL,
      embeddingDimensions: env.OPENAI_EMBEDDING_DIMENSIONS || undefined,
      maxRetries: env.OPENAI_MAX_RETRIES,
      timeoutMs: env.OPENAI_TIMEOUT_MS,
    },
    nanoGptCredit: {
      balanceUrl: env.NANOGPT_BALANCE_URL,
      lowBalanceUsd: env.NANOGPT_LOW_BALANCE_USD,
      checkIntervalHours: env.NANOGPT_BALANCE_CHECK_INTERVAL_HOURS,
      insufficientAlertCooldownHours: env.NANOGPT_INSUFFICIENT_ALERT_COOLDOWN_HOURS,
    },
    qdrant: {
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY || undefined,
      collection: env.QDRANT_COLLECTION,
      timeoutMs: env.QDRANT_TIMEOUT_MS,
    },
    rag: {
      retrievalMinScore: env.RETRIEVAL_MIN_SCORE,
      retrievalLimit: env.RETRIEVAL_LIMIT,
      contextMessages: env.CONVERSATION_CONTEXT_MESSAGES,
      maxCustomerMessageLength: env.MAX_CUSTOMER_MESSAGE_LENGTH,
      maxKnowledgeTitleLength: env.MAX_KNOWLEDGE_TITLE_LENGTH,
      maxKnowledgeDescriptionLength: env.MAX_KNOWLEDGE_DESCRIPTION_LENGTH,
      chunkMaxChars: env.CHUNK_MAX_CHARS,
      chunkOverlapChars: env.CHUNK_OVERLAP_CHARS,
      debounceMs: env.MESSAGE_DEBOUNCE_MS,
    },
    routing: {
      safeGreetingEnabled: env.SAFE_GREETING_ENABLED,
    },
    business: { defaultTimezone: env.BUSINESS_DEFAULT_TIMEZONE },
    handoff: {
      hours: env.HANDOFF_HOURS,
      customerMessage: env.HANDOFF_CUSTOMER_MESSAGE,
      customerMessageEnabled: env.HANDOFF_CUSTOMER_MESSAGE_ENABLED,
      notifyAdditionalMessages: env.ADMIN_NOTIFY_ADDITIONAL_MESSAGES,
    },
    worker: {
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      batchSize: env.WORKER_BATCH_SIZE,
      leaseMs: env.JOB_LEASE_MS,
      indexingMaxAttempts: env.INDEXING_MAX_ATTEMPTS,
      indexingBackoffBaseMs: env.INDEXING_BACKOFF_BASE_MS,
      runInApi: env.RUN_WORKERS_IN_API,
    },
  } as const;
}
