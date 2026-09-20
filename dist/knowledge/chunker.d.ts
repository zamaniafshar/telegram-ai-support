export interface TextChunk {
    index: number;
    content: string;
    checksum: string;
}
export declare function chunkKnowledge(description: string, maxChars: number, overlapChars: number): TextChunk[];
