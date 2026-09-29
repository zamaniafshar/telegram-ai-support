import { PrismaClient } from '@prisma/client';
import { isInsideSystemLogger } from '../observability/types.js';
export function createPrismaClient(config, logger) {
    const prisma = new PrismaClient({
        log: [
            { emit: 'event', level: 'query' },
            { emit: 'event', level: 'info' },
            { emit: 'event', level: 'warn' },
            { emit: 'event', level: 'error' },
        ],
    });
    if (logger && typeof prisma.$on === 'function') {
        prisma.$on('query', (e) => {
            const isSystemLog = isInsideSystemLogger() || /systemlog/i.test(e.query);
            logger.trace({
                category: 'DATABASE',
                query: e.query,
                params: e.params,
                durationMs: e.duration,
                target: e.target,
                _fromSystemLogger: isSystemLog,
            }, `db query executed (${e.duration}ms)`);
        });
        prisma.$on('error', (e) => {
            const isSystemLog = isInsideSystemLogger() || /systemlog/i.test(e.message);
            logger.error({
                category: 'DATABASE',
                target: e.target,
                message: e.message,
                _fromSystemLogger: isSystemLog,
            }, 'database error');
        });
        prisma.$on('warn', (e) => {
            const isSystemLog = isInsideSystemLogger() || /systemlog/i.test(e.message);
            logger.warn({
                category: 'DATABASE',
                target: e.target,
                message: e.message,
                _fromSystemLogger: isSystemLog,
            }, 'database warning');
        });
        prisma.$on('info', (e) => {
            const isSystemLog = isInsideSystemLogger() || /systemlog/i.test(e.message);
            logger.info({
                category: 'DATABASE',
                target: e.target,
                message: e.message,
                _fromSystemLogger: isSystemLog,
            }, 'database info');
        });
    }
    return prisma;
}
export async function databaseHealthy(prisma) {
    try {
        await prisma.$queryRaw `SELECT 1`;
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=prisma.js.map