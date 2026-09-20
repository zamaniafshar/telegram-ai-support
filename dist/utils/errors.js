export class AppError extends Error {
    code;
    statusCode;
    retryable;
    constructor(message, code, statusCode = 500, retryable = false, options) {
        super(message, options);
        this.code = code;
        this.statusCode = statusCode;
        this.retryable = retryable;
        this.name = 'AppError';
    }
}
export class ValidationError extends AppError {
    constructor(message, code = 'VALIDATION_ERROR') {
        super(message, code, 400, false);
        this.name = 'ValidationError';
    }
}
export class AuthorizationError extends AppError {
    constructor(message = 'Unauthorized') {
        super(message, 'UNAUTHORIZED', 403, false);
        this.name = 'AuthorizationError';
    }
}
export class ResourceUnavailableError extends AppError {
    constructor() {
        super('Resource is unavailable', 'RESOURCE_UNAVAILABLE', 404, false);
        this.name = 'ResourceUnavailableError';
    }
}
export function errorCode(error) {
    if (error instanceof AppError)
        return error.code;
    if (error instanceof Error)
        return error.name.toUpperCase();
    return 'UNKNOWN_ERROR';
}
export function safeErrorDetail(error) {
    if (error instanceof Error)
        return error.message.slice(0, 2_000);
    return 'Unknown error';
}
export function isRetryable(error) {
    if (error instanceof AppError)
        return error.retryable;
    if (!(error instanceof Error))
        return false;
    return /timeout|timed out|ECONNRESET|ECONNREFUSED|429|502|503|504/i.test(error.message);
}
//# sourceMappingURL=errors.js.map