import { renderDocText } from '../x-strategy/strategy-doc.js';

export const STRATEGY_DOC_PROMPT_SECTIONS = ['thesis', 'tracks', 'formats', 'rules'];
export const STRATEGY_DOC_PROMPT_MAX = 3000;

/** { version, text } for a CONFIRMED doc with usable content, else null (draft/absent => prompt unchanged). */
export function buildStrategyDocContext(doc) {
  if (!doc || doc.confirmed !== true) return null;
  const text = renderDocText(doc, { only: STRATEGY_DOC_PROMPT_SECTIONS, maxChars: STRATEGY_DOC_PROMPT_MAX });
  return text ? { version: doc.version ?? null, text } : null;
}

/** Prompt block ('' when no confirmed doc, so the prompt stays byte-identical). Ends with a blank line. */
export function strategyDocPromptBlock(strategyDoc) {
  if (!strategyDoc?.text) return '';
  return `OWNER'S CONFIRMED X STRATEGY (binding: every post must follow the Thesis, stay inside the Tracks, use the Formats, and obey the Rules; it overrides generic signals above)\n${strategyDoc.text}\n\n`;
}
