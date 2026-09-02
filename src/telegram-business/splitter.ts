/**
 * Splits long AI support answers into multiple natural messages for Telegram.
 * Avoids sending one massive wall of text.
 */

export interface SplitOptions {
  /**
   * Maximum characters before considering splitting.
   * Answers shorter than this will be sent as a single message.
   * Default: 320
   */
  thresholdChars?: number;

  /**
   * Target maximum characters per chunk.
   * Default: 280
   */
  maxChunkChars?: number;

  /**
   * Maximum number of messages to split into.
   * Default: 3
   */
  maxChunks?: number;
}

/**
 * Splits an answer into 1 to `maxChunks` logical message chunks.
 */
export function splitSupportAnswer(rawText: string, options: SplitOptions = {}): string[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  const threshold = options.thresholdChars ?? 320;
  const maxChunkChars = options.maxChunkChars ?? 280;
  const maxChunks = options.maxChunks ?? 3;

  // Short enough: keep as single message
  if (trimmed.length <= threshold) {
    return [trimmed];
  }

  // Split by double line breaks (paragraphs)
  const paragraphs = trimmed
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // If there's only 1 paragraph or paragraphs couldn't be formed
  if (paragraphs.length <= 1) {
    // Check if it has list items or single newlines
    const lines = trimmed
      .split(/\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length > 1 && trimmed.length > threshold) {
      return packChunks(lines, maxChunkChars, maxChunks, '\n');
    }

    // Single unbroken block: split by sentence enders (. ! ? ؟)
    const sentences = splitSentences(trimmed);
    if (sentences.length > 1) {
      return packChunks(sentences, maxChunkChars, maxChunks, ' ');
    }

    return [trimmed];
  }

  return packChunks(paragraphs, maxChunkChars, maxChunks, '\n\n');
}

/**
 * Helper to split text by Persian/English sentence boundaries.
 */
function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=[.!?؟])\s+/);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Packs text units (paragraphs or sentences) into chunks not exceeding maxChunkChars,
 * up to maxChunks.
 */
function packChunks(
  units: string[],
  maxChunkChars: number,
  maxChunks: number,
  joiner: string,
): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  for (const unit of units) {
    if (!currentChunk) {
      currentChunk = unit;
      continue;
    }

    const prospectiveLength = currentChunk.length + joiner.length + unit.length;
    // If appending fits and we haven't hit the chunk limit
    if (prospectiveLength <= maxChunkChars) {
      currentChunk += joiner + unit;
    } else {
      chunks.push(currentChunk);
      currentChunk = unit;

      // If we've reached maxChunks - 1, pack the rest into the last chunk
      if (chunks.length === maxChunks - 1) {
        const remainingIdx = units.indexOf(unit);
        const remaining = units.slice(remainingIdx).join(joiner);
        chunks.push(remaining);
        return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
}

/**
 * Calculates a realistic human typing delay in milliseconds for a message part.
 * Typically 1.2s to 3.0s depending on the length of the upcoming message.
 */
export function calculateTypingDelayMs(textLength: number): number {
  // Base delay: 1,200ms + 6ms per character, capped between 1,200ms and 2,800ms
  const calculated = 1_200 + textLength * 6;
  return Math.min(Math.max(calculated, 1_200), 2_800);
}
