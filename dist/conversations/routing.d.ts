export type PreModelRoute = {
    kind: 'HANDOFF';
    reasonCode: 'EXPLICIT_HUMAN_REQUEST';
} | {
    kind: 'SAFE_GREETING';
    answer: string;
} | {
    kind: 'ASK_MODEL';
};
export declare function preModelRoute(customerText: string, options?: {
    safeGreetingEnabled?: boolean;
}): PreModelRoute;
export declare function shouldHandoffExternalFailure(attempt: number, maxAttempts: number): boolean;
