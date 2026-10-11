/**
 * Splits long AI support answers into multiple natural messages for Telegram.
 * Avoids sending one massive wall of text or breaking titles across bubbles.
 */
export interface SplitOptions {
    /**
     * Maximum characters before considering splitting.
     * Answers shorter than this will be sent as a single message.
     * Default: 320
     */
    thresholdChars?: number;
    /**
     * Target maximum characters per chunk in fallback paragraph packing.
     * Default: 280
     */
    maxChunkChars?: number;
    /**
     * Maximum number of messages to split into.
     * Default: 5
     */
    maxChunks?: number;
    /**
     * Optional custom split delimiter pattern or string.
     */
    delimiter?: RegExp | string;
    /**
     * Set to true if this is an exact copy-paste answer.
     * Uses *** (or ===SPLIT===) as explicit message separator.
     * If *** is absent, preserves the answer verbatim without auto-splitting paragraphs.
     */
    isCopyPaste?: boolean;
}
export declare const DEFAULT_SPLIT_DELIMITER: RegExp;
/**
 * Delimiter regex for copy-paste answers:
 * - 3 or more asterisks with optional surrounding newlines/whitespace (e.g. "***" or "\n***\n")
 * - Legacy ===SPLIT=== delimiter
 */
export declare const COPY_PASTE_SPLIT_DELIMITER: RegExp;
/**
 * Splits exact copy-paste answers based on *** delimiter into distinct messages.
 * If *** is present, splits on *** and returns each non-empty trimmed chunk.
 * If *** is not present, preserves the answer verbatim as a single message
 * (splitting only if it exceeds Telegram's 4,000 char message length limit).
 */
export declare function splitCopyPasteAnswer(rawText: string): string[];
/**
 * Splits an answer into 1 to `maxChunks` logical message chunks.
 */
export declare function splitSupportAnswer(rawText: string, options?: SplitOptions): string[];
/**
 * Detects whether a paragraph/line acts as a section heading.
 * Headings should never be left orphaned at the end of a chunk without their following body.
 */
export declare function isSectionHeading(text: string): boolean;
/**
 * Calculates a realistic human typing delay in milliseconds for a message part.
 * Typically 1.2s to 3.0s depending on the length of the upcoming message.
 */
export declare function calculateTypingDelayMs(textLength: number): number;
