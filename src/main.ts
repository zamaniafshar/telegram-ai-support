import { randomUUID } from 'node:crypto';
import { loadLocalEnvFile } from './config/load-env-file.js';

loadLocalEnvFile();

const { loadConfig } = await import('./config/env.js');
const { createLogger } = await import('./observability/logger.js');
const { createServices } = await import('./app.js');
const { buildServer } = await import('./http/server.js');
const { LongPollingRunner } = await import('./telegram-business/polling.js');

const config = loadConfig();
const logger = createLogger(config);
const services = createServices(config, logger);
const app = await buildServer(config, services, logger);
const abortController = new AbortController();
const backgroundTasks: Promise<void>[] = [];

if (config.worker.runInApi) {
  backgroundTasks.push(services.worker.run(abortController.signal));
}

if (config.telegram.transport === 'polling') {
  await Promise.all([
    services.businessTelegram.deleteWebhook(false),
    services.adminTelegram.deleteWebhook(false),
  ]);
  const businessPolling = new LongPollingRunner(
    services.businessTelegram,
    [
      'business_connection',
      'business_message',
      'edited_business_message',
      'deleted_business_messages',
    ],
    async (update) => {
      await services.businessIngestor.ingest(update, randomUUID());
    },
    logger,
    services.systemLogger,
  );
  const adminPolling = new LongPollingRunner(
    services.adminTelegram,
    ['message'],
    async (update) => {
      await services.adminHandler.handle(update, randomUUID());
    },
    logger,
    services.systemLogger,
  );
  backgroundTasks.push(
    businessPolling.run(abortController.signal),
    adminPolling.run(abortController.signal),
  );
}

await app.listen({ host: config.http.host, port: config.http.port });
logger.info(
  { host: config.http.host, port: config.http.port, transport: config.telegram.transport },
  'application started',
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'graceful shutdown started');
  abortController.abort();
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, config.shutdownTimeoutMs));
  await Promise.race([Promise.allSettled(backgroundTasks).then(() => undefined), timeout]);
  await app.close();
  await services.prisma.$disconnect();
  logger.info('graceful shutdown completed');
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
