/**
 * Utilities for Telegram HTML formatting, sanitization, and fallback plain-text conversion.
 * Telegram Bot API HTML parser is strict: tags must be closed and only supported tags are allowed.
 */

const ALLOWED_TAGS = new Set([
  'b',
  'strong',
  'i',
  'em',
  'u',
  'ins',
  's',
  'strike',
  'del',
  'a',
  'code',
  'pre',
  'blockquote',
  'tg-spoiler',
]);

/**
 * Strips all HTML tags and converts common entities to plain text.
 */
export function stripHtml(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Escapes characters for Telegram HTML (&, <, >).
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Converts basic Markdown tokens (e.g. **bold**, [link](url)) into valid Telegram HTML.
 */
export function markdownToTelegramHtml(text: string): string {
  let result = text;
  // Markdown links: [text](https://...) -> <a href="https://...">text</a>
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
  // Bold: **text** -> <b>text</b>
  result = result.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // Underline / italic: _text_ -> <i>text</i> (if not inside words)
  result = result.replace(/(^|\s)_([^_]+)_(\s|$)/g, '$1<i>$2</i>$3');
  // Backtick code: `code` -> <code>code</code>
  result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
  return result;
}

/**
 * Sanitizes Telegram HTML to ensure only supported tags exist and brackets/amps are safe.
 * Replaces unknown tags (<p>, <br>) with whitespace or strips them, and ensures tags are balanced.
 */
export function sanitizeTelegramHtml(raw: string): string {
  if (!raw) return '';

  // First convert Markdown conventions if present
  let text = markdownToTelegramHtml(raw);

  // Normalize <br> and <p>
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<p>/gi, '');
  text = text.replace(/<\/p>/gi, '\n\n');

  // Tokenize by HTML tags: <tag ...> or </tag>
  const tagRegex = /<\/?([a-zA-Z0-9_-]+)(?:\s+href=(?:"[^"]*"|'[^']*'))?\s*\/?>/g;
  const parts: string[] = [];
  let lastIndex = 0;
  const openStack: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(text)) !== null) {
    const textChunk = text.slice(lastIndex, match.index);
    if (textChunk) {
      parts.push(escapeHtml(textChunk));
    }

    const fullTag = match[0];
    const tagName = match[1]?.toLowerCase() ?? '';
    const isClosing = fullTag.startsWith('</');

    if (ALLOWED_TAGS.has(tagName)) {
      if (isClosing) {
        // Find matching tag in stack
        const stackIdx = openStack.lastIndexOf(tagName);
        if (stackIdx !== -1) {
          // Close any intervening tags if needed
          while (openStack.length > stackIdx) {
            const closingTag = openStack.pop();
            if (closingTag) {
              parts.push(`</${closingTag}>`);
            }
          }
        }
        // If no matching opening tag, drop this closing tag
      } else {
        // Opening tag
        if (tagName === 'a') {
          // Validate href
          const hrefMatch = /href=(?:"([^"]*)"|'([^']*)')/i.exec(fullTag);
          const href = hrefMatch ? (hrefMatch[1] ?? hrefMatch[2] ?? '') : '';
          if (/^https?:\/\//i.test(href)) {
            parts.push(`<a href="${escapeHtml(href)}">`);
            openStack.push('a');
          } else {
            // Drop invalid link tag
          }
        } else {
          parts.push(`<${tagName}>`);
          openStack.push(tagName);
        }
      }
    } else {
      // Not an allowed tag, escape it as plain text
      parts.push(escapeHtml(fullTag));
    }

    lastIndex = tagRegex.lastIndex;
  }

  // Remainder of text
  if (lastIndex < text.length) {
    parts.push(escapeHtml(text.slice(lastIndex)));
  }

  // Close any unclosed tags remaining on the stack
  while (openStack.length > 0) {
    const unclosed = openStack.pop();
    if (unclosed) {
      parts.push(`</${unclosed}>`);
    }
  }

  return parts
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Checks if a Telegram error is due to entity parsing failure.
 */
export function isTelegramEntityParseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  const code = 'code' in error && typeof error.code === 'string' ? error.code : '';
  return (
    /parse.*entit|can't parse entities|ENTITY_PARSE_FAILED|Bad Request: can't parse/i.test(
      message,
    ) || /PARSE/i.test(code)
  );
}
