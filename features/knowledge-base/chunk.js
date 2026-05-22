const DEFAULT_TARGET_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 75;
const DEFAULT_MAX_CHARS = 3200;

export function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function estimateTokens(text) {
  const s = String(text || '').trim();
  if (!s) return 0;
  return Math.max(1, Math.ceil(s.length / 4));
}

function splitLongChunk(words, maxChars) {
  const parts = [];
  let current = [];
  let currentLength = 0;

  for (const word of words) {
    const nextLength = currentLength + word.length + (current.length ? 1 : 0);
    if (current.length && nextLength > maxChars) {
      parts.push(current.join(' '));
      current = [];
      currentLength = 0;
    }
    current.push(word);
    currentLength += word.length + (current.length > 1 ? 1 : 0);
  }

  if (current.length) parts.push(current.join(' '));
  return parts;
}

export function chunkText(text, options = {}) {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const targetTokens = Math.max(100, Number(options.targetTokens) || DEFAULT_TARGET_TOKENS);
  const overlapTokens = Math.max(0, Math.min(targetTokens - 1, Number(options.overlapTokens) || DEFAULT_OVERLAP_TOKENS));
  const maxChars = Math.max(800, Number(options.maxChars) || DEFAULT_MAX_CHARS);
  const words = normalized.split(/\s+/).filter(Boolean);

  if (!words.length) return [];

  const chunks = [];
  let start = 0;
  let position = 0;

  while (start < words.length) {
    const end = Math.min(words.length, start + targetTokens);
    const slice = words.slice(start, end);
    const parts = splitLongChunk(slice, maxChars);

    for (const part of parts) {
      const textPart = part.trim();
      if (!textPart) continue;
      chunks.push({
        position,
        text: textPart,
        charCount: textPart.length,
        tokenEstimate: estimateTokens(textPart),
      });
      position += 1;
    }

    if (end >= words.length) break;
    start = Math.max(end - overlapTokens, start + 1);
  }

  return chunks;
}
