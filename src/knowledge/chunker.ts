import { sha256 } from '../utils/ids.js';

export interface TextChunk {
  index: number;
  content: string;
  checksum: string;
}

function splitOversized(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    const candidate = remaining.slice(0, maxChars);
    const boundary = Math.max(
      candidate.lastIndexOf('\n'),
      candidate.lastIndexOf('. '),
      candidate.lastIndexOf(' '),
    );
    const cut = boundary >= Math.floor(maxChars * 0.55) ? boundary + 1 : maxChars;
    pieces.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

export function chunkKnowledge(
  description: string,
  maxChars: number,
  overlapChars: number,
): TextChunk[] {
  const normalized = description
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!normalized) return [];

  const paragraphs = normalized
    .split(/\n{2,}/)
    .flatMap((paragraph) => splitOversized(paragraph, maxChars));
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current.trim());
    const overlap = current.slice(Math.max(0, current.length - overlapChars)).trim();
    current = overlap ? `${overlap}\n\n${paragraph}` : paragraph;
    if (current.length > maxChars) {
      chunks.push(...splitOversized(current, maxChars));
      current = '';
    }
  }
  if (current) chunks.push(current.trim());

  return chunks.filter(Boolean).map((content, index) => ({
    index,
    content,
    checksum: sha256(content),
  }));
}
