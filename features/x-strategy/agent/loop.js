// loop.js - Anthropic tool-use loop for the X Strategy agent (T4a). Server-only.
// All I/O is injected (callModel, toolDeps, logUsage). The default transport is a plain fetch to the
// Messages API (same idiom as features/not-the-rug-brief/anthropic-client.js, used by enhancePost).
// The agent only PROPOSES; nothing here writes to plans, suggestions or inventory.

import { createRequire } from 'node:module';
import { STRATEGY_AGENT_MODEL, STRATEGY_DOC_MAX_CHARS, buildSystemPrompt } from './prompt.js';
import { renderDocText, describeDocChange } from '../strategy-doc.js';
import { BULK_PROPOSAL_KINDS, MAX_BULK_PROPOSALS_PER_TURN } from '../contracts.js';
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
    const body = withPromptCache({ model, max_tokens: maxTokens, messages, system, tools });
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

const EPHEMERAL = Object.freeze({ type: 'ephemeral' });

/**
 * Prompt caching: one breakpoint after the tools, one after the system prompt, one on the newest message. Within a
 * turn every tool round resends the same prefix (tools + system + strategy doc + earlier rounds), so later rounds read
 * it from cache at 0.1x instead of paying full input price again. Pure; never mutates its input.
 */
export function withPromptCache({ model, max_tokens, messages, system, tools }) {
  const body = { model, max_tokens };
  const list = Array.isArray(messages) ? messages.map((m) => ({ ...m })) : [];
  const last = list[list.length - 1];
  if (last) {
    const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : Array.isArray(last.content) ? last.content.map((b) => ({ ...b })) : null;
    if (blocks && blocks.length) {
      blocks[blocks.length - 1] = { ...blocks[blocks.length - 1], cache_control: EPHEMERAL };
      last.content = blocks;
    }
  }
  body.messages = list;
  if (system) body.system = [{ type: 'text', text: String(system), cache_control: EPHEMERAL }];
  if (Array.isArray(tools) && tools.length) body.tools = tools.map((t, i) => (i === tools.length - 1 ? { ...t, cache_control: EPHEMERAL } : t));
  return body;
}

/** Default usage logger: wraps logAnthropicCall (cost is computed by the same RATES table). */
export function createDefaultLogUsage() {
  let mod;
  const load = () => (mod ??= createRequire(import.meta.url)('../../../api/_lib/usage-logger.cjs'));
  return async function logUsage({ model, usage, clientId, purpose = PURPOSE, threadId }) {
    const u = usage || {};
    const { computeAnthropicCost, logAnthropicCall } = load();
    const costUsd = computeAnthropicCost({
      model, inputTokens: u.input_tokens, outputTokens: u.output_tokens,
      cacheWriteTokens: u.cache_creation_input_tokens, cacheReadTokens: u.cache_read_input_tokens,
    });
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

  // `maxRounds` / `maxTokens` may be raised per turn (a strategy Review needs a bigger tool budget).
  async function runTurn({ clientId, threadId, history = [], userText, selectedContext, maxRounds: roundsCap = maxRounds, maxTokens: tokensCap = maxTokens } = {}) {
    const usage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };
    const proposals = [];
    const userMessages = [...(Array.isArray(history) ? history : []).filter((m) => m?.role === 'user').map((m) => String(m.text ?? '')), String(userText ?? '')];
    const messages = buildMessages(history, userText);

    // The plan summary and the owner's Strategy document (+ its recent change log) are the only data in the system
    // prompt; every figure comes from tools.
    let planSummary;
    try { planSummary = await toolDeps?.getPlan?.(); } catch { planSummary = null; }
    let strategyDocText = '';
    try {
      const doc = await toolDeps?.getStrategyDoc?.();
      if (doc) {
        const changes = (doc.history || []).slice(-5).map(describeDocChange).filter(Boolean);
        strategyDocText = renderDocText(doc, { maxChars: STRATEGY_DOC_MAX_CHARS - 600 })
          + (changes.length ? `\n\nRECENT STRATEGY CHANGES (oldest first):\n${changes.map((c) => `- ${c}`).join('\n')}` : '');
      }
    } catch { strategyDocText = ''; }
    const system = buildSystemPrompt({ planSummary: planSummary ?? null, strategyDocText, selectedContext: typeof selectedContext === 'string' ? selectedContext : '' });

    const account = async (resp, ok) => {
      const u = resp?.usage || {};
      usage.calls += 1;
      usage.inputTokens += Number(u.input_tokens) || 0;
      usage.outputTokens += Number(u.output_tokens) || 0;
      usage.cacheReadTokens += Number(u.cache_read_input_tokens) || 0;
      usage.cacheWriteTokens += Number(u.cache_creation_input_tokens) || 0;
      try {
        const cacheRead = Number(u.cache_read_input_tokens) || 0;
        const cacheWrite = Number(u.cache_creation_input_tokens) || 0;
        const r = await log({ model, usage: {
          input_tokens: Number(u.input_tokens) || 0, output_tokens: Number(u.output_tokens) || 0,
          ...(cacheRead ? { cache_read_input_tokens: cacheRead } : {}), ...(cacheWrite ? { cache_creation_input_tokens: cacheWrite } : {}),
        }, clientId, purpose: PURPOSE, threadId });
        if (Number.isFinite(r?.costUsd)) usage.costUsd += r.costUsd;
      } catch { /* cost logging is best-effort and must not break the turn */ }
      return ok;
    };

    let rounds = 0;
    let capped = false;
    for (;;) {
      let resp;
      try {
        resp = await call({ model, system, messages, tools: TOOL_SCHEMAS, maxTokens: tokensCap });
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
      if (rounds >= roundsCap) {
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
        // Bulk kinds (one card, many items) have their own small cap and do not use up the per-turn proposal cap.
        const bulk = BULK_PROPOSAL_KINDS.includes(KIND_BY_PROPOSE_TOOL[tu.name]);
        if (bulk ? proposals.filter((p) => BULK_PROPOSAL_KINDS.includes(p.kind)).length >= MAX_BULK_PROPOSALS_PER_TURN
          : proposals.filter((p) => !BULK_PROPOSAL_KINDS.includes(p.kind)).length >= maxProposals) {
          return reply(`Proposal limit reached (${bulk ? MAX_BULK_PROPOSALS_PER_TURN : maxProposals} per turn). Do not propose more; tell the owner what else you would suggest in text.`, true);
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
