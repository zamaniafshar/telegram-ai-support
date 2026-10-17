import { randomUUID } from 'node:crypto';
import { loadLocalEnvFile } from './config/load-env-file.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './observability/logger.js';
import { createServices } from './app.js';
import { buildServer } from './http/server.js';
import { LongPollingRunner } from './telegram-business/polling.js';

loadLocalEnvFile();

async function bootstrap() {
    const config = loadConfig();
    const logger = createLogger(config);
    const services = createServices(config, logger);
    const app = await buildServer(config, services, logger);
    const abortController = new AbortController();
    const backgroundTasks = [];

    if (config.worker.runInApi) {
        backgroundTasks.push(services.worker.run(abortController.signal));
    }

    if (config.telegram.transport === 'polling') {
        await Promise.all([
            services.businessTelegram.deleteWebhook(false),
            services.adminTelegram.deleteWebhook(false),
        ]);
        const businessPolling = new LongPollingRunner(services.businessTelegram, [
            'business_connection',
            'business_message',
            'edited_business_message',
            'deleted_business_messages',
        ], async (update) => {
            await services.businessIngestor.ingest(update, randomUUID());
        }, logger);
        const adminPolling = new LongPollingRunner(services.adminTelegram, ['message'], async (update) => {
            await services.adminHandler.handle(update, randomUUID());
        }, logger);
        backgroundTasks.push(businessPolling.run(abortController.signal), adminPolling.run(abortController.signal));
    }

    // Determine whether LiteSpeed passed a Unix socket path or a port number
    const portEnv = process.env.PORT;
    if (portEnv && isNaN(Number(portEnv))) {
        // Unix domain socket path
        await app.listen({ path: portEnv });
    } else {
        // TCP port
        await app.listen({
            host: portEnv ? '0.0.0.0' : config.http.host,
            port: portEnv ? Number(portEnv) : config.http.port,
        });
    }

    logger.info({ host: config.http.host, port: process.env.PORT || config.http.port, transport: config.telegram.transport }, 'application started');

    let shuttingDown = false;
    async function shutdown(signal) {
        if (shuttingDown)
            return;
        shuttingDown = true;
        logger.info({ signal }, 'graceful shutdown started');
        abortController.abort();
        const timeout = new Promise((resolve) => setTimeout(resolve, config.shutdownTimeoutMs));
        await Promise.race([Promise.allSettled(backgroundTasks).then(() => undefined), timeout]);
        await app.close();
        await logger.flushDb?.();
        await services.prisma.$disconnect();
        logger.info('graceful shutdown completed');
    }
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
    console.error('[main] Fatal startup error:', err);
    process.exit(1);
});
