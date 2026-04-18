// audit.js — AI SEO / GEO visibility audit engine.
//
// Primary export:
//   runAiSeoAudit({ websiteUrl, signal, logger })
//     → skill output per Section 0.2 of docs/CODEX_PROMPT_AI_SEO.md
//
// Stable finding ids match Section 0.3 exactly — used for solutions-catalog lookup.
//
// CLI usage (run as script):
//   node src/audit.js <url> [--format=json|json-min|summary]

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import { fileURLToPath } from 'url';
import { validateLlmsTxt }        from './llmsTxtValidator.js';
import { parseRobotsAi }          from './robotsAiParser.js';
import { extractSchema }           from './schemaExtractor.js';
import { analyzeContent }          from './contentExtractability.js';
import { analyzeEntityAuthority }  from './entityAuthority.js';

const SKILL_ID      = 'ai-seo-audit';
const SKILL_VERSION = 1;
const UA            = 'BballiAiSeoAudit/1.0 (mailto:bryanballi@gmail.com)';

// ── Section weights (must sum to 1.0) ────────────────────────────────────────
const WEIGHTS = {
  llmsTxt:   0.15,
  robotsAi:  0.25,
  schema:    0.25,
  content:   0.15,
  entity:    0.10,
  technical: 0.10,
};

// ── Scoring helpers ───────────────────────────────────────────────────────────

function letterGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

function gradeStatus(score) {
  if (score >= 90) return 'pass';
  if (score >= 50) return 'warn';
  return 'fail';
}

// ── HTML fetcher ──────────────────────────────────────────────────────────────

async function fetchHtml(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('html')) throw new Error(`Non-HTML content-type: ${ct}`);
  return res.text();
}

// ── Technical signals from the fetched HTML ───────────────────────────────────

function analyzeTechnical(html, websiteUrl) {
  const $ = cheerio.load(html);

  const canonical    = $('link[rel="canonical"]').attr('href') || null;
  const metaDesc     = $('meta[name="description"]').attr('content') || null;
  const robotsMeta   = $('meta[name="robots"]').attr('content') || '';
  const isHttps      = websiteUrl.startsWith('https://');
  const hasNoindex   = /noindex/i.test(robotsMeta);

  let score = 100;
  if (hasNoindex) score -= 40;
  if (!isHttps)   score -= 30;
  if (!canonical) score -= 10;
  if (!metaDesc)  score -= 20;

  return {
    score:          Math.max(score, 0),
    canonical,
    metaDescription: metaDesc,
    robotsMeta,
    isHttps,
    hasNoindex,
  };
}

// ── Findings builder ──────────────────────────────────────────────────────────
// Every finding id here MUST match Section 0.3 stable ids.

function buildFindings({ llmsTxt, robotsAi, schema, entity }) {
  const findings = [];

  // ── llms.txt ───────────────────────────────────────────────────────────────
  if (!llmsTxt.found) {
    findings.push({
      id:          'missing-llms-txt',
      severity:    'warning',
      label:       'No /llms.txt file found',
      detail:      'The site has no /llms.txt. AI systems use this file to understand what content is available for indexing and training.',
      citation:    `/llms.txt — HTTP 404 or fetch failed`,
      impact:      'Without llms.txt, AI crawlers have no explicit guidance on site content structure or preferred pages.',
      remediation: 'Create /llms.txt starting with an H1 title, optional blockquote summary, and a ## Docs section listing key pages.',
    });
  } else if (llmsTxt.brokenLinks?.length > 0) {
    findings.push({
      id:          'llms-txt-broken-links',
      severity:    'info',
      label:       `llms.txt contains ${llmsTxt.brokenLinks.length} broken link(s)`,
      detail:      `HEAD checks failed for: ${llmsTxt.brokenLinks.slice(0, 3).join(', ')}${llmsTxt.brokenLinks.length > 3 ? '…' : ''}.`,
      citation:    `llms.txt brokenLinks = ${JSON.stringify(llmsTxt.brokenLinks.slice(0, 3))}`,
      impact:      'Broken links in llms.txt reduce trust for AI systems that parse the file.',
      remediation: 'Update or remove the broken links in /llms.txt.',
    });
  }

  // ── robots.txt AI bot access ───────────────────────────────────────────────
  const blocked = robotsAi.blockedBots || [];

  const gptBlocked        = blocked.find((b) => b.name === 'GPTBot');
  const claudeBlocked     = blocked.find((b) => b.name === 'ClaudeBot');
  const perplexityBlocked = blocked.find((b) => b.name === 'PerplexityBot');
  const otherBlocked      = blocked.filter(
    (b) => !['GPTBot', 'ClaudeBot', 'PerplexityBot'].includes(b.name)
  );

  if (gptBlocked) {
    findings.push({
      id:          'ai-bots-blocked-gptbot',
      severity:    'critical',
      label:       'GPTBot is disallowed in robots.txt',
      detail:      'A Disallow rule in robots.txt blocks GPTBot on one or more content paths, preventing OpenAI from indexing this site.',
      citation:    `robots.txt — Disallow matched for GPTBot on content paths`,
      impact:      'ChatGPT cannot cite or reference this site in responses.',
      remediation: 'Remove the GPTBot Disallow rule or add `Allow: /` for GPTBot above the general Disallow.',
    });
  }
  if (claudeBlocked) {
    findings.push({
      id:          'ai-bots-blocked-claudebot',
      severity:    'critical',
      label:       'ClaudeBot is disallowed in robots.txt',
      detail:      "A Disallow rule blocks ClaudeBot on one or more content paths, preventing Anthropic's Claude from indexing this site.",
      citation:    `robots.txt — Disallow matched for ClaudeBot on content paths`,
      impact:      "Claude will not have this site's content available for training or citation.",
      remediation: 'Remove the ClaudeBot Disallow rule or add `Allow: /` for ClaudeBot.',
    });
  }
  if (perplexityBlocked) {
    findings.push({
      id:          'ai-bots-blocked-perplexitybot',
      severity:    'warning',
      label:       'PerplexityBot is disallowed in robots.txt',
      detail:      'A Disallow rule blocks PerplexityBot on one or more content paths.',
      citation:    `robots.txt — Disallow matched for PerplexityBot on content paths`,
      impact:      "This site will not appear in Perplexity AI answers.",
      remediation: 'Add `Allow: /` for PerplexityBot before the general Disallow rule.',
    });
  }
  if (otherBlocked.length >= 2) {
    findings.push({
      id:          'ai-bots-blocked-generic',
      severity:    'warning',
      label:       `${otherBlocked.length} additional AI crawlers blocked`,
      detail:      `robots.txt blocks: ${otherBlocked.map((b) => b.name).join(', ')}.`,
      citation:    `robots.txt — Disallow matched for ${otherBlocked.map((b) => b.name).join(', ')}`,
      impact:      'Reduced AI citation coverage across emerging AI search engines.',
      remediation: 'Review robots.txt and remove unnecessary AI bot restrictions.',
    });
  }

  // ── Schema ─────────────────────────────────────────────────────────────────
  if (!schema.hasFaqPage) {
    findings.push({
      id:          'no-faqpage-schema',
      severity:    'warning',
      label:       'No FAQPage schema detected',
      detail:      'No FAQPage JSON-LD found. AI systems extract Q&A pairs directly from FAQPage schema for featured snippets and AI answers.',
      citation:    `schemaExtractor — FAQPage not in extracted types: [${schema.types.join(', ')}]`,
      impact:      'AI systems cannot directly extract structured Q&A from this site.',
      remediation: 'Add FAQPage JSON-LD to any page containing a FAQ section.',
    });
  }
  if (!schema.hasArticle) {
    findings.push({
      id:          'no-article-schema',
      severity:    'info',
      label:       'No Article or BlogPosting schema on content pages',
      detail:      'No Article or BlogPosting JSON-LD detected. Article schema helps AI systems identify and attribute authoritative content.',
      citation:    `schemaExtractor — Article/BlogPosting not in extracted types: [${schema.types.join(', ')}]`,
      impact:      'AI systems may not attribute blog or editorial content to this site.',
      remediation: 'Add Article or BlogPosting JSON-LD to long-form content and blog posts.',
    });
  }
  if (!schema.hasOrganization) {
    findings.push({
      id:          'no-organization-schema',
      severity:    'warning',
      label:       'No Organization schema detected',
      detail:      'No Organization or LocalBusiness JSON-LD found. Organization schema establishes entity identity for AI knowledge graphs.',
      citation:    `schemaExtractor — Organization/LocalBusiness not in extracted types: [${schema.types.join(', ')}]`,
      impact:      "AI systems cannot reliably identify this entity in knowledge graphs.",
      remediation: 'Add Organization JSON-LD to the homepage with name, url, logo, and sameAs fields.',
    });
  }

  // ── Entity authority ───────────────────────────────────────────────────────
  if (!entity.wikidataFound) {
    findings.push({
      id:          'no-wikidata-entity',
      severity:    'info',
      label:       'No Wikidata entity found for this organization',
      detail:      'No Wikidata QID resolved via sameAs links or organization name search.',
      citation:    `entityAuthority — Wikidata search returned no QID`,
      impact:      'AI systems using knowledge graphs have less structured entity knowledge about this brand.',
      remediation: "Create a Wikidata entry and add it to Organization schema's sameAs field.",
    });
  }
  if (!entity.napConsistent && entity.napIssues?.length > 0) {
    findings.push({
      id:          'nap-inconsistency',
      severity:    'warning',
      label:       'NAP inconsistency — schema data does not match page body',
      detail:      entity.napIssues.join('; '),
      citation:    `entityAuthority — napIssues = ${JSON.stringify(entity.napIssues)}`,
      impact:      'NAP inconsistencies confuse AI systems and local search engines when establishing entity identity.',
      remediation: 'Align the name, address, and phone in JSON-LD schema with the visible page text.',
    });
  }

  return findings;
}

// ── Gaps builder ──────────────────────────────────────────────────────────────
// Emit entries for the seo-performance card's declared missing-state rules.
// This engine does not have PSI data — emit triggered:false for PSI gaps.

function buildGaps({ schema }) {
  const gaps = [];

  // PSI gaps — not evaluated by this engine
  gaps.push({
    ruleId:    'pagespeed-performance-critical',
    triggered: false,
    evidence:  'ai-seo-audit does not evaluate PageSpeed performance scores — PSI stage handles this',
  });
  gaps.push({
    ruleId:    'pagespeed-seo-low',
    triggered: false,
    evidence:  'ai-seo-audit does not evaluate PageSpeed SEO scores — PSI stage handles this',
  });

  // Schema gap — this engine CAN evaluate JSON-LD presence
  const hasAnySchema = schema.types?.length > 0;
  gaps.push({
    ruleId:    'no-schema-markup',
    triggered: !hasAnySchema,
    evidence:  hasAnySchema
      ? `JSON-LD schema detected: [${schema.types.join(', ')}]`
      : 'No JSON-LD schema detected in crawled page',
  });

  return gaps;
}

// ── Readiness verdict ─────────────────────────────────────────────────────────

function computeReadiness(findings, gaps) {
  if (findings.some((f) => f.severity === 'critical') || gaps.some((g) => g.triggered)) {
    return 'critical';
  }
  if (findings.some((f) => f.severity === 'warning')) return 'partial';
  return 'healthy';
}

// ── Highlights ────────────────────────────────────────────────────────────────

function buildHighlights(findings, aiVisibility) {
  const topFindings = findings
    .filter((f) => f.severity === 'critical' || f.severity === 'warning')
    .slice(0, 3);

  if (topFindings.length > 0) return topFindings.map((f) => f.label).slice(0, 3);

  // No issues → surface the score
  return [`AI visibility score: ${aiVisibility.score}/100 (${aiVisibility.letterGrade})`];
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runAiSeoAudit({ websiteUrl, signal, logger } = {}) {
  const log   = logger || { info: () => {}, warn: (...a) => console.warn('[ai-seo-audit]', ...a) };
  const runAt = new Date().toISOString();

  // Fetch HTML (non-fatal)
  let html = '';
  try {
    html = await fetchHtml(websiteUrl, signal);
  } catch (err) {
    log.warn(`HTML fetch failed: ${err.message}`);
  }

  // Synchronous schema extraction (needed before entity authority)
  const schema = html
    ? extractSchema(html)
    : { score: 0, types: [], hasOrganization: false, hasFaqPage: false, hasArticle: false, orgData: null };

  // Run independent modules in parallel
  const [llmsTxtRes, robotsAiRes, contentRes, entityRes] = await Promise.allSettled([
    validateLlmsTxt({ websiteUrl, signal }).catch((err) => {
      log.warn(`llmsTxt failed: ${err.message}`);
      return { found: false, valid: false, score: 0, brokenLinks: [] };
    }),
    parseRobotsAi({ websiteUrl, signal }).catch((err) => {
      log.warn(`robotsAi failed: ${err.message}`);
      return { score: 100, blockedBots: [], botScores: {}, accessSummary: {} };
    }),
    html
      ? analyzeContent({ websiteUrl, html, signal }).catch((err) => {
          log.warn(`content failed: ${err.message}`);
          return { score: 50 };
        })
      : Promise.resolve({ score: 50 }),
    analyzeEntityAuthority({ orgData: schema.orgData, html, signal }).catch((err) => {
      log.warn(`entityAuthority failed: ${err.message}`);
      return { score: 0, wikidataFound: false, qid: null, wikidataUrl: null, wikipediaUrl: null, napConsistent: true, napIssues: [] };
    }),
  ]);

  const llmsTxt  = llmsTxtRes.value  ?? llmsTxtRes.reason  ?? { found: false, score: 0, brokenLinks: [] };
  const robotsAi = robotsAiRes.value ?? robotsAiRes.reason ?? { score: 100, blockedBots: [] };
  const content  = contentRes.value  ?? contentRes.reason  ?? { score: 50 };
  const entity   = entityRes.value   ?? entityRes.reason   ?? { score: 0, wikidataFound: false, napConsistent: true, napIssues: [] };

  const technical = html ? analyzeTechnical(html, websiteUrl) : { score: 50 };

  // Composite score
  const rawScore =
    (llmsTxt.score  || 0) * WEIGHTS.llmsTxt  +
    (robotsAi.score || 0) * WEIGHTS.robotsAi +
    (schema.score   || 0) * WEIGHTS.schema   +
    (content.score  || 0) * WEIGHTS.content  +
    (entity.score   || 0) * WEIGHTS.entity   +
    (technical.score || 0) * WEIGHTS.technical;

  const score = Math.round(rawScore);

  const aiVisibility = {
    score,
    letterGrade: letterGrade(score),
    sections: {
      llmsTxt:   { score: llmsTxt.score  || 0, status: gradeStatus(llmsTxt.score  || 0), weight: WEIGHTS.llmsTxt },
      robotsAi:  { score: robotsAi.score || 0, status: gradeStatus(robotsAi.score || 0), weight: WEIGHTS.robotsAi },
      schema:    { score: schema.score   || 0, status: gradeStatus(schema.score   || 0), weight: WEIGHTS.schema },
      content:   { score: content.score  || 0, status: gradeStatus(content.score  || 0), weight: WEIGHTS.content },
      entity:    { score: entity.score   || 0, status: gradeStatus(entity.score   || 0), weight: WEIGHTS.entity },
      technical: { score: technical.score || 0, status: gradeStatus(technical.score || 0), weight: WEIGHTS.technical },
    },
  };

  const findings  = buildFindings({ llmsTxt, robotsAi, schema, entity });
  const gaps      = buildGaps({ schema });
  const readiness = computeReadiness(findings, gaps);
  const highlights = buildHighlights(findings, aiVisibility);

  return {
    skillId:      SKILL_ID,
    skillVersion: SKILL_VERSION,
    runAt,
    findings,
    gaps,
    readiness,
    highlights,
    metadata: {
      model:             'native',
      inputTokens:       0,
      outputTokens:      0,
      estimatedCostUsd:  0,
    },
    // Additive extras — preserved through aggregator for CLI/API consumers
    aiVisibility,
    rawSignals: { llmsTxt, robotsAi, schema, content, entity, technical },
    priorityActions: findings
      .filter((f) => f.severity === 'critical' || f.severity === 'warning')
      .map((f) => ({ severity: f.severity, action: f.remediation, findingId: f.id })),
  };
}

// ── CLI entry ─────────────────────────────────────────────────────────────────
// Runs only when this file is executed directly (not imported as a module).

const isMain = process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
   process.argv[1].endsWith('/audit.js'));

if (isMain) {
  const args       = process.argv.slice(2);
  const urlA       = args.find((a) => !a.startsWith('--'));
  const formatFlag = (args.find((a) => a.startsWith('--format=')) || '--format=json').split('=')[1];
  const compareIdx = args.indexOf('--compare');
  const urlB       = compareIdx !== -1 ? args[compareIdx + 1] : null;
  const genLlms    = args.includes('--generate-llms-txt');

  if (!urlA) {
    console.error('Usage: node src/audit.js <url> [--format=json|json-min|summary] [--compare <url-b>] [--generate-llms-txt]');
    process.exit(1);
  }

  (async () => {
    try {
      // ── Compare mode ───────────────────────────────────────────────────────
      if (urlB) {
        const { formatJson, formatSummary } = await import('./formatters/compare.js');
        const [resA, resB] = await Promise.allSettled([
          runAiSeoAudit({ websiteUrl: urlA }),
          runAiSeoAudit({ websiteUrl: urlB }),
        ]);
        const resultA = resA.status === 'fulfilled' ? resA.value : new Error(resA.reason?.message || 'Audit failed');
        const resultB = resB.status === 'fulfilled' ? resB.value : new Error(resB.reason?.message || 'Audit failed');

        if (formatFlag === 'json') {
          process.stdout.write(formatJson(resultA, resultB) + '\n');
        } else {
          process.stdout.write(formatSummary(resultA, resultB, urlA, urlB) + '\n');
        }
        return;
      }

      // ── Single audit ───────────────────────────────────────────────────────
      const result = await runAiSeoAudit({ websiteUrl: urlA });

      // ── Generate llms.txt ──────────────────────────────────────────────────
      if (genLlms) {
        const { generateLlmsTxt } = await import('./generateLlmsTxt.js');
        process.stdout.write(generateLlmsTxt(result, { websiteUrl: urlA }) + '\n');
        return;
      }

      // ── Format output ──────────────────────────────────────────────────────
      if (formatFlag === 'summary') {
        const { format } = await import('./formatters/terminal.js');
        process.stdout.write(format(result));
      } else if (formatFlag === 'json-min') {
        const { format } = await import('./formatters/jsonMin.js');
        process.stdout.write(format(result) + '\n');
      } else {
        // Default: pretty JSON
        const { format } = await import('./formatters/json.js');
        process.stdout.write(format(result) + '\n');
      }
    } catch (err) {
      console.error('Audit failed:', err.message);
      process.exit(1);
    }
  })();
}
