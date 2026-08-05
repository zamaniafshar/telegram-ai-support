import type { RetrievalResult } from '../domain/types.js';
import { explicitlyRequestsHuman, safeGreeting } from './policy.js';

export type PreModelRoute =
  | { kind: 'HANDOFF'; reasonCode: 'EXPLICIT_HUMAN_REQUEST' | 'NO_RELEVANT_KNOWLEDGE' }
  | { kind: 'SAFE_GREETING'; answer: string }
  | { kind: 'ASK_MODEL' };

export function preModelRoute(customerText: string, retrieved?: RetrievalResult[]): PreModelRoute {
  if (explicitlyRequestsHuman(customerText)) {
    return { kind: 'HANDOFF', reasonCode: 'EXPLICIT_HUMAN_REQUEST' };
  }
  const greeting = safeGreeting(customerText);
  if (greeting) return { kind: 'SAFE_GREETING', answer: greeting };
  if (retrieved?.length === 0) {
    return { kind: 'HANDOFF', reasonCode: 'NO_RELEVANT_KNOWLEDGE' };
  }
  return { kind: 'ASK_MODEL' };
}

export function shouldHandoffExternalFailure(attempt: number, maxAttempts: number): boolean {
  return attempt >= Math.min(3, maxAttempts);
}
