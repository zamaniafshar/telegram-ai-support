export type AppConfig = ReturnType<typeof loadConfig>;
export declare function loadConfig(source?: NodeJS.ProcessEnv): {
    readonly nodeEnv: "development" | "test" | "production";
    readonly http: {
        readonly host: string;
        readonly port: number;
        readonly publicBaseUrl: string;
        readonly trustProxy: boolean;
        readonly rateLimitMax: number;
        readonly rateLimitWindow: string;
    };
    readonly log: {
        readonly level: "error" | "fatal" | "warn" | "info" | "debug" | "trace" | "silent";
        readonly personalData: boolean;
    };
    readonly shutdownTimeoutMs: number;
    readonly databaseUrl: string;
    readonly telegram: {
        readonly businessBotToken: string;
        readonly businessWebhookSecret: string;
        readonly businessWebhookPath: string;
        readonly adminBotToken: string;
        readonly adminWebhookSecret: string;
        readonly adminWebhookPath: string;
        readonly ownerId: bigint;
        readonly initialAdminIds: bigint[];
        readonly markRead: boolean;
        readonly transport: "webhook" | "polling";
        readonly replyWindowHours: number;
        readonly miniAppUrl: string;
        readonly miniAppAuthMaxAgeSeconds: number;
        readonly miniAppSessionHours: number;
        readonly miniAppDevAdminId: bigint | undefined;
    };
    readonly openai: {
        readonly apiKey: string;
        readonly baseUrl: string;
        readonly chatModel: string;
        readonly embeddingModel: string;
        readonly embeddingDimensions: number | undefined;
        readonly maxRetries: number;
        readonly timeoutMs: number;
    };
    readonly nanoGptCredit: {
        readonly balanceUrl: string;
        readonly lowBalanceUsd: number;
        readonly checkIntervalHours: number;
        readonly insufficientAlertCooldownHours: number;
    };
    readonly qdrant: {
        readonly url: string;
        readonly apiKey: string | undefined;
        readonly collection: string;
        readonly exactQuestionsCollection: string;
        readonly timeoutMs: number;
    };
    readonly rag: {
        readonly retrievalMinScore: number;
        readonly retrievalLimit: number;
        readonly copyPasteThreshold: number;
        readonly contextMessages: number;
        readonly maxCustomerMessageLength: number;
        readonly maxKnowledgeTitleLength: number;
        readonly maxKnowledgeDescriptionLength: number;
        readonly chunkMaxChars: number;
        readonly chunkOverlapChars: number;
        readonly debounceMs: number;
    };
    readonly rewriter: {
        readonly timeoutMs: number;
        readonly model: string;
    };
    readonly routing: {
        readonly safeGreetingEnabled: boolean;
    };
    readonly abuseProtection: {
        readonly maxRequestsPerHour: number;
        readonly maxRequestsPerDay: number;
        readonly cooldownMinutes: number;
        readonly businessMaxRequestsPerHour: number;
        readonly businessMaxRequestsPerDay: number;
        readonly businessCooldownMinutes: number;
        readonly maxBatchMessages: number;
        readonly maxBatchChars: number;
    };
    readonly business: {
        readonly defaultTimezone: string;
    };
    readonly handoff: {
        readonly hours: number;
        readonly customerMessage: string;
        readonly customerMessageEnabled: boolean;
        readonly notifyAdditionalMessages: boolean;
    };
    readonly analytics: {
        readonly retentionDays: number;
        readonly inputCostPerMillionUsd: number | undefined;
        readonly outputCostPerMillionUsd: number | undefined;
    };
    readonly worker: {
        readonly pollIntervalMs: number;
        readonly batchSize: number;
        readonly leaseMs: number;
        readonly indexingMaxAttempts: number;
        readonly indexingBackoffBaseMs: number;
        readonly runInApi: boolean;
    };
    readonly systemLog: {
        readonly enabled: boolean;
        readonly dbLevel: "error" | "fatal" | "warn" | "info" | "debug" | "trace" | "silent";
        readonly retentionDays: number;
        readonly dedupMs: number;
    };
};
