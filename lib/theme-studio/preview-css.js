// CSS for the pinned Light / Dark preview panes (contract 11.2): scope blocks only,
// so a draft palette can be compared side by side with no second app and no canvas.

import { resolveBoth, toCss } from '../theme/index.js';

export const PREVIEW_STYLE_ID = 'theme-studio-preview-css';

/** `resolved` is the store's { light, dark } when present, else resolve the draft here. */
export function buildPreviewScopeCss(draft, resolved) {
  if (resolved && resolved.light && resolved.dark) return toCss(resolved, { scopeOnly: true, header: false });
  if (!draft) return '';
  return toCss(resolveBoth(draft), { scopeOnly: true, header: false });
}
