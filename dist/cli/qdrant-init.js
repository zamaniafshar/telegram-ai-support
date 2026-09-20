import { loadLocalEnvFile } from '../config/load-env-file.js';
loadLocalEnvFile();
const { loadConfig } = await import('../config/env.js');
const { createLogger } = await import('../observability/logger.js');
const { createServices } = await import('../app.js');
const { embeddingDimensions } = await import('../indexing/reindex.js');
const config = loadConfig();
const logger = createLogger(config);
const services = createServices(config, logger);
const dimensions = await embeddingDimensions(config, services.openai);
await services.vectors.ensureCollection(dimensions);
await services.prisma.$disconnect();
console.log(`Qdrant collection ${config.qdrant.collection} is ready with ${dimensions} dimensions.`);
//# sourceMappingURL=qdrant-init.js.map