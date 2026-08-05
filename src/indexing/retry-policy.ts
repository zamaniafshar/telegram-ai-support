import { IndexingJobStatus, IndexingStatus } from '@prisma/client';

export function indexingFailureState(input: {
  retryable: boolean;
  attempts: number;
  maxAttempts: number;
  baseDelayMs: number;
}) {
  const retry = input.retryable && input.attempts < input.maxAttempts;
  return {
    retry,
    jobStatus: retry ? IndexingJobStatus.RETRY : IndexingJobStatus.FAILED,
    itemStatus: retry ? IndexingStatus.PENDING : IndexingStatus.FAILED,
    backoffMs: Math.min(3_600_000, input.baseDelayMs * 2 ** Math.max(0, input.attempts - 1)),
  } as const;
}
