import { z } from 'zod';
import { AppError } from '../utils/errors.js';
import { businessConnectionSchema, telegramMessageSchema } from './types.js';
import { withRetry } from '../utils/retry.js';
import { telegramId } from '../utils/ids.js';
const apiResponseSchema = z.object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    description: z.string().optional(),
    error_code: z.number().optional(),
    parameters: z.object({ retry_after: z.number().optional() }).optional(),
});
export class TelegramBotApiClient {
    timeoutMs;
    logger;
    #baseUrl;
    constructor(token, timeoutMs = 15_000, logger) {
        this.timeoutMs = timeoutMs;
        this.logger = logger;
        this.#baseUrl = `https://api.telegram.org/bot${token}`;
    }
    async #call(method, body, requestTimeoutMs = this.timeoutMs) {
        return withRetry(() => this.#callOnce(method, body, requestTimeoutMs), {
            attempts: 3,
            baseDelayMs: 250,
            maxDelayMs: 2_000,
        });
    }
    async #callOnce(method, body, requestTimeoutMs, externalSignal) {
        const started = Date.now();
        this.logger?.trace({
            category: 'TELEGRAM',
            method,
            body,
        }, `telegram api request: ${method}`);
        let response;
        try {
            response = await fetch(`${this.#baseUrl}/${method}`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body, (_, value) => typeof value === 'bigint' ? value.toString() : value),
                signal: externalSignal
                    ? AbortSignal.any([externalSignal, AbortSignal.timeout(requestTimeoutMs)])
                    : AbortSignal.timeout(requestTimeoutMs),
            });
        }
        catch (error) {
            const durationMs = Date.now() - started;
            this.logger?.error({
                category: 'TELEGRAM',
                method,
                durationMs,
                err: error,
            }, `telegram ${method} network request failed`);
            throw new AppError(`Telegram ${method} request failed`, 'TELEGRAM_NETWORK_ERROR', 502, true, {
                cause: error,
            });
        }
        const durationMs = Date.now() - started;
        const rawJson = await response.json().catch(() => ({}));
        const parsed = apiResponseSchema.safeParse(rawJson);
        if (!parsed.success) {
            this.logger?.error({
                category: 'TELEGRAM',
                method,
                statusCode: response.status,
                durationMs,
                rawJson,
            }, 'telegram api invalid response payload');
            throw new AppError('Invalid Telegram API response', 'TELEGRAM_INVALID_RESPONSE', 502, true);
        }
        if (!response.ok || !parsed.data.ok) {
            const code = parsed.data.error_code;
            const description = parsed.data.description ?? 'Telegram rejected the request';
            const replyWindowExpired = /24 hour|reply.*window|recent.*message/i.test(description);
            const retryable = code === 429 || (code !== undefined && code >= 500);
            this.logger?.warn({
                category: 'TELEGRAM',
                method,
                statusCode: response.status,
                errorCode: code,
                description,
                durationMs,
            }, `telegram api returned error: ${description}`);
            throw new AppError(description, replyWindowExpired ? 'TELEGRAM_REPLY_WINDOW_EXPIRED' : `TELEGRAM_API_${code ?? 'ERROR'}`, code === 429 ? 429 : 502, retryable);
        }
        this.logger?.trace({
            category: 'TELEGRAM',
            method,
            statusCode: response.status,
            durationMs,
            result: parsed.data.result,
        }, `telegram api response: ${method}`);
        return parsed.data.result;
    }
    async sendMessage(chatId, text, options = {}) {
        const result = await this.#call('sendMessage', {
            chat_id: chatId,
            text,
            ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
            ...(options.businessConnectionId
                ? { business_connection_id: options.businessConnectionId }
                : {}),
            ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
            ...(options.disableWebPagePreview ? { link_preview_options: { is_disabled: true } } : {}),
        });
        return telegramMessageSchema.parse(result);
    }
    async sendChatAction(chatId, action, options = {}) {
        await this.#callOnce('sendChatAction', {
            chat_id: chatId,
            action,
            ...(options.businessConnectionId
                ? { business_connection_id: options.businessConnectionId }
                : {}),
        }, Math.min(this.timeoutMs, 5_000), options.signal);
    }
    async getBusinessConnection(id) {
        return businessConnectionSchema.parse(await this.#call('getBusinessConnection', { business_connection_id: id }));
    }
    async readBusinessMessage(businessConnectionId, chatId, messageId) {
        await this.#call('readBusinessMessage', {
            business_connection_id: businessConnectionId,
            chat_id: chatId,
            message_id: messageId,
        });
    }
    async setWebhook(url, secretToken, allowedUpdates) {
        await this.#call('setWebhook', {
            url,
            secret_token: secretToken,
            allowed_updates: allowedUpdates,
            drop_pending_updates: false,
        });
    }
    async deleteWebhook(dropPendingUpdates = false) {
        await this.#call('deleteWebhook', { drop_pending_updates: dropPendingUpdates });
    }
    async getWebhookInfo() {
        return this.#call('getWebhookInfo', {});
    }
    async getMe() {
        const result = z
            .object({ id: z.number().int(), username: z.string().optional() })
            .parse(await this.#call('getMe', {}));
        return {
            id: telegramId(result.id),
            ...(result.username ? { username: result.username } : {}),
        };
    }
    async getUpdates(offset, allowedUpdates, timeoutSeconds) {
        return this.#call('getUpdates', {
            ...(offset === undefined ? {} : { offset }),
            timeout: timeoutSeconds,
            allowed_updates: allowedUpdates,
        }, Math.max(this.timeoutMs, timeoutSeconds * 1_000 + 5_000));
    }
}
//# sourceMappingURL=client.js.map