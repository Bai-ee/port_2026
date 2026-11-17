// Site Showcase allowlist. Only the HITLOOP owner client may render, and only focuses bundled here. The render
// service builds the spec from its own copy of the same focus file, so a request carries no params or scenes.
import hitloopFocus from './focus.hitloop.json' with { type: 'json' };

export { SHOWCASE_CLIENTS } from './clients.js';

export const SHOWCASE_THEMES = Object.freeze(['light', 'dark', 'cycle']);

const FOCUS_FILES = { hitloop: hitloopFocus };

export function getFocusFile(videoClient) {
  return FOCUS_FILES[videoClient] || null;
}

/**
 * Reads only focusId, format and theme; every other key on the body is ignored.
 * @returns {{ok:true, value:{focusId:string, format:string, theme:string}, focus:object} | {ok:false, error:string}}
 */
export function validateCreateInput(input, videoClient = 'hitloop') {
  const focusFile = getFocusFile(videoClient);
  if (!focusFile) return { ok: false, error: 'Unknown showcase client.' };
  const { focusId, format, theme = 'cycle' } = input || {};
  const focus = focusFile.focuses.find((f) => f.id === focusId);
  if (!focus) return { ok: false, error: 'Unknown focus.' };
  if (!focus.formats.includes(format)) return { ok: false, error: 'Format is not available for this focus.' };
  if (!SHOWCASE_THEMES.includes(theme)) return { ok: false, error: 'Unknown theme.' };
  return { ok: true, value: { focusId, format, theme }, focus };
}
