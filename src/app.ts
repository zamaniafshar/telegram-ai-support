import type { Logger } from 'pino';
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from './config/env.js';
import { createPrismaClient } from './database/prisma.js';
import { OpenAiAdapter } from './ai/openai.js';
import { QdrantVectorStore } from './retrieval/qdrant.js';
import { RetrievalService } from './retrieval/service.js';
import { TelegramBotApiClient } from './telegram-business/client.js';
import { AdminNotifier } from './telegram-admin/notifier.js';
import { HandoffService } from './handoffs/service.js';
import { IndexingService } from './indexing/service.js';
import { BusinessMessenger } from './telegram-business/messenger.js';
import { ConversationProcessor } from './conversations/processor.js';
import { KnowledgeService } from './knowledge/service.js';
import { AdminAuthorizer } from './security/admin-authorization.js';
import { HealthService } from './observability/health.js';
import { SystemLogger } from './observability/system-logger.js';
import { BusinessUpdateIngestor } from './telegram-business/ingest.js';
import { AdminBotHandler } from './telegram-admin/handler.js';
import { WorkerRunner } from './workers/runner.js';
import { NanoGptBalanceClient, NanoGptCreditMonitor } from './ai/nanogpt-credit.js';
import { MiniAppAuthService } from './mini-app/auth.js';
import { MiniAppManagementService } from './mini-app/service.js';
import { AiAvailabilityService } from './ai/availability.js';

export function createServices(config: AppConfig, logger: Logger, prisma?: PrismaClient) {
  const database = prisma ?? createPrismaClient(config, logger);
  const systemLogger = new SystemLogger(database as unknown as never, logger, config);
  systemLogger.attachToLogger(logger);
  const businessTelegram = new TelegramBotApiClient(
    config.telegram.businessBotToken,
    15_000,
    logger,
  );
  const adminTelegram = new TelegramBotApiClient(config.telegram.adminBotToken, 15_000, logger);
  const notifier = new AdminNotifier(database, adminTelegram, config, logger);
  const nanoGptBalances = new NanoGptBalanceClient(config);
  const nanoGptCredit = new NanoGptCreditMonitor(
    database,
    nanoGptBalances,
    notifier,
    config,
    logger,
  );
  const openai = new OpenAiAdapter(config, nanoGptCredit, logger);
  const vectors = new QdrantVectorStore(config);
  const retrieval = new RetrievalService(database, openai, vectors, config, logger);
  const handoffs = new HandoffService(database, config, logger, notifier);
  const indexing = new IndexingService(database, openai, vectors, config, logger, notifier);
  const messenger = new BusinessMessenger(database, businessTelegram, config, logger, systemLogger);
  const aiAvailability = new AiAvailabilityService(database, config.business.defaultTimezone);
  const conversations = new ConversationProcessor(
    database,
    retrieval,
    openai,
    handoffs,
    messenger,
    notifier,
    aiAvailability,
    config,
    logger,
    systemLogger,
  );
  const knowledge = new KnowledgeService(database, config);
  const authorizer = new AdminAuthorizer(database);
  const health = new HealthService(database, vectors, businessTelegram, adminTelegram, config);
  const miniAppAuth = new MiniAppAuthService(database, config);
  const miniAppManagement = new MiniAppManagementService(
    database,
    knowledge,
    handoffs,
    health,
    config,
    aiAvailability,
    notifier,
    systemLogger,
  );
  const businessIngestor = new BusinessUpdateIngestor(database, businessTelegram, config, logger);
  const adminHandler = new AdminBotHandler(
    database,
    adminTelegram,
    authorizer,
    config.telegram.miniAppUrl,
    logger,
  );
  const worker = new WorkerRunner(
    indexing,
    conversations,
    handoffs,
    nanoGptCredit,
    notifier,
    config,
    logger,
    systemLogger,
  );
  return {
    prisma: database,
    businessTelegram,
    adminTelegram,
    openai,
    nanoGptBalances,
    nanoGptCredit,
    vectors,
    retrieval,
    notifier,
    handoffs,
    indexing,
    messenger,
    aiAvailability,
    conversations,
    knowledge,
    authorizer,
    health,
    miniAppAuth,
    miniAppManagement,
    businessIngestor,
    adminHandler,
    worker,
    systemLogger,
  };
}

export type Services = ReturnType<typeof createServices>;
