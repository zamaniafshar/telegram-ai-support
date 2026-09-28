import { Writable } from 'node:stream';
import pino from 'pino';
const redactPaths = [
    'req.headers.authorization',
    'req.headers.x-telegram-bot-api-secret-token',
    'config.openai.apiKey',
    'config.telegram.businessBotToken',
    'config.telegram.adminBotToken',
    'config.qdrant.apiKey',
    '*.apiKey',
    '*.token',
];
const levelValues = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
    fatal: 60,
    silent: 999,
};
function getMinLevel(a, b) {
    const valA = levelValues[a] ?? 30;
    const valB = levelValues[b] ?? 40;
    const minVal = Math.min(valA, valB);
    const found = Object.entries(levelValues).find(([, val]) => val === minVal);
    return (found ? found[0] : 'info');
}
export function createLogger(config) {
    const sinks = new Set();
    const dbStream = new Writable({
        write(chunk, _encoding, callback) {
            try {
                const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
                const record = JSON.parse(text);
                for (const sink of sinks) {
                    try {
                        sink(record);
                    }
                    catch {
                        // Ignore sink errors to avoid failing the logger
                    }
                }
            }
            catch {
                // Ignore JSON parse errors for non-JSON chunks
            }
            callback();
        },
    });
    const streams = [
        { stream: process.stdout, level: config.log.level },
    ];
    if (config.systemLog.enabled && config.systemLog.dbLevel !== 'silent') {
        streams.push({ stream: dbStream, level: config.systemLog.dbLevel });
    }
    const rootLevel = config.systemLog.enabled
        ? getMinLevel(config.log.level, config.systemLog.dbLevel)
        : config.log.level;
    const logger = pino({
        level: rootLevel,
        redact: { paths: redactPaths, censor: '[REDACTED]' },
        base: { service: 'telegram-ai-support', env: config.nodeEnv },
        serializers: {
            err: pino.stdSerializers.err,
            customerText: (value) => config.log.personalData || config.log.level === 'trace'
                ? String(value)
                : '[REDACTED_MESSAGE]',
        },
    }, pino.multistream(streams));
    logger.attachSink = (sink) => {
        sinks.add(sink);
        return () => sinks.delete(sink);
    };
    return logger;
}
//# sourceMappingURL=logger.js.map