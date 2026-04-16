'use strict';

// _runner.js — Analyzer skill runner.
//
// Loads a skill .md file, substitutes template variables, calls Anthropic with
// tool_use, validates the output against the standard contract, and returns a
// typed result. All failures are non-fatal — callers receive { ok: false }.
//
// Public API:
//   runSkill(skillId, { card, sourcePayloads })
//     → Promise<{ ok, output, runCostData, error }>
//
//   runCardSkills({ tier, sourcePayloads, warnings })
//     → Promise<{ [cardId]: SkillOutput }>
//
//   buildSourcePayloads({ intake, styleGuide, siteMeta, evidence, pagespeed, scoutConfig, userContext })
//     → { [sourceId]: any }

const fs   = require('fs');
const path = require('path');

const { getSkillPath }      = require('./_registry');
const { validateSkillOutput } = require('./_output-contract');
const { SOURCES_BY_ID }     = require('../source-inventory');
const { CARD_CONTRACT }     = require('../card-contract');

// ── Anthropic client (same pattern as intake-synthesizer / scribe) ─────────────

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

// ── Front matter parser ───────────────────────────────────────────────────────
//
// Parses YAML front matter without a YAML library.
// Handles: scalar strings, integers (version, maxTokens), lists (inputs,
// groundingRules), and one-level nested objects (output).
//
// Assumptions about the skill .md format (enforced by convention):
//   - File starts with ---\n and ends front matter with \n---\n
//   - List items are indented with two spaces: "  - value"
//   - Object keys are indented with two spaces: "  key: value"
//   - Known integer fields: version, maxTokens

const INTEGER_FIELDS  = new Set(['version', 'maxTokens']);
const LIST_FIELDS     = new Set(['inputs', 'groundingRules']);
const OBJECT_FIELDS   = new Set(['output']);

function parseFrontMatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error('Skill file missing YAML front matter (--- delimiters not found)');

  const yamlText = match[1];
  const body     = match[2].trim();
  const fm       = {};

  let currentListKey  = null;
  let currentObjKey   = null;

  for (const rawLine of yamlText.split('\n')) {
    const line = rawLine.replace(/\r$/, '');

    if (!line.trim()) continue;

    // Indented list item: "  - value"
    if (/^  - (.+)$/.test(line)) {
      const val = line.match(/^  - (.+)$/)[1].trim().replace(/^["']|["']$/g, '');
      if (currentListKey) {
        if (!Array.isArray(fm[currentListKey])) fm[currentListKey] = [];
        fm[currentListKey].push(val);
      }
      continue;
    }

    // Indented object key: "  key: value"
    if (/^  (\w+): (.+)$/.test(line)) {
      const [, k, v] = line.match(/^  (\w+): (.+)$/);
      if (currentObjKey) {
        if (!fm[currentObjKey] || typeof fm[currentObjKey] !== 'object') fm[currentObjKey] = {};
        fm[currentObjKey][k] = v.trim().replace(/^["']|["']$/g, '');
      }
      continue;
    }

    // Top-level key: value (scalar)
    if (/^(\w+): (.+)$/.test(line)) {
      const [, k, v] = line.match(/^(\w+): (.+)$/);
      currentListKey = null;
      currentObjKey  = null;
      const val = v.trim().replace(/^["']|["']$/g, '');
      fm[k] = INTEGER_FIELDS.has(k) ? parseInt(val, 10) : val;
      continue;
    }

    // Top-level key: (no inline value — list or object follows)
    if (/^(\w+):$/.test(line)) {
      const [, k] = line.match(/^(\w+):$/);
      currentListKey = null;
      currentObjKey  = null;
      if (LIST_FIELDS.has(k)) {
        fm[k]         = [];
        currentListKey = k;
      } else if (OBJECT_FIELDS.has(k)) {
        fm[k]        = {};
        currentObjKey = k;
      }
    }
  }

  return { frontMatter: fm, body };
}

// ── Tool schema builder ───────────────────────────────────────────────────────
//
// Builds the Anthropic tool_use schema enforcing the standard output contract.
// The tool name comes from the skill's front matter (output.tool).
// skillId, skillVersion, runAt, and metadata are added by the runner — not the LLM.

function buildSkillTool(toolName) {
  return {
    name: toolName,
    description: 'Record the structured analyzer skill output per the standard contract. Return only what the evidence supports.',
    input_schema: {
      type: 'object',
      required: ['findings', 'gaps', 'readiness', 'highlights'],
      properties: {
        findings: {
          type: 'array',
          description: 'Up to 5 findings. Each must cite the exact source field that triggered it.',
          items: {
            type: 'object',
            required: ['id', 'severity', 'label', 'detail', 'citation'],
            properties: {
              id:       { type: 'string', description: 'Stable kebab-case id for this finding.' },
              severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
              label:    { type: 'string', description: 'One-line headline.' },
              detail:   { type: 'string', description: '1–2 sentences of evidence.' },
              citation: { type: 'string', description: 'Source field that triggered it, e.g. "intel.pagespeed.scores.performance = 42".' },
            },
          },
        },
        gaps: {
          type: 'array',
          description: 'One entry per missing-state rule. Evaluate every rule provided.',
          items: {
            type: 'object',
            required: ['ruleId', 'triggered', 'evidence'],
            properties: {
              ruleId:    { type: 'string', description: 'Must match a rule id from the card guidance.' },
              triggered: { type: 'boolean', description: 'true if the gap condition is met.' },
              evidence:  { type: 'string', description: 'What in the source data caused this evaluation.' },
            },
          },
        },
        readiness: {
          type: 'string',
          enum: ['healthy', 'partial', 'critical'],
          description: 'Overall verdict. critical = any critical findings or triggered gap; partial = warnings only; healthy = no issues.',
        },
        highlights: {
          type: 'array',
          items: { type: 'string' },
          description: '1–3 short phrases Scribe can reuse verbatim.',
        },
      },
    },
  };
}

// ── Response extraction ───────────────────────────────────────────────────────

function extractToolInput(response, toolName) {
  if (!Array.isArray(response.content)) return null;
  for (const block of response.content) {
    if (block.type === 'tool_use' && block.name === toolName) {
      return block.input || null;
    }
  }
  return null;
}

function extractUsage(response, model) {
  const usage = response.usage || {};
  const inputTokens  = usage.input_tokens  || 0;
  const outputTokens = usage.output_tokens || 0;
  // Haiku 4.5: $1.00/MTok input, $5.00/MTok output
  const estimatedCostUsd = (inputTokens * 0.000001) + (outputTokens * 0.000005);
  return {
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
  };
}

// ── Input resolver ────────────────────────────────────────────────────────────

/**
 * Build a map of sourceId → runtime payload from the available pipeline state.
 * Null entries are present for sources that are not yet wired into the pipeline.
 */
function buildSourcePayloads({
  intake       = null,
  styleGuide   = null,
  siteMeta     = null,
  evidence     = null,
  pagespeed    = null,
  scoutConfig  = null,
  userContext  = null,
} = {}) {
  return {
    'site.html':                      evidence    || null,
    'site.meta':                      siteMeta    || null,
    'synth.intake':                   intake      || null,
    'synth.styleGuide':               styleGuide  || null,
    'intel.pagespeed':                pagespeed   || null,
    'scout.reddit':                   null,  // Phase E — not wired
    'scout.weather':                  null,
    'scout.reviews':                  null,
    'scoutConfig.brandKeywords':      scoutConfig || null,
    'scoutConfig.competitors':        scoutConfig?.competitors        || null,
    'scoutConfig.categoryTerms':      scoutConfig?.categoryTerms      || null,
    'scoutConfig.searchPlan':         scoutConfig?.searchPlan         || null,
    'scoutConfig.capabilitiesActive': scoutConfig?._meta?.capabilitiesActive || null,
    'userContext':                    userContext || null,
  };
}

// ── Core skill executor ───────────────────────────────────────────────────────

/**
 * Run a single analyzer skill.
 *
 * @param {string} skillId
 * @param {object} options
 * @param {object} options.card           - Card from card-contract.js
 * @param {object} [options.sourcePayloads] - Map of sourceId → payload
 * @returns {Promise<{ ok: boolean, output: object|null, runCostData: object|null, error: string|null }>}
 */
async function runSkill(skillId, { card = null, sourcePayloads = {} } = {}) {
  // 1. Locate skill file
  const skillPath = getSkillPath(skillId);
  if (!skillPath) {
    return { ok: false, output: null, runCostData: null, error: `Skill '${skillId}' not found in registry` };
  }

  // 2. Read skill file
  let fileContent;
  try {
    fileContent = fs.readFileSync(skillPath, 'utf8');
  } catch (err) {
    return { ok: false, output: null, runCostData: null, error: `Could not read skill file: ${err.message}` };
  }

  // 3. Parse front matter
  let fm, body;
  try {
    ({ frontMatter: fm, body } = parseFrontMatter(fileContent));
  } catch (err) {
    return { ok: false, output: null, runCostData: null, error: `Front matter parse error: ${err.message}` };
  }

  // 4. Validate required front matter fields
  const required = ['id', 'version', 'model', 'maxTokens', 'inputs', 'output'];
  const missing  = required.filter((k) => fm[k] === undefined || fm[k] === null || fm[k] === '');
  if (missing.length) {
    return { ok: false, output: null, runCostData: null, error: `Skill front matter missing required fields: ${missing.join(', ')}` };
  }
  if (!fm.output?.tool) {
    return { ok: false, output: null, runCostData: null, error: 'Skill front matter missing output.tool' };
  }

  // 5. Validate declared inputs against source-inventory
  const inputs = Array.isArray(fm.inputs) ? fm.inputs : [];
  const unknownSources = inputs.filter((id) => !SOURCES_BY_ID[id]);
  if (unknownSources.length) {
    return {
      ok: false, output: null, runCostData: null,
      error: `Skill '${skillId}' declares unknown source ids: ${unknownSources.join(', ')}`,
    };
  }

  // 6. Resolve inputs from sourcePayloads
  const resolvedInputs = {};
  for (const sourceId of inputs) {
    resolvedInputs[sourceId] = sourcePayloads[sourceId] !== undefined ? sourcePayloads[sourceId] : null;
  }

  // 7. Build prompt via template substitution
  const inputsText = Object.entries(resolvedInputs)
    .map(([id, payload]) => `=== ${id} ===\n${payload != null ? JSON.stringify(payload, null, 2) : '(not available)'}`)
    .join('\n\n');

  const missingStateRules = Array.isArray(card?.missingStateRules) ? card.missingStateRules : [];
  const rulesText = missingStateRules.length
    ? missingStateRules.map((r) => `- ${r.id}: ${r.when} → ${r.reason}`).join('\n')
    : '(none)';

  const prompt = body
    .replace('{{inputs}}', inputsText)
    .replace('{{missingStateRules}}', rulesText);

  // 8. Call Anthropic
  const tool = buildSkillTool(fm.output.tool);
  let response;
  try {
    response = await callAnthropic({
      model:       fm.model,
      max_tokens:  fm.maxTokens,
      tools:       [tool],
      tool_choice: { type: 'tool', name: fm.output.tool },
      messages:    [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    return { ok: false, output: null, runCostData: null, error: `Anthropic API error: ${err.message}` };
  }

  const runCostData = extractUsage(response, fm.model);

  // 9. Extract tool input
  const toolInput = extractToolInput(response, fm.output.tool);
  if (!toolInput) {
    return {
      ok: false, output: null, runCostData,
      error: `Skill did not return a tool_use block for '${fm.output.tool}'`,
    };
  }

  // 10. Build full output (runner adds envelope fields the LLM doesn't fill)
  const output = {
    skillId:      fm.id,
    skillVersion: fm.version,
    runAt:        new Date().toISOString(),
    findings:     toolInput.findings   || [],
    gaps:         toolInput.gaps       || [],
    readiness:    toolInput.readiness,
    highlights:   toolInput.highlights || [],
    metadata:     runCostData,
  };

  // 11. Validate against contract
  const { valid, errors } = validateSkillOutput(output);
  if (!valid) {
    return {
      ok: false, output: null, runCostData,
      error: `Skill output failed contract validation: ${errors.join('; ')}`,
    };
  }

  return { ok: true, output, runCostData, error: null };
}

// ── Pipeline fan-out ──────────────────────────────────────────────────────────

/**
 * Run analyzer skills for all cards that declare one.
 * Non-fatal: failures are pushed to `warnings` and the card is skipped.
 *
 * @param {object} options
 * @param {string}   options.tier           - 'free' | 'paid'
 * @param {object}   options.sourcePayloads - Map of sourceId → payload
 * @param {Array}    [options.warnings]     - Mutable warnings array (pushed to in-place)
 * @returns {Promise<{ [cardId]: SkillOutput }>}
 */
async function runCardSkills({ tier = 'free', sourcePayloads = {}, warnings = [] } = {}) {
  const cards = tier === 'paid'
    ? CARD_CONTRACT.filter((c) => c.tier === 'all' || c.tier === 'paid')
    : CARD_CONTRACT.filter((c) => c.tier === 'all');

  const analyzerOutputs = {};

  await Promise.allSettled(
    cards.map(async (card) => {
      const skillId = card.analyzerSkill || null;
      if (!skillId) return;

      let result;
      try {
        result = await runSkill(skillId, { card, sourcePayloads });
      } catch (err) {
        warnings.push({
          type: 'warning',
          code: 'skill_threw',
          message: `Skill '${skillId}' for card '${card.id}' threw: ${err.message}`,
          stage: 'skills',
        });
        return;
      }

      if (result.ok) {
        analyzerOutputs[card.id] = result.output;
      } else {
        warnings.push({
          type: 'warning',
          code: 'skill_failed',
          message: `Skill '${skillId}' for card '${card.id}' failed: ${result.error}`,
          stage: 'skills',
        });
      }
    })
  );

  return analyzerOutputs;
}

module.exports = {
  runSkill,
  runCardSkills,
  buildSourcePayloads,
  parseFrontMatter,    // exported for unit tests
  buildSkillTool,      // exported for unit tests
};
