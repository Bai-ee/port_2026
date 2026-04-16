// robotsAiParser.js — Parses robots.txt with full path matching, scores 22 known AI bots.
//
// Path-matching rules (per Google / robots.txt spec):
//   - Path-prefix matching: Disallow: /private/ blocks /private/page but not /public/
//   - Wildcard *: Disallow: /api/* blocks /api/v1/users
//   - End anchor $: Disallow: /*.pdf$ blocks /docs/report.pdf but not /docs/pdf-guide
//   - Longest-match-wins: more specific rule takes precedence
//   - Tie (same length): Allow wins over Disallow
//   - Specific agent rules take full precedence over wildcard (*) agent rules
//
// Public API:
//   parseRobotsAi({ websiteUrl, signal })
//     → { score, botScores, accessSummary, testedPaths, raw, blockedBots, parsedAgents }

import fetch from 'node-fetch';

const UA = 'BballiAiSeoAudit/1.0 (mailto:bryanballi@gmail.com)';

// 22 known AI crawlers, ordered by weight (high-impact first)
const AI_BOTS = [
  { name: 'GPTBot',             weight: 0.20, findingId: 'ai-bots-blocked-gptbot' },
  { name: 'ClaudeBot',          weight: 0.18, findingId: 'ai-bots-blocked-claudebot' },
  { name: 'PerplexityBot',      weight: 0.10, findingId: 'ai-bots-blocked-perplexitybot' },
  { name: 'Google-Extended',    weight: 0.08, findingId: null },
  { name: 'Googlebot-Extended', weight: 0.07, findingId: null },
  { name: 'OAI-SearchBot',      weight: 0.05, findingId: null },
  { name: 'Anthropic-AI',       weight: 0.05, findingId: null },
  { name: 'CCBot',              weight: 0.04, findingId: null },
  { name: 'FacebookBot',        weight: 0.03, findingId: null },
  { name: 'Amazonbot',          weight: 0.03, findingId: null },
  { name: 'cohere-ai',          weight: 0.03, findingId: null },
  { name: 'YouBot',             weight: 0.02, findingId: null },
  { name: 'Applebot-Extended',  weight: 0.02, findingId: null },
  { name: 'DataForSeoBot',      weight: 0.02, findingId: null },
  { name: 'SemrushBot',         weight: 0.02, findingId: null },
  { name: 'DuckDuckBot',        weight: 0.01, findingId: null },
  { name: 'Bingbot',            weight: 0.01, findingId: null },
  { name: 'img2dataset',        weight: 0.01, findingId: null },
  { name: 'PetalBot',           weight: 0.01, findingId: null },
  { name: 'TurnitinBot',        weight: 0.01, findingId: null },
  { name: 'Diffbot',            weight: 0.01, findingId: null },
  { name: 'Bytespider',         weight: 0.01, findingId: null },
];

// Canonical content paths tested per bot
const CONTENT_PATHS = ['/', '/blog/', '/articles/', '/products/', '/services/'];

// ── Parser ────────────────────────────────────────────────────────────────────

// Returns Map<agentName(lower), Rule[]>
// Rule = { type: 'Allow'|'Disallow', path: string }
function parseRobotsTxt(text) {
  const agents = new Map();
  let currentAgents = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0].trim();

    if (!line) {
      // Blank line separates rule groups — reset current agent context
      currentAgents = [];
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === 'user-agent') {
      const agent = value.toLowerCase();
      if (!agents.has(agent)) agents.set(agent, []);
      currentAgents.push(agent);
    } else if (field === 'disallow' || field === 'allow') {
      const type = field === 'allow' ? 'Allow' : 'Disallow';
      for (const agent of currentAgents) {
        const rules = agents.get(agent);
        if (rules) rules.push({ type, path: value });
      }
    }
  }

  return agents;
}

// ── Path matcher ──────────────────────────────────────────────────────────────

// Convert a robots.txt path pattern to a RegExp.
// Handles * wildcards and $ end anchors.
function patternToRegex(pattern) {
  // Escape regex special chars except * and $
  const escaped = pattern.replace(/[.+^()\[\]{}|\\]/g, '\\$&');

  // Split on $ anchor — must be at the end of the pattern string
  let core, anchored;
  if (escaped.endsWith('\\$')) {
    // Literal $ escaped above — not a real anchor
    core = escaped;
    anchored = false;
  } else if (escaped.endsWith('$')) {
    core = escaped.slice(0, -1);
    anchored = true;
  } else {
    core = escaped;
    anchored = false;
  }

  // Replace * with .*
  const regexBody = core.replace(/\*/g, '.*');

  return new RegExp('^' + regexBody + (anchored ? '$' : ''));
}

// Determine access for one path against a rule list.
// Returns { access: 'blocked'|'allowed'|'unspecified', matchedRule }
// Longest-match-wins; tie → Allow wins.
function resolveAccess(rules, testPath) {
  let bestLen  = -1;
  let bestType = null;

  for (const { type, path } of rules) {
    // Empty Disallow = no restriction (skip; does not grant access explicitly)
    if (path === '' && type === 'Disallow') continue;
    if (path === '') continue;

    const regex = patternToRegex(path);
    if (!regex.test(testPath)) continue;

    // Specificity = raw pattern length after stripping wildcard/anchor characters
    const len = path.replace(/[*$]/g, '').length;

    if (len > bestLen || (len === bestLen && type === 'Allow')) {
      bestLen  = len;
      bestType = type;
    }
  }

  if (bestType === null) return { access: 'unspecified', matchedRule: null };
  return { access: bestType === 'Disallow' ? 'blocked' : 'allowed', matchedRule: bestType };
}

// Get effective rules for a bot: specific agent rules take full precedence over *.
function getEffectiveRules(agents, agentName) {
  const specific = agents.get(agentName.toLowerCase());
  if (specific && specific.length > 0) return specific;
  return agents.get('*') || [];
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function parseRobotsAi({ websiteUrl, signal }) {
  const base = websiteUrl.replace(/\/$/, '');
  let raw = null;

  try {
    const res = await fetch(`${base}/robots.txt`, {
      signal,
      headers: { 'User-Agent': UA },
    });
    if (res.ok) raw = await res.text();
  } catch { /* non-fatal — no robots.txt = all bots unspecified */ }

  if (!raw) {
    return {
      score: 100, botScores: {}, accessSummary: {},
      testedPaths: {}, raw: null, blockedBots: [], parsedAgents: {},
    };
  }

  const agents     = parseRobotsTxt(raw);
  const botScores  = {};
  const accessSummary = {};
  const testedPaths   = {};
  const blockedBots   = [];

  for (const bot of AI_BOTS) {
    const rules = getEffectiveRules(agents, bot.name);
    const pathResults = {};
    let isBlocked = false;

    for (const testPath of CONTENT_PATHS) {
      const { access } = resolveAccess(rules, testPath);
      pathResults[testPath] = access;
      if (access === 'blocked') isBlocked = true;
    }

    testedPaths[bot.name]   = pathResults;
    const status = isBlocked ? 'blocked' : (rules.length > 0 ? 'allowed' : 'unspecified');
    accessSummary[bot.name] = status;
    botScores[bot.name]     = isBlocked ? 0 : 100;

    if (isBlocked) blockedBots.push({ name: bot.name, weight: bot.weight, findingId: bot.findingId });
  }

  // Weighted composite score
  let weightedSum = 0;
  let totalWeight = 0;
  for (const bot of AI_BOTS) {
    weightedSum += (botScores[bot.name] ?? 100) * bot.weight;
    totalWeight += bot.weight;
  }
  const score = Math.round(totalWeight > 0 ? weightedSum / totalWeight : 100);

  return {
    score,
    botScores,
    accessSummary,
    testedPaths,
    raw,
    blockedBots,
    parsedAgents: Object.fromEntries(agents),
  };
}

// Exported for unit tests
export { parseRobotsTxt, resolveAccess, getEffectiveRules, patternToRegex };
