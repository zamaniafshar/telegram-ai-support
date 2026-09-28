import { z } from 'zod';
import type { Logger } from 'pino';
import { AppError } from '../utils/errors.js';
import type {
  BusinessConnectionUpdate,
  InlineKeyboardMarkup,
  SentTelegramMessage,
  TelegramWebhookInfo,
} from './types.js';
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

export interface SendMessageOptions {
  businessConnectionId?: string;
  replyMarkup?: InlineKeyboardMarkup;
  disableWebPagePreview?: boolean;
  parseMode?: 'HTML' | 'MarkdownV2';
}

export interface SendChatActionOptions {
  businessConnectionId?: string;
  signal?: AbortSignal;
}

export interface TelegramApi {
  sendMessage(
    chatId: bigint,
    text: string,
    options?: SendMessageOptions,
  ): Promise<SentTelegramMessage>;
  sendChatAction(chatId: bigint, action: 'typing', options?: SendChatActionOptions): Promise<void>;
  getBusinessConnection(id: string): Promise<BusinessConnectionUpdate>;
  readBusinessMessage(
    businessConnectionId: string,
    chatId: bigint,
    messageId: bigint,
  ): Promise<void>;
  setWebhook(url: string, secretToken: string, allowedUpdates: string[]): Promise<void>;
  deleteWebhook(dropPendingUpdates?: boolean): Promise<void>;
  getWebhookInfo(): Promise<TelegramWebhookInfo>;
  getMe(): Promise<{ id: bigint; username?: string }>;
  getUpdates(
    offset: number | undefined,
    allowedUpdates: string[],
    timeoutSeconds: number,
  ): Promise<unknown[]>;
}

export class TelegramBotApiClient implements TelegramApi {
  readonly #baseUrl: string;

  constructor(
    token: string,
    private readonly timeoutMs = 15_000,
    private readonly logger?: Logger,
  ) {
    this.#baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async #call<T>(
    method: string,
    body: Record<string, unknown>,
    requestTimeoutMs = this.timeoutMs,
  ): Promise<T> {
    return withRetry(() => this.#callOnce<T>(method, body, requestTimeoutMs), {
      attempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 2_000,
    });
  }

  async #callOnce<T>(
    method: string,
    body: Record<string, unknown>,
    requestTimeoutMs: number,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    const started = Date.now();
    this.logger?.trace(
      {
        category: 'TELEGRAM',
        method,
        body,
      },
      `telegram api request: ${method}`,
    );
    let response: Response;
    try {
      response = await fetch(`${this.#baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body, (_, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
        signal: externalSignal
          ? AbortSignal.any([externalSignal, AbortSignal.timeout(requestTimeoutMs)])
          : AbortSignal.timeout(requestTimeoutMs),
      });
    } catch (error) {
      const durationMs = Date.now() - started;
      this.logger?.error(
        {
          category: 'TELEGRAM',
          method,
          durationMs,
          err: error,
        },
        `telegram ${method} network request failed`,
      );
      throw new AppError(`Telegram ${method} request failed`, 'TELEGRAM_NETWORK_ERROR', 502, true, {
        cause: error,
      });
    }

    const durationMs = Date.now() - started;
    const rawJson = await response.json().catch(() => ({}));
    const parsed = apiResponseSchema.safeParse(rawJson);
    if (!parsed.success) {
      this.logger?.error(
        {
          category: 'TELEGRAM',
          method,
          statusCode: response.status,
          durationMs,
          rawJson,
        },
        'telegram api invalid response payload',
      );
      throw new AppError('Invalid Telegram API response', 'TELEGRAM_INVALID_RESPONSE', 502, true);
    }

    if (!response.ok || !parsed.data.ok) {
      const code = parsed.data.error_code;
      const description = parsed.data.description ?? 'Telegram rejected the request';
      const replyWindowExpired = /24 hour|reply.*window|recent.*message/i.test(description);
      const retryable = code === 429 || (code !== undefined && code >= 500);
      this.logger?.warn(
        {
          category: 'TELEGRAM',
          method,
          statusCode: response.status,
          errorCode: code,
          description,
          durationMs,
        },
        `telegram api returned error: ${description}`,
      );
      throw new AppError(
        description,
        replyWindowExpired ? 'TELEGRAM_REPLY_WINDOW_EXPIRED' : `TELEGRAM_API_${code ?? 'ERROR'}`,
        code === 429 ? 429 : 502,
        retryable,
      );
    }
    this.logger?.trace(
      {
        category: 'TELEGRAM',
        method,
        statusCode: response.status,
        durationMs,
        result: parsed.data.result,
      },
      `telegram api response: ${method}`,
    );
    return parsed.data.result as T;
  }

  async sendMessage(
    chatId: bigint,
    text: string,
    options: SendMessageOptions = {},
  ): Promise<SentTelegramMessage> {
    const result = await this.#call<unknown>('sendMessage', {
      chat_id: chatId,
      text,
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
      ...(options.businessConnectionId
        ? { business_connection_id: options.businessConnectionId }
        : {}),
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      ...(options.disableWebPagePreview ? { link_preview_options: { is_disabled: true } } : {}),
    });
    return telegramMessageSchema.parse(result) as SentTelegramMessage;
  }

  async sendChatAction(
    chatId: bigint,
    action: 'typing',
    options: SendChatActionOptions = {},
  ): Promise<void> {
    await this.#callOnce(
      'sendChatAction',
      {
        chat_id: chatId,
        action,
        ...(options.businessConnectionId
          ? { business_connection_id: options.businessConnectionId }
          : {}),
      },
      Math.min(this.timeoutMs, 5_000),
      options.signal,
    );
  }

  async getBusinessConnection(id: string): Promise<BusinessConnectionUpdate> {
    return businessConnectionSchema.parse(
      await this.#call('getBusinessConnection', { business_connection_id: id }),
    );
  }

  async readBusinessMessage(
    businessConnectionId: string,
    chatId: bigint,
    messageId: bigint,
  ): Promise<void> {
    await this.#call('readBusinessMessage', {
      business_connection_id: businessConnectionId,
      chat_id: chatId,
      message_id: messageId,
    });
  }

  async setWebhook(url: string, secretToken: string, allowedUpdates: string[]): Promise<void> {
    await this.#call('setWebhook', {
      url,
      secret_token: secretToken,
      allowed_updates: allowedUpdates,
      drop_pending_updates: false,
    });
  }

  async deleteWebhook(dropPendingUpdates = false): Promise<void> {
    await this.#call('deleteWebhook', { drop_pending_updates: dropPendingUpdates });
  }

  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    return this.#call('getWebhookInfo', {});
  }

  async getMe(): Promise<{ id: bigint; username?: string }> {
    const result = z
      .object({ id: z.number().int(), username: z.string().optional() })
      .parse(await this.#call('getMe', {}));
    return {
      id: telegramId(result.id),
      ...(result.username ? { username: result.username } : {}),
    };
  }

  async getUpdates(
    offset: number | undefined,
    allowedUpdates: string[],
    timeoutSeconds: number,
  ): Promise<unknown[]> {
    return this.#call<unknown[]>(
      'getUpdates',
      {
        ...(offset === undefined ? {} : { offset }),
        timeout: timeoutSeconds,
        allowed_updates: allowedUpdates,
      },
      Math.max(this.timeoutMs, timeoutSeconds * 1_000 + 5_000),
    );
  }
}
