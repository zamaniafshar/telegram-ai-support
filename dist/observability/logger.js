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
export function createLogger(config) {
    return pino({
        level: config.log.level,
        redact: { paths: redactPaths, censor: '[REDACTED]' },
        base: { service: 'telegram-ai-support', env: config.nodeEnv },
        serializers: {
            err: pino.stdSerializers.err,
            customerText: (value) => config.log.personalData ? String(value) : '[REDACTED_MESSAGE]',
        },
    });
}
//# sourceMappingURL=logger.js.map