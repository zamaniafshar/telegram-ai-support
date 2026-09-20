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
}
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
