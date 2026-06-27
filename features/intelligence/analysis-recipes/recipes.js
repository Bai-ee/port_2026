'use strict';

// recipes.js — Analysis recipe registry.
//
// An "analysis recipe" is a swappable analyzer that reasons over content WE supply
// (e.g. the stored scoutBrief / Marketing Insights agentData) and returns a
// synthesis. Recipes are imported playbooks (e.g. from the marketing-skills
// library) adapted to run headlessly. They live at the Scribe/analyzer altitude —
// they do NOT fetch data and do NOT replace Scout. See SSOT §8.
//
// To add a recipe: drop a <id>.md asset in this folder (frontmatter + prompt body)
// and register it below. The same swap-slot is the A/B mechanism — point a card's
// Tier-1 analyzer at a different recipeId to compare results in production.

const fs = require('fs');
const path = require('path');

// Pinned to the same Sonnet the scout-test path uses, for consistency. Override
// per recipe when a cheaper/heavier model fits.
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_MAX_TOKENS = 4000;

// Keep recipe prompts embedded for serverless runtime. The .md files remain the
// editable source, but Vercel functions cannot be allowed to depend on runtime
// filesystem reads for these analyzer prompts.
const EMBEDDED_PROMPTS = {
  'customer-research': String.raw`# Customer Research Synthesis (headless recipe)

You are an expert customer researcher. Analyze ONLY the content supplied in the
CONTENT block. Your goal: uncover what customers actually think, feel, say, and
struggle with, grounded in the supplied evidence — never invented.

Treat the supplied content as research assets (community posts, brand mentions,
competitor intel, reviews, signals). Do not ask questions. Do not request more data.
Work with what is given; if it is thin, say so explicitly and lower your confidence.

## Extraction framework — extract from the supplied content

1. **Jobs to Be Done** — functional (the task), emotional (how they want to feel),
   social (how they want to be perceived).
2. **Pain Points** — what's frustrating/broken/inadequate. Prioritize pains stated
   unprompted and with emotional language.
3. **Trigger Events** — what changed that made them seek a solution.
4. **Desired Outcomes** — success in their words. Exact quotes, not paraphrases.
5. **Language & Vocabulary** — the exact words/phrases customers use (copy gold:
   "drowning in spreadsheets" > "manual process inefficiency").
6. **Alternatives Considered** — competitors, DIY, doing nothing, hiring.

## Synthesis steps

1. Cluster by theme across the supplied items.
2. Score each theme: frequency (how often it appears) × intensity (how strongly felt).
3. Segment by any visible customer-profile signal (role, size, use case).
4. Pull 3–8 "money quotes" — verbatim, with their source — that best represent each theme.
5. Flag contradictions (say one thing, imply another).

## Quality guardrails (REQUIRED)

Label every insight with a confidence level:

| Confidence | Criteria |
|---|---|
| **High** | Theme in 3+ independent supplied items; unprompted; consistent |
| **Medium** | 2 items, or only prompted, or one segment |
| **Low** | Single item; possible outlier; needs validation |

Sample-bias reminders to factor in: review/forum voices skew toward strong opinions
and power users; support/complaint signals skew negative; Reddit skews technical and
skeptical. Do NOT over-generalize to "all customers" from a skewed sample.

GROUNDING RULE: every named entity, quote, number, or specific claim must trace to a
specific item in the supplied CONTENT. If you cannot ground it, omit it. A thin-but-
honest synthesis is REQUIRED behavior; a richer fabricated one is a failure.

## Output — return BOTH, in this order

Output format is strict: the RAW JSON object first (NO \`\`\` code fences, no "json"
label), then one blank line, then the prose. The prose must be plain sentences —
do NOT use markdown headings (\`##\`), horizontal rules (\`---\`), or bullet lists;
sparing \`**bold**\` is allowed. Keep prose under 200 words.

First, a JSON object (no markdown fence) for machine comparison:

{
  "themes": [
    { "name": "...", "summary": "...", "frequency": <int>, "intensity": "high|medium|low",
      "confidence": "high|medium|low",
      "quotes": [ { "quote": "...", "source": "...", "url": "..." } ],
      "implication": "what this means for messaging/product/positioning" }
  ],
  "jobsToBeDone": [ { "functional": "...", "emotional": "...", "social": "..." } ],
  "vocabulary": [ "exact phrase", "..." ],
  "alternatives": [ "..." ],
  "contradictions": [ "..." ],
  "dataQuality": { "itemsAnalyzed": <int>, "overallConfidence": "high|medium|low", "gaps": [ "what we still don't know" ] }
}

Then, after the JSON, a short prose synthesis report (<200 words): the top 2–3 themes
ranked by frequency × intensity, each with one representative quote and its implication.
If the supplied content is too thin to support themes, say so plainly and recommend
what to gather next.`,

  'watchlist-analysis': String.raw`# Watchlist Brief (top-of-report scribe)

You are a marketing director briefing a founder on the accounts they track on X.
Analyze ONLY the CONTENT provided — each entry is a tracked handle with its own
recent posts and the mentions/replies about it, plus engagement counts.

Do not invent. Ground every claim in a supplied post or mention. If a handle has
no activity, say so. Engagement counts may be 0 (scraper gaps) — when so, lean on
recency and what's actually being said rather than implying virality.

## What to produce

1. **Overview** — 2–3 sentences: the throughline across the tracked handles this
   window. What are they collectively pushing? Any shared theme, launch, or shift?
2. **Spotlight** — the ONE handle with the most interactions (or most notable
   activity) in the most recent window, and why it matters now.
3. **Per-handle read** — for each handle, one tight line: what they posted +
   how they're being talked about (from mentions). Note standout engagement.
4. **Priority action** — a single concrete move the founder could make today
   (engage a thread, echo a narrative, ride a launch), grounded in the data.

## Output — return BOTH, in this order

Output the RAW JSON object first (NO \`\`\` fences, no "json" label), then one blank
line, then the prose. Prose = plain sentences, no markdown headings/rules/bullets.

{
  "overview": "2-3 sentence throughline",
  "spotlight": { "handle": "...", "why": "why this handle matters most right now" },
  "handles": [
    { "handle": "...", "posting": "what they're putting out", "talkedAbout": "how others are reacting / mentioning them", "engagement": <int> }
  ],
  "priorityAction": "one concrete move today, grounded in the data"
}

Then a 2–4 sentence prose brief restating the overview + spotlight + the priority
action in a founder-ready voice. Keep it under 120 words.`,

  'reply-targets': String.raw`# Reply Targets (engagement triage)

You are a marketing director running the founder's daily engagement triage. Your job
is NOT to write new posts — it is to surface, from the CONTENT provided, the specific
posts worth REPLYING to today, and to draft a reply for each. Replying is the focus.

The CONTENT is a reply candidate pool drawn from the client's stored market signals:
tracked-handle mentions and posts, brand mentions, Reddit discussions, and KOL activity.
Each item carries the post text, a URL, and engagement counts where available.

Ground every pick in a supplied item. Never invent a post, author, quote, or number.
If the pool is thin (few or no mentions), say so plainly and recommend enabling
**Mentions** on the Watchlist + re-pulling timelines — do not pad the list.

## Scoring — score each candidate 1–10, then rank

| Dimension | Measures | Weight |
|-----------|----------|--------|
| ICP / relevance fit | Is the author the client's target or an influencer worth a relationship? | ×2 |
| Intent signal | Are they asking, complaining, shopping, or naming a competitor? | ×2 |
| Reach potential | Engagement rising / notable account? | ×1 |
| Reply opportunity | Can the client say something genuinely useful (not "great post")? | ×2 |
| Recency | Recent enough that an early reply still lands? | ×1 |

High-value intent signals: "looking for a tool that…", "why is [category] so painful",
"switched from [competitor]", "anyone use [competitor]", a complaint about a competitor,
a direct mention/question to the brand or a tracked handle.

Drop a candidate when: author isn't ICP/influencer; post is stale and already buried;
generic motivational/AI-slop; nothing useful to add.

## Reply tiers — match the draft to the opportunity

- **Tier 1 — relationship builder** (ICP / high intent / tracked account): a specific
  insight or counter-example, 2–4 sentences, no link.
- **Tier 2 — visibility play** (high-reach, adjacent): one sharp sentence — "Agreed, and
  the part most miss is …".
- **Tier 3 — light touch**: one specific reaction quoting a real line. Never "Great post!".

## Output — return BOTH, in this order

Output the RAW JSON object first (NO \`\`\` fences, no "json" label), then one blank line,
then a short prose brief. Cap the list at the 10 strongest; omit weak ones rather than fill.

{
  "replyTargets": [
    {
      "author": "@handle or name",
      "source": "watchlist-mention | brand-mention | reddit | kol",
      "text": "the post being replied to (quoted/trimmed from CONTENT)",
      "url": "permalink from CONTENT, or empty",
      "score": <int 1-10>,
      "tier": 1,
      "why": "one line — which signals scored it (ICP/intent/etc.), grounded in the post",
      "suggestedReply": "the drafted reply, matched to the tier"
    }
  ],
  "skipped": "one line on what was deliberately left out and why (e.g. stale, off-ICP)",
  "poolNote": "if the pool was thin, say so and recommend enabling Mentions + re-pull"
}

Then a 2–4 sentence prose brief: the single highest-value reply to make today and why,
plus the throughline across the targets. Founder-ready voice, under 120 words, no markdown.`,
};

const RECIPES = {
  'customer-research': {
    id: 'customer-research',
    label: 'Customer Research Synthesis',
    description: 'Extract JTBD, pains, triggers, vocabulary, and money quotes from supplied content; confidence-scored synthesis report.',
    file: 'customer-research.md',
    prompt: EMBEDDED_PROMPTS['customer-research'],
    source: 'coreyhaines31/marketingskills · skills/customer-research (MIT)',
    model: DEFAULT_MODEL,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
  'watchlist-analysis': {
    id: 'watchlist-analysis',
    label: 'Watchlist Brief',
    description: 'Top-of-report scribe over the tracked X handles — what each posts, how each is talked about, the most-engaged spotlight, and a priority action.',
    file: 'watchlist-analysis.md',
    prompt: EMBEDDED_PROMPTS['watchlist-analysis'],
    source: 'internal — handle-first X analysis',
    model: DEFAULT_MODEL,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
  'reply-targets': {
    id: 'reply-targets',
    label: 'Reply Targets',
    description: 'Engagement triage — ranks the posts worth REPLYING to (watchlist mentions, brand mentions, Reddit, KOL activity) with a scored rationale and a drafted reply per post. Needs the Watchlist pulled with Mentions on.',
    file: 'reply-targets.md',
    prompt: EMBEDDED_PROMPTS['reply-targets'],
    source: 'coreyhaines31/marketingskills · social/listening (adapted)',
    model: DEFAULT_MODEL,
    maxTokens: DEFAULT_MAX_TOKENS,
    // Reads an assembled reply candidate pool, not raw agentData. See the
    // recipe-run route's content router.
    contentKind: 'reply-pool',
  },
};

function listRecipes() {
  return Object.values(RECIPES).map(({ id, label, description, source }) => ({ id, label, description, source }));
}

function getRecipe(id) {
  return RECIPES[id] || null;
}

// Load a recipe's prompt body (the markdown after the YAML frontmatter block).
function loadRecipePrompt(id) {
  const recipe = getRecipe(id);
  if (!recipe) throw new Error(`Unknown analysis recipe "${id}". Known: ${Object.keys(RECIPES).join(', ')}`);
  if (typeof recipe.prompt === 'string' && recipe.prompt.trim()) return recipe.prompt.trim();
  const abs = path.join(__dirname, recipe.file);
  const raw = fs.readFileSync(abs, 'utf8');
  // Strip a leading `---\n...\n---\n` frontmatter block if present.
  const stripped = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
  return stripped.trim();
}

module.exports = { RECIPES, DEFAULT_MODEL, DEFAULT_MAX_TOKENS, listRecipes, getRecipe, loadRecipePrompt };
