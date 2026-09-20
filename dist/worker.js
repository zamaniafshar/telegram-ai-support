import { loadLocalEnvFile } from './config/load-env-file.js';
loadLocalEnvFile();
const { loadConfig } = await import('./config/env.js');
const { createLogger } = await import('./observability/logger.js');
const { createServices } = await import('./app.js');
const config = loadConfig();
const logger = createLogger(config);
const services = createServices(config, logger);
const abortController = new AbortController();
process.once('SIGTERM', () => abortController.abort());
process.once('SIGINT', () => abortController.abort());
await services.worker.run(abortController.signal);
await services.prisma.$disconnect();
//# sourceMappingURL=worker.js.map