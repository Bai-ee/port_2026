/**
 * Prompt builder for Strategy Builder.
 * Compresses StrategyContext into a single user message for the Anthropic API.
 */

/** Cap a string at max chars. */
function cap(str, max = 400) {
  const s = String(str || '');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Compact JSON — no pretty print. */
function jc(val) {
  try {
    return JSON.stringify(val);
  } catch {
    return '{}';
  }
}

/**
 * Build a compressed summary of card findings.
 * @param {Record<string, { highlights: string[], gaps: string[], readiness: string }>} cardFindings
 * @returns {string}
 */
function compressFindings(cardFindings) {
  if (!cardFindings || typeof cardFindings !== 'object') return 'none';
  return Object.entries(cardFindings)
    .slice(0, 6)
    .map(([cardId, f]) => {
      const hl = (f?.highlights || []).slice(0, 2).map((h) => cap(h, 100)).join('; ');
      const gaps = (f?.gaps || []).slice(0, 2).map((g) => cap(g, 100)).join('; ');
      return `[${cardId}] readiness=${f?.readiness || '?'} · ${hl || 'no highlights'} · gaps: ${gaps || 'none'}`;
    })
    .join('\n');
}

/**
 * Build the full prompt messages array for Anthropic.
 * @param {import('./schemas.js').StrategyContext} ctx
 * @returns {Array<{ role: string, content: string }>}
 */
/** Compress an array of strings/objects into a short single line. */
function line(arr, n, fn) {
  if (!Array.isArray(arr) || !arr.length) return '';
  return arr.slice(0, n).map(fn).filter(Boolean).join(' | ');
}

/** Best-effort label from a string or object. */
function lbl(x, max = 80) {
  if (!x) return '';
  if (typeof x === 'string') return cap(x, max);
  return cap(x.title || x.name || x.headline || x.summary || jc(x), max);
}

/**
 * KOL-activity items are { name, platform, content, followers, sentiment, url }.
 * The generic lbl() collapses them to just `name`, dropping the actual post —
 * so the strategist never sees what the KOL said. Keep the substance.
 */
function kolLine(x, max = 260) {
  if (!x) return '';
  if (typeof x === 'string') return cap(x, max);
  const who = String(x.name || x.handle || '').trim();
  const said = String(x.content || x.quote || x.text || x.summary || '').trim();
  const meta = [x.platform, x.sentiment].filter(Boolean).join('/');
  const head = [who, meta ? `(${meta})` : ''].filter(Boolean).join(' ');
  const body = said ? `${head ? head + ': ' : ''}${cap(said, max)}` : (head || jc(x));
  return x.url ? `${body} [${x.url}]` : body;
}

/**
 * Compact prompt for today's strategy — driven entirely by Marketing Brief signals.
 * Output schema: { date, strategy_intent, signals_used, posts[] }
 * @param {import('./schemas.js').StrategyContext} ctx
 * @returns {Array<{ role: string, content: string }>}
 */
export function buildTodayPrompt(ctx) {
  const { client, brand, campaign, intelligence, knowledgeBase, clientBrain, now, editorialRecommendationText } = ctx;
  const today = (now || new Date().toISOString()).slice(0, 10);
  const c = campaign || {};

  const intelLines = [];
  if (intelligence?.humanBrief) intelLines.push(`FOUNDER BRIEF: ${cap(intelligence.humanBrief, 600)}`);
  if ((intelligence?.viralOpportunities || []).length)
    intelLines.push(`VIRAL WINDOWS: ${line(intelligence.viralOpportunities, 5, (t) => lbl(t, 120))}`);
  if ((intelligence?.kolActivity || []).length)
    intelLines.push(`KOL ACTIVITY:\n${intelligence.kolActivity.slice(0, 6).map((t) => `- ${kolLine(t)}`).join('\n')}`);
  if ((intelligence?.brandMentions || []).length)
    intelLines.push(`BRAND MENTIONS: ${line(intelligence.brandMentions, 4, (t) => lbl(t, 120))}`);
  if ((intelligence?.competitorIntel || []).length)
    intelLines.push(`COMPETITOR MOVES: ${line(intelligence.competitorIntel, 3, (t) => lbl(t, 100))}`);
  if ((intelligence?.categoryTrends || []).length)
    intelLines.push(`CATEGORY TRENDS: ${line(intelligence.categoryTrends, 4, (t) => lbl(t, 100))}`);

  const knowledgeBaseBlock = knowledgeBase?.block
    ? `CLIENT KNOWLEDGE BASE — MASTER SOURCE OF TRUTH\n${cap(knowledgeBase.block, 2800)}`
    : '';
  const clientBrainBlock = clientBrain?.context
    ? `CLIENT BRAIN CONTEXT\n${cap(clientBrain.context, 1800)}`
    : '';

  const xGrowth = ctx.xGrowth || null;
  const xGrowthBlock = xGrowth
    ? `X GROWTH OBJECTIVE (algorithm-profile: ${xGrowth.algorithmProfileVersion || 'unknown'})
- Objective: ${xGrowth.objective}
- Reason: ${xGrowth.reason}
- Preferred post types: ${(xGrowth.postTypeMix || []).join(', ')}
- Post every item for X first. Default platform_hint = "x".
- Every post must include xStrategy with: postType (one of: authority, reply-loop, proof-loop, kol-adjacent, case-study, offer, asset, conversation-starter), targetAction, hypothesis.
- Avoid engagement bait. Avoid injecting generic hashtags. External links only when objective is leads-or-calls.`
    : '';

  const todaySchema = `{
  "date": "${today}",
  "strategy_intent": "one sentence — what is today's focus and why, tied to a specific brief signal",
  "signals_used": ["signal label 1", "signal label 2"],
  "posts": [
    {
      "id": "today-1",
      "content": "post text <=280 chars",
      "platform_hint": "x",
      "signal_used": "which brief signal drove this post",
      "mediaHint": "optional visual direction",
      "rationale": "one sentence",
      "xStrategy": {
        "postType": "authority|reply-loop|proof-loop|kol-adjacent|case-study|offer|asset|conversation-starter",
        "targetAction": "reply|repost|profile_click|follow_author|click|dwell",
        "hypothesis": "one sentence on why this post type fits the objective"
      }
    }
  ]
}`;

  const content = `You are a senior social strategist. Today is ${today}.

Generate today's strategy for ${cap(client?.name)} (${cap(client?.vertical)}) using ONLY the signals below from the Marketing Brief.
Every post must trace directly to a specific signal — no invented angles, no generic content.
X is the default platform. Every post targets X/Twitter first unless a signal is clearly better suited elsewhere.

MARKETING BRIEF SIGNALS
${intelLines.join('\n') || 'none'}

${knowledgeBaseBlock || 'CLIENT KNOWLEDGE BASE: none'}

${clientBrainBlock || 'CLIENT BRAIN CONTEXT: none'}

EDITORIAL STRATEGY RECOMMENDATION
${editorialRecommendationText || 'none'}

${xGrowthBlock || ''}

BRAND
- Voice: ${cap(brand?.voice)}
- Tone: ${cap(brand?.tone)}
- Emoji policy: ${c.emojiPolicy || 'none'}
- Max hashtags: ${Number.isFinite(c.maxHashtags) ? c.maxHashtags : 2}
${c.guardrails ? `- HARD GUARDRAILS: ${cap(c.guardrails, 300)}` : ''}
${c.ctaText ? `- Primary CTA: "${cap(c.ctaText, 80)}"${c.ctaUrl ? ` → ${cap(c.ctaUrl, 200)}` : ''}` : ''}

RULES
1. Return ONLY the JSON below. No markdown, no prose.
2. 1–3 posts. Prioritise viral windows and KOL hooks, but keep factual claims aligned to the Knowledge Base when present.
3. Each post content <=280 chars.
4. signal_used must name the exact signal (e.g. "KOL: @handle", "Viral: conversation title").
5. strategy_intent ties the day's theme to one dominant brief signal.
6. Every post must have xStrategy with postType, targetAction, and hypothesis.
7. No generic hashtags (#AI, #Tech, etc.) unless they appear in the Knowledge Base or brief context.
8. If EDITORIAL STRATEGY RECOMMENDATION is mode=recommendation, prefer that campaign/asset unless it would violate a hard fact, guardrail, or platform rule. If mode=fallback, use the strongest signal-driven scheduled/default idea.

TODAY SCHEMA:
${todaySchema}`;

  return [{ role: 'user', content }];
}

export function buildPrompt(ctx, todayStrategy = null) {
  const { client, brand, brief, intelligence, media, seo, knowledgeBase, clientBrain, cardFindings, campaign, signals, config, now, xGrowth, editorialRecommendationText } = ctx;

  const loc = client?.location || {};
  const clientBlock = [
    `- Name: ${cap(client?.name)}`,
    `- Vertical: ${cap(client?.vertical)}`,
    `- Location: ${cap(loc.city)}, ${cap(loc.country)} (tz ${cap(loc.tz)})`,
    `- Hours: ${cap(client?.hours)}`,
    `- Closed days: ${jc(client?.closedDays || [])}`,
    `- Offers: ${(client?.offers || []).slice(0, 5).map((o) => cap(o, 80)).join(', ') || 'none'}`,
  ].join('\n');

  const brandBlock = [
    `- Voice: ${cap(brand?.voice)}`,
    `- Tone: ${cap(brand?.tone)}`,
    `- Style notes: ${cap(brand?.styleGuide?.summary)}`,
  ].join('\n');

  const briefBlock = [
    `- Positioning: ${cap(brief?.positioning)}`,
    `- Audience: ${cap(brief?.audience)}`,
    `- Objectives: ${cap(brief?.objectives)}`,
  ].join('\n');

  const findingsSummary = compressFindings(cardFindings);

  // Generated pipeline intelligence (Marketing Brief / Scout agentData).
  const intelBlock = intelligence
    ? [
        intelligence.humanBrief ? `Founder brief: ${cap(intelligence.humanBrief, 500)}` : '',
        line(intelligence.categoryTrends, 5, (t) => lbl(t)) &&
          `Trends: ${line(intelligence.categoryTrends, 5, (t) => lbl(t))}`,
        line(intelligence.viralOpportunities, 4, (t) => lbl(t)) &&
          `Viral angles: ${line(intelligence.viralOpportunities, 4, (t) => lbl(t))}`,
        line(intelligence.competitorIntel, 4, (t) => lbl(t)) &&
          `Competitors: ${line(intelligence.competitorIntel, 4, (t) => lbl(t))}`,
        (intelligence.kolActivity || []).length &&
          `KOLs:\n${intelligence.kolActivity.slice(0, 5).map((t) => `- ${kolLine(t)}`).join('\n')}`,
        line(intelligence.contentOpportunities, 5, (t) => lbl(t)) &&
          `Content ops: ${line(intelligence.contentOpportunities, 5, (t) => lbl(t))}`,
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const mediaBlock = media?.dnaPromptBlock ? cap(media.dnaPromptBlock, 600) : '';

  const seoBlock = seo
    ? [
        seo.summary ? cap(seo.summary, 200) : '',
        line(seo.topics, 6, (t) => lbl(t, 50)) && `Topics: ${line(seo.topics, 6, (t) => lbl(t, 50))}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  const knowledgeBaseBlock = knowledgeBase?.block
    ? cap(knowledgeBase.block, 3400)
    : '';
  const clientBrainBlock = clientBrain?.context ? cap(clientBrain.context, 2200) : '';

  // Signals — compact serialization
  const holidayItems = signals?.holidays?.enabled && signals?.holidays?.items?.length
    ? signals.holidays.items.map((h) => ({
        id: h.id,
        name: cap(h.name, 60),
        date: h.resolvedDate || h.date,
        leadDays: h.leadDays,
        ramp: h.ramp,
        theme: h.theme,
      }))
    : [];

  const horizonAnchor =
    signals?.holidays?.enabled && signals?.holidays?.upcoming
      ? {
          id: signals.holidays.upcoming.id,
          name: cap(signals.holidays.upcoming.name, 60),
          date: signals.holidays.upcoming.resolvedDate,
          leadDays: signals.holidays.upcoming.leadDays,
          ramp: signals.holidays.upcoming.ramp,
          theme: signals.holidays.upcoming.theme,
        }
      : null;

  const eventItems = signals?.events?.enabled && signals?.events?.items?.length
    ? signals.events.items.slice(0, 10).map((e) => ({
        id: e.id,
        name: cap(e.name, 60),
        date: e.date,
      }))
    : [];

  const weatherForecast = signals?.weather?.enabled && signals?.weather?.forecast?.length
    ? signals.weather.forecast.slice(0, 7).map((d) => ({
        date: d.date,
        description: d.description,
        tempMax: d.tempMax,
        tempMin: d.tempMin,
      }))
    : [];

  const c = campaign || {};
  const promoItems = Array.isArray(c.promotions) && c.promotions.length
    ? c.promotions.map((p) => ({ label: cap(p.label, 80), endDate: p.endDate }))
    : [];
  const OBJECTIVE_HINT = {
    awareness: 'maximize reach and brand familiarity',
    bookings: 'drive reservations/appointments',
    'foot-traffic': 'drive in-person visits',
    leads: 'capture signups/leads',
    promotions: 'drive redemption of active offers',
    community: 'deepen loyalty and engagement',
  };
  const campaignBlock = [
    c.objective ? `- Objective: ${c.objective} (${OBJECTIVE_HINT[c.objective] || ''})` : '',
    c.ctaText ? `- Primary CTA: "${cap(c.ctaText, 80)}"${c.ctaUrl ? ` → ${cap(c.ctaUrl, 200)}` : ''}` : '',
    (c.postTime || c.postTime2)
      ? `- Posting window (client local time ${cap(client?.location?.tz, 40) || 'local'}): ${[c.postTime, c.postTime2].filter(Boolean).join(' and ')}`
      : '',
    `- Emoji policy: ${c.emojiPolicy || 'none'}`,
    `- Max hashtags per post: ${Number.isFinite(c.maxHashtags) ? c.maxHashtags : 2}`,
    c.guardrails ? `- HARD GUARDRAILS (never violate): ${cap(c.guardrails, 500)}` : '',
    promoItems.length ? `- Active promotions (time-bound): ${jc(promoItems)}` : '',
  ].filter(Boolean).join('\n');

  const xGrowthBlock = xGrowth
    ? `X GROWTH OBJECTIVE (algorithm-profile: ${xGrowth.algorithmProfileVersion || 'unknown'})
- Objective: ${xGrowth.objective}
- Reason: ${xGrowth.reason}
- Preferred post types: ${(xGrowth.postTypeMix || []).join(', ')}
- X is the default and primary platform. Set platform_hint="x" on all items unless a specific signal demands otherwise.
- Favor post types: authority, reply-loop, proof-loop, kol-adjacent, case-study, offer, asset, conversation-starter.
- Avoid generic engagement bait ("like this", "rt if"). No injected generic hashtags.
- External links only when objective is leads-or-calls. Otherwise prefer link in first reply or profile link.
- Every item must include xStrategy: postType, targetAction, hypothesis.`
    : '';

  const postPlanSchema = `{
  "campaignId": "string",
  "generatedAt": "ISO string",
  "anchors": [{ "id": "string", "name": "string", "date": "ISO", "vertical": "string", "leadDays": number, "ramp": "soft|hard" }],
  "items": [{ "id": "string", "scheduledAt": "ISO", "content": "string (<=280)", "hashtags": ["string"], "mediaHint": "string", "kind": "baseline|ramp|event|closure|special", "anchorId": "string|null", "rationale": "string", "confidence": number, "xStrategy": { "postType": "string", "targetAction": "string", "hypothesis": "string" } }]
}`;

  const todayBlock = todayStrategy
    ? `TODAY'S STRATEGY (already set — your week calendar must be consistent with and extend from this)
Intent: ${todayStrategy.strategy_intent || ''}
Signals used today: ${(todayStrategy.signals_used || []).join(', ') || 'none'}
Today's posts (do NOT repeat these in items[]):
${(todayStrategy.posts || []).map((p, i) => `  ${i + 1}. [${p.platform_hint || 'x'}] ${p.content}`).join('\n')}
`
    : '';

  const content = `SYSTEM
You are a senior social strategist generating a ${config?.days || 30}-day post calendar for a single client.
You must return a single JSON object matching the PostPlan schema exactly. No prose, no markdown.
X/Twitter is the primary platform. Default every item to platform_hint="x" unless the signal is clearly better elsewhere.

CLIENT
${clientBlock}

BRAND
${brandBlock}

BRIEF
${briefBlock}

INTELLIGENCE (generated pipeline findings — mine these for hooks; never fabricate)
${intelBlock || 'none'}

${xGrowthBlock ? xGrowthBlock + '\n\n' : ''}${todayBlock}MEDIA DIRECTION (use to set item.mediaHint; do not invent assets)
${mediaBlock || 'none'}

SEO CONTEXT (topic gaps worth posting about)
${seoBlock || 'none'}

CLIENT KNOWLEDGE BASE (master source for offer, claims, positioning, ICP, product facts, and brand language)
${knowledgeBaseBlock || 'none'}

CLIENT BRAIN CONTEXT (approved strategic summary; use it to steer tone, positioning, audience, and offers without inventing facts)
${clientBrainBlock || 'none'}

EDITORIAL STRATEGY LAYER (campaign-first recommendation above the schedule)
${editorialRecommendationText || 'none'}

PIPELINE SIGNALS (read-only context, do not echo)
${findingsSummary}

ANCHOR EVENTS (FACTS — use exactly these dates; do not invent new ones)
HOLIDAYS: ${jc(holidayItems)}
LOCAL EVENTS: ${jc(eventItems)}
WEATHER FORECAST: ${jc(weatherForecast)}

NEXT HORIZON ANCHOR (beyond this window — seed gentle forward teasers; never schedule its ramp here, never invent a date)
${horizonAnchor ? jc(horizonAnchor) : 'none'}

CAMPAIGN SETUP (operational constraints — obey exactly)
${campaignBlock || 'none'}

CONFIG
- Start date: ${config?.startDate || now?.slice(0, 10) || ''}
- Days: ${config?.days || 30}
- Posts per day: ${config?.postsPerDay || 1}
- Baseline mix target: ${config?.baselineMixPct || 40}%
- Ramp aggressiveness: ${config?.rampAggressiveness ?? 0.5} (0..1)
- Now: ${now || new Date().toISOString()}

RULES
1. Output ONLY JSON: { campaignId, generatedAt, anchors, items }.
2. Every item.scheduledAt must be ISO and >= now and <= startDate + days.
3. content.length must be <= 280 characters.
4. Each anchor in \`anchors\` must come from ANCHOR EVENTS above. Never invent dates.
5. For each anchor with date within the window, generate a ramp arc:
   - Soft ramp: 1 awareness post at -leadDays, 1 build post at -leadDays/2, 1 hit post on the date.
   - Hard ramp: add 2 extra teasers between leadDays and the date.
6. At least ${config?.baselineMixPct || 40}% of items must be kind='baseline'.
7. Insert kind='closure' posts for client.closedDays in the window.
8. Weather-tied posts (kind='special', anchorId omitted) allowed only when forecast shows a notable signal (storm, heat wave, snow). Max 2 per 30 days.
9. Each item.rationale: one short sentence.
10. Tone strictly follows BRAND voice. Emoji usage = CAMPAIGN emoji policy: 'none' → no emojis; 'sparing' → at most 1 where natural; 'liberal' → tasteful emojis allowed. Hashtags per post must not exceed CAMPAIGN max hashtags.
11. Draw post angles from INTELLIGENCE (trends, viral angles, content ops) when present, but never state facts not supported by the brief, signals, or Knowledge Base. Set item.mediaHint from MEDIA DIRECTION where relevant.
12. If a NEXT HORIZON ANCHOR exists, you may add up to 2 light forward-looking posts referencing it (kind='baseline', anchorId=null — it is outside this window). Never schedule its actual ramp arc inside this window.
13. CAMPAIGN guardrails are absolute hard constraints — never produce content that violates them, in any post.
14. Bias post intent and CTAs toward the CAMPAIGN objective. Weave the primary CTA (and link, if given) into a meaningful share of posts — not every post, but every ramp/event/promotion post.
15. If a posting window is set, every item.scheduledAt time-of-day must fall within it, expressed in the client's timezone. If none set, use sensible business-hours times.
16. Treat each CAMPAIGN active promotion as a time-bound push: build a short ramp toward its endDate using kind='special' with anchorId=null (promotions are not holiday anchors). Never promote a promotion after its endDate.
17. Every item must include xStrategy: { postType, targetAction, hypothesis }. postType must be one of: authority, reply-loop, proof-loop, kol-adjacent, case-study, offer, asset, conversation-starter. targetAction must be one of: reply, repost, quote, click, profile_click, video_view, photo_expand, dwell, follow_author. hypothesis is one sentence explaining the X algorithm rationale for this post type.
18. No generic hashtags (#AI, #Tech, #CreativeTech, #BuildInPublic) unless they come from the client Knowledge Base, brief, or a specific signal. Omit hashtags entirely when in doubt.
19. The EDITORIAL STRATEGY LAYER sits above individual scheduled posts. If it recommends a campaign/asset, keep that long-term positioning stable while adapting hooks, examples, platform language, and media hints to daily signals. If it says fallback, preserve the originally scheduled/default content direction.
20. Never chase a trend that does not reinforce the editorial campaign, Client Brain positioning, or campaign setup.

VALIDATION
Re-read your output. If any rule is violated, regenerate before responding.

PostPlan schema:
${postPlanSchema}`;

  return [{ role: 'user', content }];
}
