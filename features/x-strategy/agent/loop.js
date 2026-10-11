// loop.js - Anthropic tool-use loop for the X Strategy agent (T4a). Server-only.
// All I/O is injected (callModel, toolDeps, logUsage). The default transport is a plain fetch to the
// Messages API (same idiom as features/not-the-rug-brief/anthropic-client.js, used by enhancePost).
// The agent only PROPOSES; nothing here writes to plans, suggestions or inventory.

import { createRequire } from 'node:module';
import { STRATEGY_AGENT_MODEL, buildSystemPrompt } from './prompt.js';
import {
  TOOL_SCHEMAS, READ_TOOL_NAMES, KIND_BY_PROPOSE_TOOL, runReadTool, prepareProposal, serializeResult,
} from './tools.js';

export { STRATEGY_AGENT_MODEL };

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const PURPOSE = 'x-strategy-chat';
const ROUND_CAP_NOTE = 'Tool limit reached for this turn. Do not call any more tools. Answer the owner now in plain text using what you already have, and say what you could not check.';
const ROUND_CAP_FALLBACK = 'I hit my tool limit for this turn before finishing. Ask again, a bit narrower, and I will pick up from there.';

export class AgentError extends Error {
  /** @param {string} code  missing-api-key | transport | rate-limited | api-error | bad-response | model-error */
  constructor(message, { code = 'model-error', status = null, usage = null, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AgentError';
    this.code = code;
    this.status = status;
    this.usage = usage;
  }
}

function scrub(text, secret) {
  let s = String(text ?? '');
  if (secret) s = s.split(secret).join('[redacted]');
  return s.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]');
}

/**
 * Default transport: Anthropic Messages API over fetch. No SDK, no new library.
 * @param {{apiKey?:string, fetchImpl?:typeof fetch}} [opts]  apiKey falls back to ANTHROPIC_API_KEY at call time
 */
export function createAnthropicCaller({ apiKey, fetchImpl } = {}) {
  return async function callModel({ model, system, messages, tools, maxTokens }) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) throw new AgentError('The strategy agent is not configured (ANTHROPIC_API_KEY is missing).', { code: 'missing-api-key' });
    const doFetch = fetchImpl || globalThis.fetch;
    const body = { model, max_tokens: maxTokens, messages };
    if (system) body.system = system;
    if (Array.isArray(tools) && tools.length) body.tools = tools;
    let res;
    try {
      res = await doFetch(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new AgentError(`Could not reach the model service: ${scrub(err?.message, key).slice(0, 120)}`, { code: 'transport' });
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.parse(text)?.error?.message || ''; } catch { /* non-JSON body */ }
      const code = res.status === 429 ? 'rate-limited' : 'api-error';
      throw new AgentError(`Model service error ${res.status}${detail ? `: ${scrub(detail, key).slice(0, 200)}` : ''}`, { code, status: res.status });
    }
    let json;
    try { json = JSON.parse(text); } catch { throw new AgentError('Model service returned an unreadable response.', { code: 'bad-response', status: res.status }); }
    if (!json || !Array.isArray(json.content)) throw new AgentError('Model service returned an unexpected response shape.', { code: 'bad-response', status: res.status });
    return json;
  };
}

/** Default usage logger: wraps logAnthropicCall (cost is computed by the same RATES table). */
export function createDefaultLogUsage() {
  let mod;
  const load = () => (mod ??= createRequire(import.meta.url)('../../../api/_lib/usage-logger.cjs'));
  return async function logUsage({ model, usage, clientId, purpose = PURPOSE, threadId }) {
    const u = usage || {};
    const { computeAnthropicCost, logAnthropicCall } = load();
    const costUsd = computeAnthropicCost({ model, inputTokens: u.input_tokens, outputTokens: u.output_tokens });
    await logAnthropicCall({
      module: 'x-strategy', action: purpose, model, response: { usage: u }, clientId: clientId ?? null,
      metadata: { purpose, threadId: threadId ?? null },
    });
    return { costUsd };
  };
}

const textOf = (content) => (Array.isArray(content) ? content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim() : '');

/** history (bounded by caller) + this turn -> Anthropic messages. Notes become user context; same-role runs merge; first must be user. */
function buildMessages(history, userText) {
  const raw = [];
  for (const m of Array.isArray(history) ? history : []) {
    const text = String(m?.text ?? '').trim();
    if (!text) continue;
    if (m.role === 'user') raw.push({ role: 'user', text });
    else if (m.role === 'assistant') raw.push({ role: 'assistant', text });
    else if (m.role === 'note') raw.push({ role: 'user', text: `[Earlier conversation, summarized] ${text}` });
  }
  raw.push({ role: 'user', text: String(userText ?? '').trim() });
  const merged = [];
  for (const m of raw) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.text}`;
    else merged.push({ role: m.role, content: m.text });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  return merged;
}

function parseToolInput(input) {
  if (typeof input === 'string') {
    try { const v = JSON.parse(input); return v && typeof v === 'object' && !Array.isArray(v) ? { ok: true, value: v } : { ok: false }; } catch { return { ok: false }; }
  }
  return input && typeof input === 'object' && !Array.isArray(input) ? { ok: true, value: input } : { ok: false };
}

/**
 * @param {{callModel?:Function, toolDeps:object, logUsage?:Function, model?:string, maxRounds?:number, maxProposals?:number, maxTokens?:number}} cfg
 */
export function createAgentLoop({
  callModel, toolDeps, logUsage, model = STRATEGY_AGENT_MODEL, maxRounds = 4, maxProposals = 2, maxTokens = 1500,
} = {}) {
  const call = callModel || createAnthropicCaller();
  const log = logUsage || createDefaultLogUsage();

  async function runTurn({ clientId, threadId, history = [], userText, selectedContext } = {}) {
    const usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
    const proposals = [];
    const userMessages = [...(Array.isArray(history) ? history : []).filter((m) => m?.role === 'user').map((m) => String(m.text ?? '')), String(userText ?? '')];
    const messages = buildMessages(history, userText);

    // Plan summary is the only data in the system prompt; everything else comes from tools.
    let planSummary;
    try { planSummary = await toolDeps?.getPlan?.(); } catch { planSummary = null; }
    const system = buildSystemPrompt({ planSummary: planSummary ?? null, selectedContext: typeof selectedContext === 'string' ? selectedContext : '' });

    const account = async (resp, ok) => {
      const u = resp?.usage || {};
      usage.calls += 1;
      usage.inputTokens += Number(u.input_tokens) || 0;
      usage.outputTokens += Number(u.output_tokens) || 0;
      try {
        const r = await log({ model, usage: { input_tokens: Number(u.input_tokens) || 0, output_tokens: Number(u.output_tokens) || 0 }, clientId, purpose: PURPOSE, threadId });
        if (Number.isFinite(r?.costUsd)) usage.costUsd += r.costUsd;
      } catch { /* cost logging is best-effort and must not break the turn */ }
      return ok;
    };

    let rounds = 0;
    let capped = false;
    for (;;) {
      let resp;
      try {
        resp = await call({ model, system, messages, tools: TOOL_SCHEMAS, maxTokens });
      } catch (err) {
        const out = err instanceof AgentError ? err : new AgentError(`The model call failed: ${scrub(err?.message).slice(0, 160)}`, { code: 'model-error', cause: err });
        out.usage = { ...usage };
        throw out;
      }
      await account(resp, true);

      const content = Array.isArray(resp?.content) ? resp.content : [];
      const toolUses = content.filter((b) => b?.type === 'tool_use');
      if (resp?.stop_reason !== 'tool_use' || !toolUses.length || capped) {
        let text = textOf(content);
        if (capped && !text) text = ROUND_CAP_FALLBACK;
        const stopped = capped ? 'round-cap' : resp?.stop_reason === 'max_tokens' ? 'max-tokens' : 'end';
        return { text, proposals, usage: { ...usage }, rounds, stopped };
      }

      rounds += 1;
      messages.push({ role: 'assistant', content });
      const results = [];
      for (const tu of toolUses) results.push(await handleToolUse(tu));
      if (rounds >= maxRounds) {
        capped = true;
        results.push({ type: 'text', text: ROUND_CAP_NOTE });
      }
      messages.push({ role: 'user', content: results });
    }

    async function handleToolUse(tu) {
      const reply = (content, isError = false) => ({ type: 'tool_result', tool_use_id: tu.id, content, ...(isError ? { is_error: true } : {}) });
      const parsed = parseToolInput(tu.input ?? {});
      if (!parsed.ok) return reply('Tool input must be a JSON object. Retry with valid input.', true);
      if (READ_TOOL_NAMES.includes(tu.name)) {
        try {
          return reply(serializeResult(await runReadTool(tu.name, parsed.value, toolDeps)));
        } catch (err) {
          return reply(`Tool failed: ${String(err?.message ?? err).slice(0, 200)}`, true);
        }
      }
      if (KIND_BY_PROPOSE_TOOL[tu.name]) {
        if (proposals.length >= maxProposals) {
          return reply(`Proposal limit reached (${maxProposals} per turn). Do not propose more; tell the owner what else you would suggest in text.`, true);
        }
        const prep = await prepareProposal(tu.name, parsed.value, { toolDeps, userMessages });
        if (!prep.ok) return reply(`Proposal rejected: ${prep.error}`, true);
        proposals.push(prep.proposal);
        return reply('recorded - the owner will confirm or reject');
      }
      return reply(`Unknown tool: ${String(tu.name).slice(0, 60)}`, true);
    }
  }

  return { runTurn };
}
