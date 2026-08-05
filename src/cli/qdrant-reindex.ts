import { randomUUID } from 'node:crypto';
import { IndexingJobStatus } from '@prisma/client';
import { loadLocalEnvFile } from '../config/load-env-file.js';

loadLocalEnvFile();
const { loadConfig } = await import('../config/env.js');
const { createLogger } = await import('../observability/logger.js');
const { createServices } = await import('../app.js');
const { enqueueFullReindex } = await import('../indexing/reindex.js');

const config = loadConfig();
const logger = createLogger(config);
const services = createServices(config, logger);
const queued = await enqueueFullReindex(services.prisma, services.vectors, services.openai, config);
const workerId = `reindex:${randomUUID()}`;
while (
  await services.prisma.indexingJob.count({
    where: {
      status: {
        in: [IndexingJobStatus.PENDING, IndexingJobStatus.RETRY, IndexingJobStatus.PROCESSING],
      },
    },
  })
) {
  const processed = await services.indexing.runBatch(workerId);
  if (processed === 0)
    await new Promise((resolve) => setTimeout(resolve, config.worker.pollIntervalMs));
}
const failed = await services.prisma.knowledgeItem.count({
  where: { isActive: true, deletedAt: null, indexingStatus: 'FAILED' },
});
await services.prisma.$disconnect();
if (failed > 0) throw new Error(`Reindex completed with ${failed} failed knowledge items`);
console.log(`Rebuilt ${queued} active knowledge items in ${config.qdrant.collection}.`);
