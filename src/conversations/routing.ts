import { explicitlyRequestsHuman, safeGreeting } from './policy.js';

export type PreModelRoute =
  | { kind: 'HANDOFF'; reasonCode: 'EXPLICIT_HUMAN_REQUEST' }
  | { kind: 'SAFE_GREETING'; answer: string }
  | { kind: 'ASK_MODEL' };

export function preModelRoute(
  customerText: string,
  options: { safeGreetingEnabled?: boolean } = {},
): PreModelRoute {
  if (explicitlyRequestsHuman(customerText)) {
    return { kind: 'HANDOFF', reasonCode: 'EXPLICIT_HUMAN_REQUEST' };
  }
  if (options.safeGreetingEnabled ?? true) {
    const greeting = safeGreeting(customerText);
    if (greeting) return { kind: 'SAFE_GREETING', answer: greeting };
  }
  return { kind: 'ASK_MODEL' };
}

export function shouldHandoffExternalFailure(attempt: number, maxAttempts: number): boolean {
  return attempt >= Math.min(3, maxAttempts);
}
