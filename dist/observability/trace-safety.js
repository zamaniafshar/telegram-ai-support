export function redactTraceText(value, maxLength) {
    return value
        .slice(0, maxLength)
        .replace(/\b(?:bearer\s+)?[a-z0-9_-]{24,}\.[a-z0-9_-]{12,}(?:\.[a-z0-9_-]{12,})?\b/gi, '[REDACTED]')
        .replace(/\b(api[_ -]?key|token|secret|password)\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
}
export function traceExpiry(now, retentionDays) {
    return new Date(now.getTime() + retentionDays * 24 * 60 * 60_000);
}
//# sourceMappingURL=trace-safety.js.map