import { Writable } from 'node:stream';
import pino from 'pino';
import { VALID_CATEGORIES, levelSeverity, dbLevelSeverity, fixHints, isInsideSystemLogger, safeJsonValue, sanitize, } from './types.js';
import { SystemLogBuffer } from './system-log-buffer.js';
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
export function recordToSystemLogEntry(record) {
    if (record['_fromSystemLogger'] === true || isInsideSystemLogger())
        return null;
    const rawQuery = typeof record['query'] === 'string' ? record['query'].trim() : '';
    const rawMsg = typeof record['msg'] === 'string'
        ? record['msg']
        : typeof record['message'] === 'string'
            ? record['message']
            : 'system event';
    if (/systemlog/i.test(rawQuery) || /systemlog/i.test(rawMsg))
        return null;
    if (/^(begin|commit|rollback|savepoint|release\s+savepoint|set\s+autocommit|set\s+names)\b/i.test(rawQuery)) {
        return null;
    }
    const levelNum = typeof record['level'] === 'number' ? record['level'] : 30;
    let level;
    if (levelNum <= 10)
        level = 'TRACE';
    else if (levelNum <= 20)
        level = 'DEBUG';
    else if (levelNum <= 30)
        level = 'INFO';
    else if (levelNum <= 40)
        level = 'WARN';
    else if (levelNum <= 50)
        level = 'ERROR';
    else
        level = 'FATAL';
    let message;
    let messageFa;
    const req = record['req'];
    const res = record['res'];
    if (rawQuery) {
        const rt = typeof record['durationMs'] === 'number' ? ` (${String(record['durationMs'])}ms)` : '';
        message = `db query${rt}: ${sanitize(rawQuery, 450)}`;
        messageFa = `پرس‌وجوی پایگاه داده${rt}`;
    }
    else if (req && typeof req === 'object') {
        const method = req.method ?? 'HTTP';
        const url = req.url ?? '/';
        const status = res?.statusCode ? ` -> ${String(res.statusCode)}` : '';
        const rt = typeof record['responseTime'] === 'number'
            ? ` (${String(Math.round(record['responseTime']))}ms)`
            : '';
        message = `${method} ${url}${status}${rt}`;
        messageFa = `درخواست وب: ${method} ${url}${res?.statusCode ? ` [${String(res.statusCode)}]` : ''}`;
    }
    else {
        message = rawMsg;
        messageFa = typeof record['messageFa'] === 'string' ? record['messageFa'] : message;
    }
    const rawCategory = typeof record['category'] === 'string' ? record['category'].toUpperCase() : '';
    let category = 'SYSTEM';
    if (VALID_CATEGORIES.includes(rawCategory)) {
        category = rawCategory;
    }
    else if (rawQuery) {
        category = 'DATABASE';
    }
    else {
        const lower = message.toLowerCase();
        if (req || res || typeof record['reqId'] === 'string' || lower.includes('request completed')) {
            category = 'HTTP';
        }
        else if (lower.includes('webhook') || record['webhook'] !== undefined) {
            category = 'WEBHOOK';
        }
        else if (lower.includes('telegram') ||
            lower.includes('polling') ||
            record['telegram'] !== undefined ||
            record['botKind'] !== undefined) {
            category = 'TELEGRAM';
        }
        else if (lower.includes('qdrant') || record['qdrant'] !== undefined) {
            category = 'QDRANT';
        }
        else if (lower.includes('index') || record['indexing'] !== undefined) {
            category = 'INDEXING';
        }
        else if (lower.includes('worker') ||
            record['worker'] !== undefined ||
            record['job'] !== undefined) {
            category = 'WORKER';
        }
        else if (lower.includes('ai') ||
            lower.includes('model') ||
            lower.includes('nanogpt') ||
            lower.includes('openai') ||
            record['ai'] !== undefined) {
            category = 'AI';
        }
        else if (lower.includes('credit') ||
            lower.includes('balance') ||
            record['credit'] !== undefined) {
            category = 'CREDIT';
        }
        else if (lower.includes('handoff') || record['handoff'] !== undefined) {
            category = 'HANDOFF';
        }
        else if (lower.includes('auth') ||
            lower.includes('session') ||
            record['auth'] !== undefined) {
            category = 'AUTH';
        }
        else if (lower.includes('prisma') ||
            lower.includes('database') ||
            lower.includes('mysql') ||
            record['query'] !== undefined) {
            category = 'DATABASE';
        }
    }
    let businessAccountId = null;
    if (typeof record['businessAccountId'] === 'string') {
        businessAccountId = record['businessAccountId'];
    }
    else if (typeof record['businessId'] === 'string') {
        businessAccountId = record['businessId'];
    }
    else if (req?.url) {
        const match = /\/businesses\/([0-9a-fA-F-]{36})/i.exec(req.url);
        if (match)
            businessAccountId = match[1] ?? null;
    }
    const correlationId = typeof record['correlationId'] === 'string'
        ? record['correlationId']
        : typeof record['reqId'] === 'string'
            ? record['reqId']
            : null;
    const errorCode = typeof record['errorCode'] === 'string'
        ? record['errorCode']
        : typeof record['err']?.code === 'string'
            ? record['err'].code
            : null;
    if (errorCode && fixHints[errorCode]) {
        messageFa = fixHints[errorCode].fa;
    }
    else if (message === 'application started') {
        messageFa = 'سامانه با موفقیت راه‌اندازی شد';
    }
    else if (message === 'request completed') {
        messageFa = 'درخواست وب تکمیل شد';
    }
    const metadata = {};
    const skipKeys = new Set([
        'level',
        'time',
        'pid',
        'hostname',
        'service',
        'env',
        'msg',
        'message',
        'messageFa',
        'category',
        'errorCode',
        'correlationId',
        'businessAccountId',
        'fingerprint',
        '_fromSystemLogger',
    ]);
    for (const [k, v] of Object.entries(record)) {
        if (!skipKeys.has(k) && v !== undefined) {
            metadata[k] = safeJsonValue(v);
        }
    }
    const fingerprint = typeof record['fingerprint'] === 'string' ? record['fingerprint'] : null;
    return {
        level,
        category,
        message,
        messageFa,
        errorCode,
        correlationId,
        businessAccountId,
        fingerprint,
        metadata: Object.keys(metadata).length ? metadata : null,
    };
}
export function createLogger(config, prisma) {
    const sinks = new Set();
    let buffer = prisma ? new SystemLogBuffer(prisma, config) : null;
    function shouldPersist(level) {
        if (!config.systemLog.enabled)
            return false;
        const need = levelSeverity[level];
        const threshold = dbLevelSeverity[config.systemLog.dbLevel] ?? 40;
        return need >= threshold;
    }
    const dbStream = new Writable({
        write(chunk, _encoding, callback) {
            try {
                const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
                const record = JSON.parse(text);
                // Deliver to attached sinks (e.g. tests or external observers)
                for (const sink of sinks) {
                    try {
                        sink(record);
                    }
                    catch {
                        // Ignore sink errors to protect log pipeline
                    }
                }
                // Deliver to MySQL buffer if attached
                if (buffer) {
                    const entry = recordToSystemLogEntry(record);
                    if (entry && shouldPersist(entry.level)) {
                        buffer.enqueue(entry);
                    }
                }
            }
            catch {
                // Ignore parse errors for non-JSON chunks
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
        formatters: {
            log(obj) {
                return safeJsonValue(obj);
            },
        },
    }, pino.multistream(streams));
    logger.attachSink = (sink) => {
        sinks.add(sink);
        return () => sinks.delete(sink);
    };
    const attachDatabase = (db) => {
        buffer = new SystemLogBuffer(db, config, logger);
    };
    logger.attachDatabase = attachDatabase;
    logger.setDatabase = attachDatabase;
    logger.flushDb = async () => {
        await new Promise((resolve) => {
            logger.flush(() => resolve());
            setTimeout(resolve, 15);
        });
        if (buffer) {
            await buffer.flush();
        }
    };
    logger.logEvent = (entry) => {
        const pLevel = entry.level.toLowerCase();
        const fn = logger[pLevel];
        const payload = {
            category: entry.category,
            messageFa: entry.messageFa,
            errorCode: entry.errorCode ?? undefined,
            correlationId: entry.correlationId ?? undefined,
            businessAccountId: entry.businessAccountId ?? undefined,
            fingerprint: entry.fingerprint ?? undefined,
            metadata: entry.metadata ?? undefined,
        };
        if (typeof fn === 'function') {
            fn.call(logger, payload, entry.message);
        }
        else {
            logger.info(payload, entry.message);
        }
    };
    return logger;
}
//# sourceMappingURL=logger.js.map