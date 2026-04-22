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
const { CARD_CONTRACT, getSkillIdsForCard } = require('../card-contract');
const { aggregateCardSkills } = require('./_aggregator');

// ── LLM client — Anthropic-first, KIMI fallback on credit errors ─────────────
const { callLLM, extractUsage: extractUsageLLM } = require('./_llm-client');

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
          description: 'Findings (typical 8–14, more if warranted). Skill prompt determines count and depth. Each must cite the exact source field that triggered it.',
          items: {
            type: 'object',
            required: ['id', 'severity', 'label', 'detail', 'citation'],
            properties: {
              id:       { type: 'string', description: 'Stable kebab-case id for this finding.' },
              severity: { type: 'string', enum: ['critical', 'warning', 'info'] },
              label:    { type: 'string', description: 'One-line headline.' },
              detail:   { type: 'string', description: 'What was observed + why it matters in this specific case (2–4 sentences). Reference the observed value.' },
              citation: { type: 'string', description: 'Source field that triggered it, e.g. "intel.pagespeed.scores.performance = 42".' },
              impact:   { type: 'string', description: 'Concrete business / ranking / UX consequence (1–2 sentences).' },
              remediation: { type: 'string', description: 'Specific concrete steps the user can execute today (2–4 sentences). Name files, tags, fields. Include short literal examples when relevant.' },
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
          description: '3–5 short phrases (< 12 words each), ordered by impact. Used as "Top Priorities" in the deliverable report and reused by Scribe verbatim.',
        },
        verifications: {
          type: 'array',
          description: 'Optional. Per-token confirmations grounded in visual or source evidence — skills that cross-check mechanically extracted values against a screenshot or second source emit these. Other skills may omit this field entirely.',
          items: {
            type: 'object',
            required: ['path', 'confirmed', 'evidence'],
            properties: {
              path:      { type: 'string', description: 'Dotted path into the evaluated source, e.g. "synth.styleGuide.colors.primary.hex".' },
              confirmed: { type: 'boolean', description: 'true if the value is visually confirmed; false if the screenshot contradicts it.' },
              evidence:  { type: 'string', description: 'One sentence describing where the value was (or was not) confirmed in the evidence.' },
              observedValue: { type: 'string', description: 'Optional — the value the verifier actually observed, when it differs from the extracted one.' },
            },
          },
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
  return extractUsageLLM(response, model);
}

// ── Input resolver ────────────────────────────────────────────────────────────

/**
 * Build a map of sourceId → runtime payload from the available pipeline state.
 * Null entries are present for sources that are not yet wired into the pipeline.
 */
function buildSourcePayloads({
  intake        = null,
  styleGuide    = null,
  siteMeta      = null,
  evidence      = null,
  pagespeed     = null,
  scoutConfig   = null,
  userContext   = null,
  runtimeHealth = null,
} = {}) {
  // Unwrap pagespeed SourceRecord — skill prompts cite `intel.pagespeed.scores.*`,
  // which lives under `.facts` in the SourceRecord envelope. When `pagespeed` is
  // a flat seoAudit object (unit-test path) it has no `.facts`, so fall back to
  // the value itself. When null, pass null through.
  const pagespeedPayload = pagespeed?.facts ?? pagespeed ?? null;

  return {
    'site.html':                      evidence    || null,
    'site.meta':                      siteMeta    || null,
    'synth.intake':                   intake      || null,
    'synth.styleGuide':               styleGuide  || null,
    'intel.pagespeed':                pagespeedPayload,
    'runtime.health':                 runtimeHealth || null,
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

  // 7. Build prompt via template substitution.
  //
  // Payloads shaped `{ __image: true, url }` are extracted and passed as
  // Anthropic vision blocks instead of stringified JSON. The prompt still
  // references the source id so the skill body can cite the image.
  const imageBlocks = [];
  const inputsText = Object.entries(resolvedInputs)
    .map(([id, payload]) => {
      if (payload && typeof payload === 'object' && payload.__image === true && typeof payload.url === 'string') {
        imageBlocks.push({
          sourceId: id,
          block: { type: 'image', source: { type: 'url', url: payload.url } },
        });
        return `=== ${id} ===\n(attached as image — see vision block with url: ${payload.url})`;
      }
      return `=== ${id} ===\n${payload != null ? JSON.stringify(payload, null, 2) : '(not available)'}`;
    })
    .join('\n\n');

  const missingStateRules = Array.isArray(card?.missingStateRules) ? card.missingStateRules : [];
  const rulesText = missingStateRules.length
    ? missingStateRules.map((r) => `- ${r.id}: ${r.when} → ${r.reason}`).join('\n')
    : '(none)';

  const prompt = body
    .replace('{{inputs}}', inputsText)
    .replace('{{missingStateRules}}', rulesText);

  // 8. Call LLM (Anthropic-first, KIMI fallback on credit errors). When the
  // skill declared any `__image` inputs, send a mixed-content message with
  // the image blocks prepended; otherwise keep the legacy plain-text shape.
  const messageContent = imageBlocks.length > 0
    ? [
        ...imageBlocks.map((entry) => entry.block),
        { type: 'text', text: prompt },
      ]
    : prompt;

  const tool = buildSkillTool(fm.output.tool);
  let response;
  try {
    response = await callLLM({
      model:       fm.model,
      max_tokens:  fm.maxTokens,
      tools:       [tool],
      tool_choice: { type: 'tool', name: fm.output.tool },
      messages:    [{ role: 'user', content: messageContent }],
    });
  } catch (err) {
    return { ok: false, output: null, runCostData: null, error: `skill_failed: ${err.message}` };
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

  // 10. Build full output (runner adds envelope fields the LLM doesn't fill).
  // Readiness is a required enum, but LLMs occasionally drop it. Derive a safe
  // default from the findings so the skill doesn't hard-fail contract validation.
  const findings = toolInput.findings || [];
  const gaps     = toolInput.gaps     || [];
  const VALID_READINESS = new Set(['healthy', 'partial', 'critical']);
  let readiness = toolInput.readiness;
  if (!VALID_READINESS.has(readiness)) {
    const hasCritical   = findings.some((f) => f?.severity === 'critical') || gaps.some((g) => g?.triggered);
    const hasWarning    = findings.some((f) => f?.severity === 'warning');
    readiness = hasCritical ? 'critical' : hasWarning ? 'partial' : 'healthy';
  }
  const output = {
    skillId:      fm.id,
    skillVersion: fm.version,
    runAt:        new Date().toISOString(),
    findings,
    gaps,
    readiness,
    highlights:    toolInput.highlights    || [],
    verifications: toolInput.verifications || [],
    metadata:      runCostData,
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
 * @param {Function} [options.onProgress]   - Optional (stage, label, extra) → Promise<void>.
 *                                            Invoked at start + completion of each skill so
 *                                            the dashboard terminal can show per-skill status.
 * @returns {Promise<{ [cardId]: { skills: object, aggregate: object } }>}
 */
async function runCardSkills({ tier = 'free', sourcePayloads = {}, warnings = [], onProgress = null } = {}) {
  const cards = tier === 'paid'
    ? CARD_CONTRACT.filter((c) => c.tier === 'all' || c.tier === 'paid')
    : CARD_CONTRACT.filter((c) => c.tier === 'all');

  const analyzerOutputs = {};

  // Convenience: swallow any emitter failures so a bad terminal write
  // never breaks skill execution.
  const emit = async (stage, label, extra = {}) => {
    if (!onProgress) return;
    try { await onProgress(stage, label, extra); } catch { /* non-fatal */ }
  };

  await Promise.allSettled(
    cards.map(async (card) => {
      const skillIds = getSkillIdsForCard(card);
      if (!skillIds.length) return;

      // Run all skills for this card in parallel
      const settled = await Promise.allSettled(
        skillIds.map(async (skillId) => {
          await emit(skillId, `Running ${skillId}…`, { cardId: card.id });
          try {
            const result = await runSkill(skillId, { card, sourcePayloads });
            await emit(skillId, result.ok
              ? `${skillId} complete`
              : `${skillId} failed: ${result.error || 'unknown'}`,
              { cardId: card.id, ok: !!result.ok }
            );
            return { skillId, result };
          } catch (err) {
            await emit(skillId, `${skillId} threw: ${err.message}`, { cardId: card.id, ok: false });
            warnings.push({
              type: 'warning',
              code: 'skill_threw',
              message: `Skill '${skillId}' for card '${card.id}' threw: ${err.message}`,
              stage: 'skills',
            });
            return { skillId, result: { ok: false, output: null, runCostData: null, error: err.message } };
          }
        })
      );

      // Collect successful per-skill outputs
      const skillsById = {};
      for (const s of settled) {
        if (s.status !== 'fulfilled') continue;
        const { skillId, result } = s.value;
        if (result.ok) {
          skillsById[skillId] = result.output;
        } else {
          warnings.push({
            type: 'warning',
            code: 'skill_failed',
            message: `Skill '${skillId}' for card '${card.id}' failed: ${result.error}`,
            stage: 'skills',
          });
        }
      }

      if (Object.keys(skillsById).length === 0) return; // all skills failed

      // New shape: { skills, aggregate }
      // aggregate collapses single- and multi-skill outputs into one consistent blob.
      analyzerOutputs[card.id] = {
        skills:    skillsById,
        aggregate: aggregateCardSkills(skillsById),
      };
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
