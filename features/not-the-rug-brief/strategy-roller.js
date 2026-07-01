'use strict';

// strategy-roller.js — Persistent 30-day post strategy with day-to-day memory.
//
// Runs between Scout and Scribe on every brief run:
//   1. Loads the previous strategy30 from dashboard_state (memory).
//   2. One LLM call revises the 30-day plan using today's Scout signals,
//      conversation-intake context, and knowledge-base context.
//   3. Returns { days, today, revisionNotes } — runtime attaches a prompt block
//      for Scribe (so the strategy rolls up into the Executive Daily Brief) and
//      run-lifecycle persists it back to dashboard_state.strategy30.
//
// User-edited days (source: 'user') are soft-locked: the model keeps them
// unless new signals strongly contradict them, and must explain any change
// in revisionNotes. Best-effort everywhere — failures never block the brief.

const fb = require('../../api/_lib/firebase-admin.cjs');
const { logAnthropicCall } = require('../../api/_lib/usage-logger.cjs');

const STRATEGY_MODEL = 'claude-sonnet-4-6';
const PLAN_DAYS = 30;

function isoDay(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

async function loadPreviousStrategy(clientId) {
  try {
    const snap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
    return snap.exists ? snap.data()?.strategy30 || null : null;
  } catch {
    return null;
  }
}

function summarizeAgentData(agentData = {}) {
  const lines = [];
  const add = (label, arr, fmt) => {
    const rows = (arr || []).slice(0, 5).map(fmt).filter(Boolean);
    if (rows.length) lines.push(`${label}:\n${rows.map((r) => `- ${r}`).join('\n')}`);
  };
  add('Category trends', agentData.categoryTrends, (t) => t.trend || t.detail);
  add('Brand mentions', agentData.brandMentions, (m) => `${m.source || ''}: ${(m.content || '').slice(0, 140)}`);
  add('Competitor intel', agentData.competitorIntel, (c) => `${c.competitor || ''}: ${(c.finding || '').slice(0, 140)}`);
  add('Escalations', agentData.escalations, (e) => `[${e.level || ''}] ${(e.summary || '').slice(0, 160)}`);
  const opps = agentData.viralOpportunities?.opportunities || agentData.contentOpportunities?.opportunities || [];
  add('Opportunities', opps, (o) => (o.conversation || o.topic || '').slice(0, 140));
  return lines.join('\n\n') || 'No live signals this run.';
}

function buildPrompt({ config, prev, agentDataSummary, todayIso }) {
  const prevBlock = prev?.days?.length
    ? `PREVIOUS 30-DAY STRATEGY (your memory — revise, don't restart):\n${prev.days
        .map((d) => `${d.date}${d.source === 'user' ? ' [USER-EDITED — keep unless strongly contradicted]' : ''}: ${d.theme ? `${d.theme} — ` : ''}${d.idea || ''}`)
        .join('\n')}\n\nPrevious revision notes: ${prev.revisionNotes || 'none'}`
    : 'No previous strategy exists — author a fresh 30-day plan.';

  const convo = config?.conversationContext?.available ? `TEAM CONVERSATION CONTEXT:\n${config.conversationContext.block}` : '';
  const kb = config?.knowledgeBaseContext?.available ? `KNOWLEDGE BASE (brand truth):\n${String(config.knowledgeBaseContext.block).slice(0, 2000)}` : '';

  return `You are the posting strategist for ${config.clientName} (${config.clientDescriptor || 'a brand'}).
Maintain a rolling ${PLAN_DAYS}-day post strategy. Today is ${todayIso}.

${prevBlock}

TODAY'S LIVE SIGNALS (from Scout):
${agentDataSummary}

${convo}

${kb}

RULES:
- Produce exactly ${PLAN_DAYS} days starting ${todayIso}. Drop past days, extend the tail.
- Make RATIONAL, MINIMAL tweaks: keep what still holds, change only what today's signals justify, and say why in revisionNotes.
- Days marked [USER-EDITED] are soft-locked: preserve them verbatim (keep source "user") unless strongly contradicted — if changed, explain in revisionNotes.
- "today" = the post to make TODAY: a concrete, ready-to-post draft for X plus its angle and a one-line rationale tied to a live signal.
- Themes are short (2-5 words); ideas are one actionable sentence.

Return STRICT JSON only, no fences:
{"days":[{"date":"YYYY-MM-DD","theme":"...","idea":"...","source":"auto|user"}],"today":{"post":"...","angle":"...","rationale":"..."},"revisionNotes":"what changed vs yesterday and why (or 'initial plan')"}`;
}

function parseJsonLoose(text) {
  if (!text) return null;
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

function normalize(parsed, todayIso) {
  const days = (Array.isArray(parsed?.days) ? parsed.days : [])
    .map((d) => ({
      date: String(d?.date || '').slice(0, 10),
      theme: String(d?.theme || '').trim().slice(0, 80),
      idea: String(d?.idea || '').trim().slice(0, 300),
      source: d?.source === 'user' ? 'user' : 'auto',
    }))
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.idea)
    .slice(0, PLAN_DAYS);
  if (!days.length) return null;
  return {
    days,
    today: {
      post: String(parsed?.today?.post || '').trim().slice(0, 800),
      angle: String(parsed?.today?.angle || '').trim().slice(0, 300),
      rationale: String(parsed?.today?.rationale || '').trim().slice(0, 400),
    },
    revisionNotes: String(parsed?.revisionNotes || '').trim().slice(0, 1200),
    generatedAtIso: new Date().toISOString(),
    planDate: todayIso,
  };
}

/** Build the prompt block Scribe folds into the Executive Daily Brief. */
function buildScribeBlock(strategy30) {
  if (!strategy30?.days?.length) return '';
  const week = strategy30.days.slice(0, 7).map((d) => `${d.date}: ${d.theme ? `${d.theme} — ` : ''}${d.idea}`).join('\n');
  return `30-DAY POST STRATEGY (current plan — the brief should align with it):
Today's planned post: ${strategy30.today?.post || '—'}
Today's angle: ${strategy30.today?.angle || '—'} (${strategy30.today?.rationale || ''})
Next 7 days:
${week}
Revision notes: ${strategy30.revisionNotes || '—'}`;
}

/**
 * Revise (or author) the 30-day strategy. Best-effort; returns null on failure.
 */
async function rollStrategy({ clientId, config, brief, provider }) {
  if (!provider?.messages?.create) return null;
  const todayIso = isoDay(Date.now());
  const prev = await loadPreviousStrategy(clientId);
  const prompt = buildPrompt({
    config,
    prev,
    agentDataSummary: summarizeAgentData(brief?.agentData || {}),
    todayIso,
  });
  const response = await provider.messages.create({
    model: STRATEGY_MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });
  // Instrument this Sonnet call — it runs on every full pipeline and was untracked.
  try { await logAnthropicCall({ module: 'strategy-roller', action: 'roll', model: STRATEGY_MODEL, response, clientId }); } catch { /* best-effort */ }
  const text = (response?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return normalize(parseJsonLoose(text), todayIso);
}

module.exports = { rollStrategy, buildScribeBlock };
