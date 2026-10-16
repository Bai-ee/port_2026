// The model drafter: one Anthropic call per suggestion, logged for the Operating Cost card.
// Decides nothing about content; never runs unless a human asks (client and logger are injected).
// Stands alone (plus the pure market-signals prompt section).

import { marketSignalsPromptSection } from '../../content-context/market-signals.js';
import { listSignalsPromptSection } from '../../content-context/list-signals.js';

// --- model drafting ------------------------------------------------------------

export const DRAFT_MODEL = 'claude-sonnet-4-6';

/**
 * One Anthropic call per suggestion, logged through logAnthropicCall so the
 * spend reaches the Operating Cost card. Only built when a human asks for it.
 * deps: { anthropic (client), logAnthropicCall, clientId }
 */
export function createModelDrafter({ anthropic, logAnthropicCall, clientId }) {
  // `opts.marketSignals` is passed by the runner only for slots where a market topic can fit (not quote reactions).
  return async ({ system, prompt }, opts = {}) => {
    const market = marketSignalsPromptSection(opts?.marketSignals);
    const lists = listSignalsPromptSection(opts?.listSignals, opts?.trackId);
    const extra = [market, lists].filter(Boolean).join('\n\n');
    const full = extra ? prompt.replace(/\n*Return ONLY minified JSON/, `\n\n${extra}\n\nReturn ONLY minified JSON`) : prompt;
    const res = await anthropic.messages.create({ model: DRAFT_MODEL, max_tokens: 400, system, messages: [{ role: 'user', content: full }] });
    try { await logAnthropicCall({ module: 'x-content-inventory', action: 'daily-loop', model: DRAFT_MODEL, response: res, clientId }); } catch { /* logging never blocks drafting */ }
    let text = String(res?.content?.[0]?.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    text = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return { post: String(JSON.parse(text).post || '').trim(), model: DRAFT_MODEL };
  };
}
