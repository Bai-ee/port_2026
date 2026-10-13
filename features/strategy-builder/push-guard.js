import { guardXPost } from '../x-content-guard/index.js';

/**
 * Map a Strategy Builder item to the guard's post shape. Items are original
 * posts; a paired video is a showcase, anything else is plain original text.
 */
export function guardInputForItem(item, text) {
  const media = item?.mediaUrl ? String(item.mediaType || 'none') : 'none';
  return {
    text: String(text || ''),
    type: media === 'video' ? 'original-showcase' : 'original-text',
    media: ['video', 'image', 'gif'].includes(media) ? media : 'none',
  };
}

/**
 * Per-item push decision.
 *  - hardBlock          -> { action: 'block', reason: 'guard: <codes/lane>' }
 *  - major flags        -> { action: 'flag', guard: { lane, flags } } (still scheduled)
 *  - otherwise          -> { action: 'ok' }
 * Never throws; a guard failure must not block a push on its own.
 */
export function decidePushGuard(item, text, { handle, guard = guardXPost } = {}) {
  let verdict;
  try {
    verdict = guard(guardInputForItem(item, text), { handle });
  } catch {
    return { action: 'ok' };
  }
  const flags = Array.isArray(verdict?.flags) ? verdict.flags : [];
  if (verdict?.hardBlock) {
    const codes = flags.filter((f) => f.severity === 'major').map((f) => f.code);
    const detail = [...new Set(codes)].join(', ');
    return {
      action: 'block',
      reason: `guard: ${detail || 'blocked'}${verdict.lane ? ` (lane: ${verdict.lane})` : ''}`,
    };
  }
  const major = flags.filter((f) => f.severity === 'major');
  if (major.length) {
    return {
      action: 'flag',
      guard: { lane: verdict.lane || 'unknown', flags: major.map((f) => ({ code: f.code, severity: f.severity, issue: f.issue })) },
    };
  }
  return { action: 'ok' };
}
