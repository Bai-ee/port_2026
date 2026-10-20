// response-style.js - the owner's saved "how to answer me" instructions for the strategy agent.
// Stored per client at client_configs/{clientId}.agentPreferences.responseStyle; read at the start of every agent turn
// (dashboard chat, MCP chat_send) and exposed read-only to MCP clients (strategy_get_response_style) so Claude over MCP
// formats the same way. Only the in-app agent writes it (save_response_style), when the owner says how replies should look.

export const RESPONSE_STYLE_MAX_CHARS = 1200;
export const RESPONSE_STYLE_HISTORY = 5;

// Used until the owner saves their own. Built for reading in a few seconds; the owner can replace any of it.
export const DEFAULT_RESPONSE_STYLE = [
  'Verdict line first: the answer in one sentence.',
  'Then the key numbers: the figure, then its source and age in brackets. Your own figures and a quoted post\'s figures on separate lines.',
  'When comparing, a few short aligned lines (no markdown table).',
  'Give the exact copy or slot for any post you recommend. Put each link right next to the item it belongs to.',
  'End with the card(s) you put up, or one question, or one line "Next: <the single best action>".',
  'No preamble, no recap of the question, no hedging.',
].join('\n');

const clean = (text) => String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, RESPONSE_STYLE_MAX_CHARS);

/**
 * The next stored value. mode 'replace' swaps the text, 'append' adds the new lines to the end (trimmed to the max).
 * @returns {{ok:true, value:object} | {ok:false, error:string}}
 */
export function nextResponseStyle(current, { text, mode = 'replace', by = null, now = new Date().toISOString() } = {}) {
  const add = clean(text);
  if (!add) return { ok: false, error: 'text is required' };
  if (!['replace', 'append'].includes(mode)) return { ok: false, error: 'mode must be replace or append' };
  const prev = current && typeof current.text === 'string' ? current.text : '';
  const merged = mode === 'append' && prev ? clean(`${prev}\n${add}`) : add;
  const history = [
    ...(prev ? [{ text: prev, updatedAt: current.updatedAt ?? null }] : []),
    ...(Array.isArray(current?.history) ? current.history : []),
  ].slice(0, RESPONSE_STYLE_HISTORY);
  return { ok: true, value: { text: merged, updatedAt: now, by, history } };
}

/** What the agent and MCP see: the saved text, or the default marked as such. */
export function effectiveResponseStyle(stored) {
  const text = stored && typeof stored.text === 'string' ? clean(stored.text) : '';
  return text
    ? { text, isDefault: false, updatedAt: stored.updatedAt ?? null }
    : { text: DEFAULT_RESPONSE_STYLE, isDefault: true, updatedAt: null };
}

export function createFirestoreResponseStyleStore(db) {
  const ref = (clientId) => db.collection('client_configs').doc(clientId);
  return {
    async get(clientId) {
      const snap = await ref(clientId).get();
      return snap.exists ? snap.data()?.agentPreferences?.responseStyle ?? null : null;
    },
    async save(clientId, value) {
      await ref(clientId).set({ agentPreferences: { responseStyle: value } }, { merge: true });
      return value;
    },
  };
}

export function createMemoryResponseStyleStore(seed = {}) {
  const docs = new Map(Object.entries(seed));
  return {
    async get(clientId) { return docs.has(clientId) ? JSON.parse(JSON.stringify(docs.get(clientId))) : null; },
    async save(clientId, value) { docs.set(clientId, JSON.parse(JSON.stringify(value))); return value; },
  };
}
