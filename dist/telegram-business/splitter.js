/**
 * Splits long AI support answers into multiple natural messages for Telegram.
 * Avoids sending one massive wall of text or breaking titles across bubbles.
 */
const DEFAULT_SPLIT_DELIMITER = /(?:\r?\n)*\s*===SPLIT===\s*(?:\r?\n)*/;
/**
 * Splits an answer into 1 to `maxChunks` logical message chunks.
 */
export function splitSupportAnswer(rawText, options = {}) {
    const trimmed = rawText.trim();
    if (!trimmed)
        return [];
    // 1. Explicit AI delimiter (===SPLIT=== or options.delimiter)
    if (options.delimiter) {
        const parts = trimmed
            .split(options.delimiter)
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
        if (parts.length > 1) {
            return parts;
        }
    }
    if (trimmed.includes('===SPLIT===')) {
        const parts = trimmed
            .split(DEFAULT_SPLIT_DELIMITER)
            .map((p) => p.trim())
            .filter((p) => p.length > 0);
        if (parts.length > 1) {
            return parts;
        }
    }
    const threshold = options.thresholdChars ?? 320;
    const maxChunkChars = options.maxChunkChars ?? 280;
    const maxChunks = options.maxChunks ?? 5;
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
function splitSentences(text) {
    const parts = text.split(/(?<=[.!?؟])\s+/);
    return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}
/**
 * Detects whether a paragraph/line acts as a section heading.
 * Headings should never be left orphaned at the end of a chunk without their following body.
 */
export function isSectionHeading(text) {
    const clean = text.trim();
    if (!clean || clean.length > 75)
        return false;
    // Wrapped in <b>...</b> e.g. <b>دوره جامع آنلاین</b>
    if (/^<b>.+<\/b>$/s.test(clean))
        return true;
    // Ends with colon e.g. «دوره جامع آنلاین:»
    if (/[:：]$/.test(clean))
        return true;
    // Starts with bullet point or number: NOT a heading, it's a list item
    if (/^(?:[-•*▫▪]|\d+[.)])/.test(clean))
        return false;
    // Single line with no terminal sentence punctuation (. ! ? ؟)
    const isSingleLine = !clean.includes('\n');
    const hasNoEndPunctuation = !/[.!؟?]\s*$/.test(clean);
    return isSingleLine && hasNoEndPunctuation;
}
/**
 * Packs text units (paragraphs or sentences) into chunks not exceeding maxChunkChars,
 * up to maxChunks, with orphan-heading protection.
 */
function packChunks(units, maxChunkChars, maxChunks, joiner) {
    const chunks = [];
    let currentChunk = '';
    for (let i = 0; i < units.length; i += 1) {
        const unit = units[i];
        if (unit === undefined) {
            continue;
        }
        const nextUnit = units[i + 1];
        if (!currentChunk) {
            currentChunk = unit;
            continue;
        }
        // Orphan-heading lookahead protection:
        // If unit is a section heading, check if adding BOTH unit and nextUnit fits.
        // If not, packing unit now would leave it stranded at the end of currentChunk without its body.
        if (nextUnit && isSectionHeading(unit) && chunks.length < maxChunks - 1) {
            const prospectiveWithNext = currentChunk.length + joiner.length + unit.length + joiner.length + nextUnit.length;
            if (prospectiveWithNext > maxChunkChars) {
                chunks.push(currentChunk);
                currentChunk = unit;
                if (chunks.length === maxChunks - 1) {
                    const remaining = units.slice(i).join(joiner);
                    chunks.push(remaining);
                    return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
                }
                continue;
            }
        }
        // Never leave a heading alone in its own chunk! Always attach at least the first body unit.
        if (isSectionHeading(currentChunk)) {
            currentChunk += joiner + unit;
            continue;
        }
        const prospectiveLength = currentChunk.length + joiner.length + unit.length;
        // If appending fits
        if (prospectiveLength <= maxChunkChars) {
            currentChunk += joiner + unit;
        }
        else {
            chunks.push(currentChunk);
            currentChunk = unit;
            // If we've reached maxChunks - 1, pack the rest into the last chunk
            if (chunks.length === maxChunks - 1) {
                const remaining = units.slice(i).join(joiner);
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
export function calculateTypingDelayMs(textLength) {
    // Base delay: 1,200ms + 6ms per character, capped between 1,200ms and 2,800ms
    const calculated = 1_200 + textLength * 6;
    return Math.min(Math.max(calculated, 1_200), 2_800);
}
//# sourceMappingURL=splitter.js.map