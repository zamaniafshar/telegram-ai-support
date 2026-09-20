export declare class AppError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly retryable: boolean;
    constructor(message: string, code: string, statusCode?: number, retryable?: boolean, options?: ErrorOptions);
}
export declare class ValidationError extends AppError {
    constructor(message: string, code?: string);
}
export declare class AuthorizationError extends AppError {
    constructor(message?: string);
}
export declare class ResourceUnavailableError extends AppError {
    constructor();
}
export declare function errorCode(error: unknown): string;
export declare function safeErrorDetail(error: unknown): string;
export declare function isRetryable(error: unknown): boolean;
