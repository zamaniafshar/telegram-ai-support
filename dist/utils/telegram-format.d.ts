/**
 * Utilities for Telegram HTML formatting, sanitization, and fallback plain-text conversion.
 * Telegram Bot API HTML parser is strict: tags must be closed and only supported tags are allowed.
 */
/**
 * Strips all HTML tags and converts common entities to plain text.
 */
export declare function stripHtml(text: string): string;
/**
 * Escapes characters for Telegram HTML (&, <, >).
 */
export declare function escapeHtml(text: string): string;
/**
 * Converts basic Markdown tokens (e.g. **bold**, [link](url)) into valid Telegram HTML.
 */
export declare function markdownToTelegramHtml(text: string): string;
/**
 * Sanitizes Telegram HTML to ensure only supported tags exist and brackets/amps are safe.
 * Replaces unknown tags (<p>, <br>) with whitespace or strips them, and ensures tags are balanced.
 */
export declare function sanitizeTelegramHtml(raw: string): string;
/**
 * Checks if a Telegram error is due to entity parsing failure.
 */
export declare function isTelegramEntityParseError(error: unknown): boolean;
