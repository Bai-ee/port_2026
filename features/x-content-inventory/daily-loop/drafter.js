// The model drafter: one Anthropic call per suggestion, logged for the Operating Cost card.
// Decides nothing about content; never runs unless a human asks (client and logger are injected).
// Stands alone.

// --- model drafting ------------------------------------------------------------

export const DRAFT_MODEL = 'claude-sonnet-4-6';

/**
 * One Anthropic call per suggestion, logged through logAnthropicCall so the
 * spend reaches the Operating Cost card. Only built when a human asks for it.
 * deps: { anthropic (client), logAnthropicCall, clientId }
 */
export function createModelDrafter({ anthropic, logAnthropicCall, clientId }) {
  return async ({ system, prompt }) => {
    const res = await anthropic.messages.create({ model: DRAFT_MODEL, max_tokens: 400, system, messages: [{ role: 'user', content: prompt }] });
    try { await logAnthropicCall({ module: 'x-content-inventory', action: 'daily-loop', model: DRAFT_MODEL, response: res, clientId }); } catch { /* logging never blocks drafting */ }
    let text = String(res?.content?.[0]?.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    text = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    return { post: String(JSON.parse(text).post || '').trim(), model: DRAFT_MODEL };
  };
}
