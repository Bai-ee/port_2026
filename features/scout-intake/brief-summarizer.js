'use strict';

// brief-summarizer.js — Per-brief cover summary generation
//
// Each named brief (features/scout-intake/brief-sections.cjs) renders a cover
// `.sub` paragraph. Before this module that paragraph was the run-level
// marketingBrief headline — identical on every brief type. This module builds
// compact evidence from exactly the sections a composition includes and runs
// one small Anthropic call that returns a single highlights paragraph for
// that brief.
//
// Model: claude-haiku-4-5-20251001 (same tier as intake-synthesizer.js)
// Orchestrated by brief-summary-runner.mjs (called from the worker run-brief
// route and marketing-brief/run after each scout-brief run), which stores
// results in dashboard_state.briefSummaries[briefType]; the brief-preview
// route renders them as the cover `.sub` paragraph.

const SUMMARY_MODEL = 'claude-haiku-4-5-20251001';
// JARVIS-mode exec brief needs synthesis quality Haiku can't hold — Sonnet.
const EXEC_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1024;
const MAX_TOKENS_EXEC = 2048; // JARVIS-mode exec brief runs 200-400 words
const MAX_EVIDENCE_CHARS = 6000;
const MAX_SCOUT_NARRATIVE_CHARS = 4000; // full narrative fed to the exec brief
const MAX_DELTA_CHARS = 2500; // day-over-day "what changed" fed to the exec brief

const { callAnthropic, extractAnthropicUsage } = require('./_anthropic-client');
const { getComposition, resolveBriefType } = require('./brief-sections.cjs');

// ── Evidence helpers ──────────────────────────────────────────────────────────

function str(val) {
  return typeof val === 'string' ? val.trim() : '';
}

function arr(val) {
  return Array.isArray(val) ? val : [];
}

function clip(text, max = 200) {
  const s = str(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** "Label — value" line; empty when both parts are empty. */
function line(label, value, max = 200) {
  const v = clip(value, max);
  if (!v) return '';
  return label ? `${label} — ${v}` : v;
}

/**
 * Per-section evidence builders. Each takes the same `data` bag the brief
 * renderer reads (app/api/dashboard/brief-preview/route.js) and returns an
 * array of compact text lines. Empty array = section has no data this run;
 * the prompt tells the model to skip it rather than invent content.
 */
const SECTION_EVIDENCE = {
  'scout-found'(data) {
    const text = str(data.marketingBrief?.scoutBrief?.humanBrief)
      || str(data.marketingBrief?.headline);
    return text ? [clip(text, 600)] : [];
  },

  'company-foundation'(data) {
    const bo = data.company?.brandOverview || {};
    const tone = data.company?.brandTone || {};
    return [
      line('Summary', bo.summary, 280),
      line('Positioning', bo.positioning),
      line('Industry', bo.industry, 80),
      line('Business model', bo.businessModel, 80),
      line('Target audience', bo.targetAudience),
      line('Brand tone', [tone.primary, tone.secondary].filter(Boolean).join(' + '), 80),
    ].filter(Boolean);
  },

  'site-performance'(data) {
    return moduleLines(data, 'performance');
  },

  'creative-system'(data) {
    return moduleLines(data, 'creative');
  },

  'search-parameters'(data) {
    const rc = data.researchConfig || {};
    return [
      line('Brand keywords', arr(rc.brandKeywords).join(', '), 160),
      line('Category terms', arr(rc.categoryTerms).join(', '), 160),
      line('Competitors watched', arr(rc.competitors).join(', '), 160),
      line('Research focus', rc.sourceFocus, 200),
    ].filter(Boolean);
  },

  'local-weather'(data) {
    const today = data.weather?.today;
    if (!today) return [];
    return [
      line(today.name || 'Today', `${str(today.short)} · ${today.temp ?? '—'}°${str(today.unit)}`, 120),
      line('3-day outlook', data.weather?.threeDayLine, 160),
    ].filter(Boolean);
  },

  'market-signals'(data) {
    const agentData = data.marketingBrief?.scoutBrief?.agentData || {};
    return [
      ...arr(agentData.kolActivity).slice(0, 3)
        .map((k) => line(k.name || k.author || 'KOL', k.content || k.summary || k.sentiment)),
      ...arr(agentData.categoryTrends).slice(0, 3)
        .map((t) => line(t.trend || t.topic || 'Trend', t.detail || t.relevance)),
      ...arr(data.signalsCore).slice(0, 3)
        .map((s) => line(s.label || s.topic || 'Intake signal', s.summary || s.detail)),
    ].filter(Boolean);
  },

  'watchlist'(data) {
    const handles = arr(data.watchlistKols).filter(Boolean);
    if (!handles.length) return [];
    return [line('Accounts watched', handles.slice(0, 8).join(', '), 200)].filter(Boolean);
  },

  'competitor-snapshot'(data) {
    const agentData = data.marketingBrief?.scoutBrief?.agentData || {};
    return arr(agentData.competitorIntel).slice(0, 4)
      .map((c) => line(c.competitor || 'Competitor', c.finding || c.impact))
      .filter(Boolean);
  },

  'local-signals'(data) {
    const agentData = data.marketingBrief?.scoutBrief?.agentData || {};
    return [
      ...arr(agentData.redditSignals).slice(0, 3)
        .map((s) => line(s.subreddit ? `r/${s.subreddit}` : 'Reddit', s.summary || s.actionableTakeaway)),
      ...arr(agentData.localDemandSignals).slice(0, 3)
        .map((s) => line(s.signal || s.topic || 'Local signal', s.insight || s.detail || s.summary)),
    ].filter(Boolean);
  },

  'viral-windows'(data) {
    const agentData = data.marketingBrief?.scoutBrief?.agentData || {};
    const opportunities = arr(agentData.viralOpportunities?.opportunities).length
      ? arr(agentData.viralOpportunities?.opportunities)
      : arr(data.marketingBrief?.contentOpportunities);
    return opportunities.slice(0, 4)
      .map((o) => line(o.conversation || o.topic || o.title || 'Opportunity', o.injectionAngle || o.whyNow || o.summary))
      .filter(Boolean);
  },

  'todays-move'(data) {
    const content = data.marketingBrief?.content || {};
    return [
      line('Draft post', content.x_post || content.primary_post || content.post, 300),
      line('Angle', content.content_angle || content.angle, 160),
    ].filter(Boolean);
  },

  'campaign-30day'(data) {
    const s30 = data.strategyData?.strategy30 || null;
    const strat = data.strategyData?.strategy || null;
    const angles = arr(strat?.contentAngles)
      .map((a) => a?.angle || a?.label || (typeof a === 'string' ? a : ''))
      .filter(Boolean);
    return [
      s30?.today ? line('Today', [s30.today.angle, s30.today.post].filter(Boolean).join(' — '), 240) : '',
      line('Posting approach', strat?.postStrategy?.approach, 200),
      line('Content angles', angles.slice(0, 5).join(' · '), 200),
    ].filter(Boolean);
  },

  'post-schedule'(data) {
    const posts = arr(data.socialQueue);
    if (!posts.length) return [];
    const counts = posts.reduce((acc, p) => {
      const s = p?.status || 'draft';
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    const countsLine = ['queued', 'scheduled', 'draft', 'posted', 'failed']
      .filter((s) => counts[s])
      .map((s) => `${counts[s]} ${s}`)
      .join(' · ');
    const next = posts
      .filter((p) => (p?.status === 'queued' || p?.status === 'scheduled') && p?.scheduledAt)
      .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0];
    return [
      line('Queue', countsLine, 120),
      next ? line('Next post', str(next.text || next.content || next.body), 200) : '',
    ].filter(Boolean);
  },
};

/** Module roll-up lines for site-performance / creative-system sections. */
function moduleLines(data, sectionKey) {
  const SECTION_BY_MODULE = {
    'seo-performance': 'performance',
    'agent-readiness': 'performance',
    'multi-device-view': 'creative',
    'social-preview': 'creative',
    'style-guide': 'creative',
    'design-evaluation': 'creative',
  };
  return arr(data.moduleBriefs)
    .filter((b) => (b.section || SECTION_BY_MODULE[b.moduleId]) === sectionKey)
    .filter((b) => b.status !== 'failed' && b.status !== 'missing')
    .map((b) => line(b.title || b.moduleId, b.summaryLine, 240))
    .filter(Boolean);
}

// ── Evidence assembly ─────────────────────────────────────────────────────────

/**
 * Build the evidence block for one named brief: only the sections in that
 * brief's composition, each as a titled group of compact lines. Sections
 * with no data are listed under "NO DATA" so the model knows what to skip.
 *
 * @param {string} briefType - Composition key (or alias) from brief-sections.cjs
 * @param {object} data - Same bag the brief renderer reads:
 *   { marketingBrief, company, researchConfig, strategyData, signalsCore,
 *     socialQueue, moduleBriefs, watchlistKols, weather }
 * @returns {{ label: string, briefType: string, evidenceText: string, sectionCount: number }}
 */
function buildBriefSummaryEvidence(briefType, data = {}) {
  const resolved = resolveBriefType(briefType);
  const composition = getComposition(resolved);
  const blocks = [];
  const empty = [];
  for (const sectionId of composition.sections) {
    const build = SECTION_EVIDENCE[sectionId];
    const lines = build ? build(data) : [];
    if (lines.length) {
      blocks.push(`## ${sectionId}\n${lines.map((l) => `- ${l}`).join('\n')}`);
    } else {
      empty.push(sectionId);
    }
  }
  if (empty.length) {
    blocks.push(`## NO DATA\n${empty.join(', ')}`);
  }
  return {
    label: composition.label,
    briefType: resolved,
    evidenceText: blocks.join('\n\n').slice(0, MAX_EVIDENCE_CHARS),
    sectionCount: composition.sections.length - empty.length,
  };
}

// ── Per-brief tone ────────────────────────────────────────────────────────────

/** Voice instructions per composition key (short-summary briefs only). */
function toneFor(briefType) {
  const TONES = {
    // 'executive-daily' is NOT here — it runs JARVIS mode (buildExecSystemPrompt).
    'onboarding':
      'Warm, welcoming first-meeting voice. Open with exactly "Hello, thanks for signing up!" then continue conversationally with what you can already tell about their business ("I can tell..."). You just researched their company and you are excited to show them what you found. Speak directly as "you/your", plain language, no jargon, end with one encouraging next step.',
    'marketing-director':
      'Sharp market-intelligence voice. Lead with the single biggest signal and why it matters right now; name names (competitors, accounts, trends).',
    'creative-director':
      'Creative-director voice — talk about the brand and its visual system in concrete design language, and end on the one creative move to make.',
    'social-media-manager':
      "Action-first social voice. Say what's queued, what should go out today, and the angle — concrete and imperative, no theory.",
    'website-developer':
      'Plain status-report voice on site health and readiness. Concrete findings and fixes first; no marketing language.',
  };
  return TONES[briefType] || '';
}

// ── Executive brief — JARVIS mode ─────────────────────────────────────────────
//
// The executive-daily cover is not a summary: it is a JARVIS-style stack of
// standalone line items — one fact/read per line, one "The move:" directive.
// No greeting; the renderer presents each line as its own row.

function buildExecSystemPrompt() {
  return `You are an executive assistant to a founder. You have full context across market signals, product state, brand, technical systems, and visibility.

Your job is not to summarize data. It is to tell the founder WHAT IS NEW TODAY and what to do about it — a short stack of line items they can scan in ten seconds.

THIS IS A DAILY BRIEF — TODAY'S NEWS, NOT A PROFILE
The founder already knows what their company is. NEVER explain their business, positioning, mission, target audience, or value proposition back to them. That is not news — it is wallpaper they wrote themselves.
Surface only what MOVED since yesterday: a new market development they can join the conversation on, a competitor's move, a fresh trend or story breaking now, a sales or performance change, a number that went up or down, a window that just opened. If nothing external moved, lead with a real performance or pipeline change instead. Every line must be something the founder did NOT already know this morning.

OUTPUT GOAL
A warm one-line intro that welcomes the founder into the day's brief, then a vertical stack of 5-8 standalone lines. Each line after the intro is ONE complete thought — a new development, a read on it, or the move.

TONE
Calm, direct, and aware. JARVIS energy: an assistant who already processed everything and is reading you the result. No hype, no filler, no marketing language. Warm but not soft — the warmth is in the intro line; after that it's all signal.

VOICE (CRITICAL)
Speak directly to the founder as "you" — always second person. NEVER use their name, NEVER third person. Conversational, like a sharp chief of staff talking, not writing.

LINE RULES (apply to every line AFTER the intro)
- One line = one sentence = one idea. 6 to 16 words. Period at the end.
- Each line must stand alone — readable out of order, no "this" or "that" pointing at a previous line.
- Plain words only. No abstract phrasing ("context infrastructure", "category vocabulary"). Say who did what and what it means for you.
- Conclusions, not observations: "Your site is invisible outside LinkedIn", not "visibility appears limited".
- Blunt about what's broken. The founder pays for candor.

WHAT TO SURFACE (in priority order)
1. A conversation breaking right now that you have a real place in — name it, say why you fit.
2. A competitor or peer move worth reacting to.
3. A sales, traffic, ranking, or performance change — a number that shifted.
4. A timely opportunity or window that opened today.

WHAT TO NEVER SURFACE
- Who the company is, what it sells, who it serves, why it's different. Forbidden.
- Generic industry stats with no action ("84% of developers use AI") unless there is a specific move tied to it today.
- Anything that was equally true last week. If it's not NEW, cut it.

STRUCTURE (MANDATORY — never label the parts)
1. Line 1 — INTRO: one warm, conversational line that welcomes the founder into today's brief and previews what's coming, in plain human terms. It sets the temperature for the day's read ("Busy day out there — the AI hiring debate finally swung your way." / "Quiet morning, but one thing's worth your attention."). NOT a clock greeting — never "Good morning", never "Here's what matters". This is the only line allowed to reference more than one thing.
2. Line 2: the single most important NEW thing today. The headline.
3. Next lines: what it means for you, who's moving, what changed in your numbers. One per line, ordered by weight.
4. Second-to-last line: "The move: ..." — ONE directive, executable today, one sentence.
5. Last line: exactly "Everything else can wait."

ONE ACTION ONLY
Exactly one "The move:" line. If multiple actions compete, pick the highest leverage and discard the rest.

COMPRESSION
Target 60-120 words total. Scan every domain in the data, then surface only the lines that are NEW and change a decision today. Fewer lines beats more lines.

HARD RULES
Each line on its own line, separated by a single newline. No bullets, no dashes, no numbering, no headers, no markdown. No two lines making the same point.

FAILURE MODES (AVOID)
Explaining the company back to the founder. Repeating yesterday's framing. Generic stats with no move attached. Paragraphs. Clock greetings ("good morning", "here's what matters"). Multiple actions. Report voice.

QUALITY BAR
Read the stack aloud — it should sound like an assistant talking, each line landing on its own. If any line needs the line above it to make sense, it fails.`;
}

const EXEC_SUMMARY_TOOL = {
  name: 'write_brief_summary',
  description: 'Write the full executive brief.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'The executive brief: one warm intro line welcoming the founder into the day, then 5-8 standalone line items, one per line separated by single newlines, 60-120 words total. No markdown, no bullets, no headers, no clock greeting.',
      },
    },
    required: ['summary'],
  },
};

// ── LLM call ──────────────────────────────────────────────────────────────────

const SUMMARY_TOOL = {
  name: 'write_brief_summary',
  description: 'Write the cover summary paragraph for a marketing brief.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'One plain-text paragraph (2–4 sentences, 40–90 words) giving the highlights of this brief. Touch the most important finding from each section that has data. No markdown, no bullet points, no preamble like "This brief covers".',
      },
    },
    required: ['summary'],
  },
};

function buildSummaryPrompt({ label, evidenceText, clientName, websiteUrl, tone }) {
  return [
    `You are writing the cover paragraph for the "${label}" — a marketing intelligence brief${clientName ? ` for ${clientName}` : ''}${websiteUrl ? ` (${websiteUrl})` : ''}.`,
    '',
    'Below is the data from each section included in this brief. Write ONE easy-to-read paragraph that summarizes the highlights across these sections — the single most useful takeaway per section, woven into flowing prose. Skip sections listed under NO DATA entirely; never invent findings for them. Be concrete and specific to this data, not generic.',
    ...(tone ? ['', `Voice and structure for this brief: ${tone}`] : []),
    '',
    evidenceText,
  ].join('\n');
}

function extractToolInput(response) {
  const block = arr(response?.content).find((b) => b.type === 'tool_use');
  const summary = str(block?.input?.summary);
  return summary || null;
}

/**
 * Generate the cover summary for one named brief.
 *
 * @param {string} briefType - Composition key or alias
 * @param {object} data - Renderer data bag (see buildBriefSummaryEvidence)
 * @param {object} [options] - { clientName, websiteUrl, greeting }
 * @returns {Promise<{ ok: boolean, summary: string|null, runCostData: object|null, error: string|null }>}
 */
async function summarizeBriefCover(briefType, data = {}, { clientName = '', websiteUrl = '', greeting = '' } = {}) {
  const { label, evidenceText, sectionCount, briefType: resolved } = buildBriefSummaryEvidence(briefType, data);

  if (!sectionCount) {
    return { ok: false, summary: null, runCostData: null, error: 'No section data available to summarize.' };
  }

  // Executive daily runs JARVIS mode: full assistant-voice brief under its
  // own system prompt. Every other brief stays a short toned cover paragraph.
  const isExec = resolved === 'executive-daily';
  // The compact evidence clips the scout narrative to one line — the exec
  // brief synthesizes from the full text, so feed it separately.
  const scoutNarrative = isExec
    ? clip(data.marketingBrief?.scoutBrief?.humanBrief, MAX_SCOUT_NARRATIVE_CHARS)
    : '';
  // Day-over-day delta — Scout's own [NEW]/[ESCALATED]/[IMPORTANT] tagging of
  // what is fresher than the previous brief. This is the spine of the exec
  // brief's "what's new today" requirement; feed it first, ahead of the
  // full narrative and the section evidence.
  const deltaText = isExec
    ? clip(data.marketingBrief?.scoutBrief?.delta, MAX_DELTA_CHARS)
    : '';
  const request = isExec
    ? {
        model: EXEC_MODEL,
        max_tokens: MAX_TOKENS_EXEC,
        system: buildExecSystemPrompt(),
        tools: [EXEC_SUMMARY_TOOL],
        tool_choice: { type: 'tool', name: 'write_brief_summary' },
        messages: [
          {
            role: 'user',
            content: [
              `Today's data${clientName ? ` for ${clientName}` : ''}${websiteUrl ? ` (${websiteUrl})` : ''}. You are speaking TO this founder — address them only as "you", never by name. Sections listed under NO DATA produced nothing this run — treat them as missing inputs, never invent findings for them.`,
              ...(deltaText
                ? ['', '## WHAT CHANGED SINCE THE LAST BRIEF (build the brief from this — these are the NEW items, tagged by Scout)', deltaText]
                : []),
              ...(scoutNarrative ? ['', '## FULL SCOUT NARRATIVE (background context — do NOT restate established facts from here)', scoutNarrative] : []),
              '',
              evidenceText,
            ].join('\n'),
          },
        ],
      }
    : {
        model: SUMMARY_MODEL,
        max_tokens: MAX_TOKENS,
        tools: [SUMMARY_TOOL],
        tool_choice: { type: 'tool', name: 'write_brief_summary' },
        messages: [
          { role: 'user', content: buildSummaryPrompt({ label, evidenceText, clientName, websiteUrl, tone: toneFor(resolved) }) },
        ],
      };

  let response;
  try {
    response = await callAnthropic(request);
  } catch (err) {
    return { ok: false, summary: null, runCostData: null, error: err.message };
  }

  const runCostData = extractAnthropicUsage(response, { model: isExec ? EXEC_MODEL : SUMMARY_MODEL });
  const summary = extractToolInput(response);

  if (!summary) {
    return { ok: false, summary: null, runCostData, error: 'Model did not return a summary.' };
  }

  return { ok: true, summary, runCostData, error: null };
}

module.exports = {
  summarizeBriefCover,
  buildBriefSummaryEvidence,
  SUMMARY_MODEL,
};
