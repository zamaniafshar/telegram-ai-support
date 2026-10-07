import OpenAI from 'openai';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';
import type {
  ConversationContextMessage,
  QueryRewriter,
  QueryRewriterInput,
  QueryRewriterResult,
} from '../domain/types.js';

export const REWRITER_SYSTEM_PROMPT = `ROLE:
You are an expert Contextual Query Rewriter for a Persian customer support system.

TASK:
Rewrite the customer's latest message into a clear, standalone, fully-resolved Persian search query based on the conversation history.

STRICT RULES:
1. Resolve all anaphoric references, pronouns (e.g. "این", "اون", "همین", "دومی"), and elliptical fragments (e.g. "امسال", "بله", "آفلاین") into their concrete topic from context.
2. If the AI previously asked a clarifying or choice question (e.g. "متقاضی کنکور پیش رو هستید یا سال آینده؟") and the user replies with a choice (e.g. "امسال"), formulate the complete intent (e.g. "شرایط و ثبت‌نام کنکور امسال").
3. Output ONLY the rewritten Persian search query.
4. Do NOT answer the question.
5. Do NOT include quotes, Markdown, explanations, greetings, or pleasantries.
6. If the customer's message is already complete and self-contained, return it unchanged.`;

const ANAPHORA_PATTERNS = [
  /(^|[\s\p{P}])(این|اینو|اینا|این‌ها|اینها|اینرو|این رو)(?=[\s\p{P}]|$)/u,
  /(^|[\s\p{P}])(اون|اونو|اونا|اون‌ها|اونها|اونرو|اون رو)(?=[\s\p{P}]|$)/u,
  /(^|[\s\p{P}])(همین|همینو|همین‌ها|همینها)(?=[\s\p{P}]|$)/u,
  /(^|[\s\p{P}])(همون|همونو|همون‌ها|همونها)(?=[\s\p{P}]|$)/u,
  /(^|[\s\p{P}])(دومی|دومیش|اولی|اولیش|سومی|سومیش)(?=[\s\p{P}]|$)/u,
  /(^|[\s\p{P}])(قبلی|قبلیه|بعدی|بعدیه)(?=[\s\p{P}]|$)/u,
  /(^|[\s\p{P}])پس\s+(اون|این)\s+چی(?=[\s\p{P}]|$)/u,
  /(^|[\s\p{P}])(کدوم|کدومش|کدام|کدامیک|کدام‌یک)(?=[\s\p{P}]|$)/u,
  /(^|[\s\p{P}])(هزینه‌ش|هزینش|قیمتش|شرایطش|توضیحاتش)(?=[\s\p{P}]|$)/u,
];

export function isPendingBotInquiry(context: ConversationContextMessage[]): boolean {
  if (context.length === 0) return false;
  const lastAi = [...context].reverse().find((m) => m.senderType === 'AI');
  if (!lastAi) return false;
  const text = lastAi.text.trim();
  if (!text) return false;

  // Ends with question mark (? or ؟)
  if (/[?؟]\s*$/.test(text)) return true;
  // Contains question mark
  if (/[?؟]/.test(text)) return true;
  // Prompted a selection or choice
  const choicePromptRegex = /(یا|کدوم|کدام|انتخاب کنید|مشخص کنید|بفرمایید|پیش رو هستید)/i;
  return choicePromptRegex.test(text);
}

export function hasAnaphora(text: string): boolean {
  return ANAPHORA_PATTERNS.some((pattern) => pattern.test(text));
}

export function isEllipticalFragment(text: string): boolean {
  const words = text
    .trim()
    .split(/[\s\p{P}]+/u)
    .filter(Boolean);
  return words.length > 0 && words.length <= 4;
}

export function isRewriterEligible(text: string, context: ConversationContextMessage[]): boolean {
  if (context.length === 0) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  return isPendingBotInquiry(context) || hasAnaphora(trimmed) || isEllipticalFragment(trimmed);
}

export interface QueryRewriterModel {
  rewrite(input: {
    text: string;
    context: ConversationContextMessage[];
    timeoutMs: number;
  }): Promise<string>;
}

export class OpenAiQueryRewriterModel implements QueryRewriterModel {
  private readonly client: OpenAI;
  private readonly modelName: string;

  constructor(config: AppConfig, client?: OpenAI) {
    this.modelName = config.rewriter.model;
    this.client =
      client ??
      new OpenAI({
        apiKey: config.openai.apiKey,
        baseURL: config.openai.baseUrl,
        timeout: config.rewriter.timeoutMs,
        maxRetries: 0, // Zero retries for latency optimization on rewrite
      });
  }

  async rewrite(input: {
    text: string;
    context: ConversationContextMessage[];
    timeoutMs: number;
  }): Promise<string> {
    const formattedContext = input.context
      .slice(-6)
      .map((m) => `[${m.senderType}]: ${m.text}`)
      .join('\n');

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.modelName,
          temperature: 0,
          max_tokens: 150,
          messages: [
            { role: 'system', content: REWRITER_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `CONTEXT:\n${formattedContext}\n\nCUSTOMER_MESSAGE:\n${input.text}\n\nREWRITTEN_QUERY:`,
            },
          ],
        },
        { signal: controller.signal },
      );
      clearTimeout(timeoutHandle);
      const choice = response.choices[0];
      return choice ? (choice.message.content?.trim() ?? '') : '';
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}

export class ContextualQueryRewriter implements QueryRewriter {
  private readonly model: QueryRewriterModel;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: AppConfig,
    model?: QueryRewriterModel,
    private readonly logger?: Logger,
  ) {
    this.timeoutMs = config.rewriter.timeoutMs;
    this.model = model ?? new OpenAiQueryRewriterModel(config);
  }

  async rewriteIfEligible(input: QueryRewriterInput): Promise<QueryRewriterResult> {
    const rawText = input.text.trim();
    if (!isRewriterEligible(rawText, input.context)) {
      return { text: input.text, wasRewritten: false };
    }

    const started = Date.now();
    this.logger?.trace(
      {
        category: 'AI',
        rawText,
        contextLength: input.context.length,
      },
      'query rewriter guard triggered, invoking rewriter model',
    );

    try {
      const rewritten = await this.model.rewrite({
        text: rawText,
        context: input.context,
        timeoutMs: this.timeoutMs,
      });

      const cleanRewritten = rewritten.replace(/^["'«»]+|["'«»]+$/g, '').trim();

      if (!cleanRewritten || cleanRewritten === rawText) {
        return { text: input.text, wasRewritten: false };
      }

      this.logger?.info(
        {
          category: 'AI',
          rawText,
          rewritten: cleanRewritten,
          latencyMs: Date.now() - started,
        },
        'contextual query rewritten successfully',
      );

      return {
        text: cleanRewritten,
        wasRewritten: true,
      };
    } catch (error) {
      this.logger?.warn(
        {
          err: error,
          rawText,
          latencyMs: Date.now() - started,
        },
        'query rewriter failed or timed out, gracefully falling back to original text',
      );
      return { text: input.text, wasRewritten: false };
    }
  }
}
