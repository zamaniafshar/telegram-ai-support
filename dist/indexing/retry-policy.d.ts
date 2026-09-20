export declare function indexingFailureState(input: {
    retryable: boolean;
    attempts: number;
    maxAttempts: number;
    baseDelayMs: number;
}): {
    readonly retry: boolean;
    readonly jobStatus: "FAILED" | "RETRY";
    readonly itemStatus: "PENDING" | "FAILED";
    readonly backoffMs: number;
};
