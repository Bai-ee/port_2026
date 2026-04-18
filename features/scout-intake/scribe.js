'use strict';

// scribe.js — Card copy + brief-doc writer.
//
// One Haiku call that reads analyzer signals + userContext and emits:
//   - cards: { [cardId]: { short, expanded } }
//   - brief: { headline, summary, prioritySignals[], topOpportunities[],
//              visualIdentityHighlight, recommendedNextStep }
//
// Scribe does NOT analyze — all facts come from analyzerResults. Its job is
// tone, length discipline, and framing. Soft caps only (sentence-complete,
// never mid-word). Quality scaling: low-confidence cards aim toward min,
// high-confidence toward max.
//
// Input token cost: ~500–1200 (compact analyzer signals only, no raw HTML).
// Output token cost: grows with card count + expanded budgets.
// Typical cost per run: ~$0.005–$0.015.

const { getCard } = require('./card-contract');
const { GLOBAL_BRAND_TONE, DESCRIPTION_STRUCTURE, getVoiceForActionClass } = require('./card-voice');

// Naming-convention match for gap ruleIds that represent AUDIT FAILURES
// (tool/network/data-availability problems) rather than SITE CONDITIONS.
// Scribe treats these as disclosures ("audit ran with limited data"), not as
// site problems to enumerate. Examples: psi-data-unavailable, fetch-failed,
// synthesize-failed, ai-seo-audit-failed, audit-incomplete.
function isAuditFailureGap(ruleId) {
  if (!ruleId) return false;
  const id = String(ruleId).toLowerCase();
  return id.includes('unavailable') ||
         id.includes('-failed') ||
         id.includes('_failed') ||
         id.startsWith('audit-');
}

const SCRIBE_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 4096;

// ── Anthropic client (same pattern as synth / extractor) ─────────────────────

function getApiKey() {
  const key =
    process.env.ANTHROPIC_API_KEY ||
    (() => {
      try { require('dotenv/config'); } catch { /* ignore */ }
      return process.env.ANTHROPIC_API_KEY;
    })();
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set.');
  return key;
}

async function callAnthropic(params) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// ── Card digest builder ──────────────────────────────────────────────────────
//
// Picks cards with status:'ok' and `copy` budgets. Strips every field Scribe
// doesn't need so the input prompt stays small.

function buildCardDigest(analyzerResults, analyzerOutputs = {}) {
  const byCard = analyzerResults?.byCard || {};
  const entries = [];

  for (const [cardId, result] of Object.entries(byCard)) {
    if (!result || result.status !== 'ok') continue;
    const card = getCard(cardId);
    if (!card || !card.copy) continue;

    // P4: prefer analyzerOutputs.aggregate as signal source when available.
    // Legacy path: fall back to analyzerResults.byCard[cardId] signals.
    const aggregate = analyzerOutputs?.[cardId]?.aggregate || null;

    let confidence = result.confidence || 'medium';
    let analyzerSignal = null;

    if (aggregate) {
      // Readiness → confidence mapping:
      //   critical = rich findings to write about → high
      //   healthy  = clean bill, still write authoritatively → high
      //   partial  = incomplete data → medium
      confidence = aggregate.readiness === 'partial' ? 'medium' : 'high';

      const topFindings = (aggregate.findings || [])
        .slice(0, 3)
        .map((f) => ({ severity: f.severity, label: f.label, detail: f.detail }));

      const allTriggeredGaps = (aggregate.gaps || [])
        .filter((g) => g.triggered)
        .map((g) => ({ ruleId: g.ruleId, evidence: g.evidence }));

      // Audit-failure gaps (PSI unavailable, fetch failed, etc.) are TOOL
      // limitations, not site problems. Scribe must disclose them as audit
      // state, NOT list them alongside real site issues. See isAuditFailureGap.
      const auditFailureGaps = allTriggeredGaps.filter((g) => isAuditFailureGap(g.ruleId));
      const siteProblemGaps  = allTriggeredGaps.filter((g) => !isAuditFailureGap(g.ruleId));

      const findingCounts = {
        critical: (aggregate.findings || []).filter((f) => f.severity === 'critical').length,
        warning:  (aggregate.findings || []).filter((f) => f.severity === 'warning').length,
        info:     (aggregate.findings || []).filter((f) => f.severity === 'info').length,
      };

      analyzerSignal = {
        readiness:        aggregate.readiness,
        highlights:       aggregate.highlights || [],
        topFindings,
        triggeredGaps:    siteProblemGaps,   // real site issues only
        auditFailureGaps,                     // tool failures — framed separately
        findingCounts,
      };
    }

    entries.push({
      cardId,
      role:           card.role,
      actionClass:    card.actionClass,
      confidence,
      qualityScaling: card.qualityScaling !== false,
      shortBudget:    card.copy.short,
      expandedBudget: card.copy.expanded,
      signals:        aggregate ? null : (result.signals || null),  // don't double-send
      analyzerSignal: analyzerSignal || null,
      notes:          result.notes || null,
    });
  }

  return entries;
}

// ── Prompt builder ───────────────────────────────────────────────────────────

function formatUserContext(userContext) {
  if (!userContext) return 'USER CONTEXT: (no onboarding answers yet)';
  const lines = ['USER CONTEXT (from onboarding survey):'];
  const pairs = [
    ['stage',             userContext.stage],
    ['intent',            userContext.intent],
    ['services',          userContext.services],
    ['priority',          userContext.priority],
    ['currentState',      userContext.currentState],
    ['blocker',           userContext.blocker],
    ['outputExpectation', userContext.outputExpectation],
  ];
  for (const [k, v] of pairs) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      if (v.length) lines.push(`- ${k}: ${v.join(', ')}`);
    } else if (String(v).trim()) {
      lines.push(`- ${k}: ${v}`);
    }
  }
  return lines.length > 1 ? lines.join('\n') : 'USER CONTEXT: (all answers skipped)';
}

function formatCardDigest(digest) {
  const lines = ['CARDS TO WRITE:'];
  for (const c of digest) {
    lines.push('');
    lines.push(`[${c.cardId}] role=${c.role} confidence=${c.confidence}`);
    lines.push(`  short:    ${c.shortBudget.min}-${c.shortBudget.max} chars`);
    lines.push(`  expanded: ${c.expandedBudget.min}-${c.expandedBudget.max} chars`);
    // Role-specific priority/voice rule — tells Scribe WHAT to lead with on
    // this card. Global brand tone + description structure live in the prompt
    // once; per-card voice lives here.
    lines.push(`  voice: ${getVoiceForActionClass(c.actionClass)}`);
    if (c.notes) lines.push(`  notes: ${c.notes}`);
    if (c.analyzerSignal) {
      const a = c.analyzerSignal;
      lines.push(`  analyzer_readiness: ${a.readiness}`);
      if (a.findingCounts) {
        const fc = a.findingCounts;
        lines.push(`  analyzer_finding_counts: critical=${fc.critical} warning=${fc.warning} info=${fc.info}`);
      }
      if (a.highlights.length) {
        lines.push(`  analyzer_highlights: ${a.highlights.join(' · ')}`);
      }
      if (a.topFindings.length) {
        lines.push(`  analyzer_findings: ${JSON.stringify(a.topFindings).slice(0, 600)}`);
      }
      if (a.triggeredGaps.length) {
        lines.push(`  analyzer_gaps: ${JSON.stringify(a.triggeredGaps).slice(0, 400)}`);
      }
      // Audit failures are disclosed separately so Scribe can frame them as
      // tool limitations, not site problems. See AUDIT STATE block in the prompt.
      if (a.auditFailureGaps && a.auditFailureGaps.length) {
        lines.push(`  audit_failures: ${JSON.stringify(a.auditFailureGaps).slice(0, 400)}`);
      }
    } else if (c.signals) {
      lines.push(`  signals: ${JSON.stringify(c.signals).slice(0, 600)}`);
    }
  }
  return lines.join('\n');
}

function buildScribePrompt({ digest, userContext, websiteUrl }) {
  return `You are the Scribe for a brand intake dashboard. You DO NOT analyze — every fact is already in the signals below. Your job is tone, framing, and length discipline.

SITE: ${websiteUrl}

${formatUserContext(userContext)}

${formatCardDigest(digest)}

LENGTH RULES — READ CAREFULLY
- Every copy field has a min-max char range. Aim INSIDE the range.
- Soft caps: NEVER cut mid-word. If you are inside the range when the sentence ends, stop. If you are near the max, finish the sentence you are in even if you overshoot by up to ~15%.
- Undershooting min is worse than overshooting max. Weak signals still deserve a complete sentence.

QUALITY SCALING
- confidence=high  → aim near the MAX of each range. Rich signals deserve fuller copy.
- confidence=medium → aim near the MIDDLE of each range.
- confidence=low   → aim near the MIN. Do NOT pad weak signals into long copy.

FACT DISCIPLINE
- Use only the signals provided per card. Do not invent company names, numbers, features, or claims.
- If a card's signals are thin, write briefly and specifically from what is there. Do not fall back to generic marketing filler.
- The user context (if present) tells you the reader's stage and priority — let it shape TONE and EMPHASIS, never invent facts.
- When making numeric claims about findings (e.g. "X critical issues"), use \`analyzer_finding_counts\` as ground truth. Do not count findings from the findings list yourself — the counts may differ due to aggregation.

AUDIT STATE — distinguish tool failures from site problems
- \`audit_failures\` lists TOOL limitations (PSI returned an error, fetch timed out, etc.). These are NOT site problems. They are disclosures about what we could and could not measure.
- When \`audit_failures\` is present, OPEN the description with a single-phrase acknowledgment: "Audit ran with limited data — [one-line reason]." Then describe the real \`analyzer_findings\` / \`analyzer_gaps\` as usual.
- DO NOT include audit failures in the "critical issues" count.
- DO NOT phrase audit failures as if the site is broken. A PSI tool error does not mean "your site is broken" — it means "we couldn't measure it this run."
- If the ONLY signals are audit failures (no real findings, no real gaps), the description should be short and honest: we tried, here's what blocked the audit, suggest a re-run. Do NOT enumerate fake problems.
- Real site findings (missing H1, no schema markup, no contact info) ARE site problems — describe them normally even when audit failures are also present.

${GLOBAL_BRAND_TONE}

${DESCRIPTION_STRUCTURE}

VOICE (mechanical rules)
- Crisp, specific, confident. No hedging ("might", "could", "perhaps").
- No pleasantries, no meta-commentary, no preamble.
- Short sentences over long ones. Active voice.
- No emojis.

BRIEF DOC
- The 'brief' fields produce the daily/weekly brief document and email. Derive them from the same signals — do not introduce new facts.
- headline: one sentence, ≤120 chars, names the brand or the site's core offer.
- summary: 2-4 sentences, ≤500 chars total, what the site is and who it's for.
- prioritySignals: 1-3 short phrases pulled from the signal cards.
- topOpportunities: 1-3 short phrases pulled from content-opportunities signals if present.
- visualIdentityHighlight: one sentence on the design personality if styleGuide signals are present.
- recommendedNextStep: one sentence, actionable, tuned to userContext.priority and outputExpectation if set.

RECOMMENDATION RULES
- For each card that shows analyzer_findings or analyzer_gaps in its signal block, write a recommendation field: one actionable sentence, ≤120 chars, naming exactly what to fix first.
- The sentence must cite a specific finding label or gap ruleId from the signal block. No generic advice.
- Tune emphasis to userContext.priority and outputExpectation when present.
- If analyzer_readiness is 'healthy' or no analyzer signals are present for a card, leave recommendation as an empty string.
- Do NOT write a recommendation for cards that have no analyzer_findings and no analyzer_gaps.

Now call write_dashboard_cards with one entry per cardId in CARDS TO WRITE, plus the brief fields.`;
}

// ── Tool schema (dynamic — built from the digest) ────────────────────────────

function buildScribeTool(digest) {
  const cardProps = {};
  const cardRequired = [];

  for (const c of digest) {
    cardProps[c.cardId] = {
      type: 'object',
      required: ['short', 'expanded'],
      properties: {
        short: {
          type: 'string',
          description: `Short tile copy. Target ${c.shortBudget.min}-${c.shortBudget.max} chars. Finish the sentence — never mid-word.`,
        },
        expanded: {
          type: 'string',
          description: `Expanded modal copy. Target ${c.expandedBudget.min}-${c.expandedBudget.max} chars. Finish the sentence — never mid-word.`,
        },
        recommendation: {
          type: 'string',
          description: 'One actionable sentence ≤120 chars citing a specific finding or gap. Empty string when no analyzer findings or readiness is healthy.',
        },
      },
    };
    cardRequired.push(c.cardId);
  }

  return {
    name: 'write_dashboard_cards',
    description: 'Write per-card short + expanded copy and a summary brief. Facts come from the signals already provided — do not invent.',
    input_schema: {
      type: 'object',
      required: ['cards', 'brief'],
      properties: {
        cards: {
          type: 'object',
          required: cardRequired,
          properties: cardProps,
        },
        brief: {
          type: 'object',
          required: ['headline', 'summary'],
          properties: {
            headline:                { type: 'string', description: 'One sentence ≤120 chars.' },
            summary:                 { type: 'string', description: '2-4 sentences, ≤500 chars.' },
            prioritySignals:         { type: 'array', items: { type: 'string' }, description: '1-3 short phrases.' },
            topOpportunities:        { type: 'array', items: { type: 'string' }, description: '1-3 short phrases.' },
            visualIdentityHighlight: { type: 'string', description: 'One sentence on visual personality, or empty if unknown.' },
            recommendedNextStep:     { type: 'string', description: 'One sentence, actionable.' },
          },
        },
      },
    },
  };
}

// ── Response extraction ──────────────────────────────────────────────────────

function extractToolInput(response) {
  if (!Array.isArray(response.content)) return null;
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === 'write_dashboard_cards') {
      return block.input || null;
    }
  }
  return null;
}

function extractUsage(response) {
  const usage = response.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  // Haiku 4.5 pricing: $1.00/MTok input, $5.00/MTok output
  const estimatedCostUsd = (inputTokens * 0.000001) + (outputTokens * 0.000005);
  return {
    model: SCRIBE_MODEL,
    inputTokens,
    outputTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

async function runScribe({ analyzerResults, analyzerOutputs = {}, userContext = null, websiteUrl = '', onProgress = null } = {}) {
  const digest = buildCardDigest(analyzerResults, analyzerOutputs);

  if (digest.length === 0) {
    return {
      ok: false,
      cards: null,
      brief: null,
      runCostData: null,
      error: 'No ok cards to write — analyzerResults empty or all cards skipped.',
    };
  }

  if (onProgress) { try { await onProgress(); } catch { /* non-fatal */ } }

  const tool = buildScribeTool(digest);
  const prompt = buildScribePrompt({ digest, userContext, websiteUrl });

  let response;
  try {
    response = await callAnthropic({
      model: SCRIBE_MODEL,
      max_tokens: MAX_TOKENS,
      tools: [tool],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    return { ok: false, cards: null, brief: null, runCostData: null, error: err.message };
  }

  const runCostData = extractUsage(response);
  const toolInput = extractToolInput(response);

  if (!toolInput || !toolInput.cards || !toolInput.brief) {
    return {
      ok: false,
      cards: null,
      brief: null,
      runCostData,
      error: 'Scribe did not return a valid tool response.',
    };
  }

  return {
    ok: true,
    cards: toolInput.cards,
    brief: toolInput.brief,
    runCostData,
    error: null,
  };
}

module.exports = {
  runScribe,
  buildCardDigest,
  buildScribePrompt,
  buildScribeTool,
};
