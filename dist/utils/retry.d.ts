export interface RetryOptions {
    attempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    signal?: AbortSignal;
}
export declare function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T>;
