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
import { BusinessUpdateIngestor } from './telegram-business/ingest.js';
import { AdminBotHandler } from './telegram-admin/handler.js';
import { WorkerRunner } from './workers/runner.js';

export function createServices(config: AppConfig, logger: Logger, prisma?: PrismaClient) {
  const database = prisma ?? createPrismaClient();
  const businessTelegram = new TelegramBotApiClient(config.telegram.businessBotToken);
  const adminTelegram = new TelegramBotApiClient(config.telegram.adminBotToken);
  const openai = new OpenAiAdapter(config);
  const vectors = new QdrantVectorStore(config);
  const retrieval = new RetrievalService(database, openai, vectors, config);
  const notifier = new AdminNotifier(database, adminTelegram, logger);
  const handoffs = new HandoffService(database, config, logger, notifier);
  const indexing = new IndexingService(database, openai, vectors, config, logger, notifier);
  const messenger = new BusinessMessenger(database, businessTelegram, config, logger);
  const conversations = new ConversationProcessor(
    database,
    retrieval,
    openai,
    handoffs,
    messenger,
    notifier,
    config,
    logger,
  );
  const knowledge = new KnowledgeService(database, config);
  const authorizer = new AdminAuthorizer(database);
  const health = new HealthService(database, vectors, businessTelegram, adminTelegram, config);
  const businessIngestor = new BusinessUpdateIngestor(database, businessTelegram, config, logger);
  const adminHandler = new AdminBotHandler(
    database,
    adminTelegram,
    authorizer,
    knowledge,
    handoffs,
    health,
    logger,
  );
  const worker = new WorkerRunner(indexing, conversations, handoffs, config, logger);
  return {
    prisma: database,
    businessTelegram,
    adminTelegram,
    openai,
    vectors,
    retrieval,
    notifier,
    handoffs,
    indexing,
    messenger,
    conversations,
    knowledge,
    authorizer,
    health,
    businessIngestor,
    adminHandler,
    worker,
  };
}

export type Services = ReturnType<typeof createServices>;
