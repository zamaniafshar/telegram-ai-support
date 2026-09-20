import { explicitlyRequestsHuman, safeGreeting } from './policy.js';
export function preModelRoute(customerText, options = {}) {
    if (explicitlyRequestsHuman(customerText)) {
        return { kind: 'HANDOFF', reasonCode: 'EXPLICIT_HUMAN_REQUEST' };
    }
    if (options.safeGreetingEnabled ?? true) {
        const greeting = safeGreeting(customerText);
        if (greeting)
            return { kind: 'SAFE_GREETING', answer: greeting };
    }
    return { kind: 'ASK_MODEL' };
}
export function shouldHandoffExternalFailure(attempt, maxAttempts) {
    return attempt >= Math.min(3, maxAttempts);
}
//# sourceMappingURL=routing.js.map