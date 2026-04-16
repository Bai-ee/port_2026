'use strict';

// _output-contract.js — Standard output shape + validator for analyzer skills.
//
// Every skill must return this shape. Invalid output = skill failure = non-fatal
// fallback to existing analyzer-impl signals.
//
// Shape enforced:
// {
//   skillId:      string
//   skillVersion: number
//   runAt:        ISO string
//   findings:     [{ id, severity, label, detail, citation }]
//   gaps:         [{ ruleId, triggered, evidence }]
//   readiness:    'healthy' | 'partial' | 'critical'
//   highlights:   string[]
//   metadata:     { model, inputTokens, outputTokens, estimatedCostUsd }
// }

const VALID_SEVERITIES = new Set(['critical', 'warning', 'info']);
const VALID_READINESS  = new Set(['healthy', 'partial', 'critical']);

/**
 * Validate an analyzer skill output object.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 *
 * @param {unknown} output
 * @returns {{ valid: boolean, errors?: string[] }}
 */
function validateSkillOutput(output) {
  if (!output || typeof output !== 'object') {
    return { valid: false, errors: ['output must be a non-null object'] };
  }

  const errors = [];

  if (typeof output.skillId !== 'string' || !output.skillId) {
    errors.push('skillId must be a non-empty string');
  }
  if (typeof output.skillVersion !== 'number') {
    errors.push('skillVersion must be a number');
  }
  if (typeof output.runAt !== 'string' || !output.runAt) {
    errors.push('runAt must be a non-empty ISO string');
  }

  // findings[]
  if (!Array.isArray(output.findings)) {
    errors.push('findings must be an array');
  } else {
    output.findings.forEach((f, i) => {
      if (!f || typeof f !== 'object') {
        errors.push(`findings[${i}] must be an object`);
        return;
      }
      if (typeof f.id !== 'string' || !f.id)         errors.push(`findings[${i}].id missing`);
      if (!VALID_SEVERITIES.has(f.severity))          errors.push(`findings[${i}].severity invalid: '${f.severity}'`);
      if (typeof f.label !== 'string' || !f.label)    errors.push(`findings[${i}].label missing`);
      if (typeof f.detail !== 'string')               errors.push(`findings[${i}].detail must be a string`);
      if (typeof f.citation !== 'string')             errors.push(`findings[${i}].citation must be a string`);
    });
  }

  // gaps[]
  if (!Array.isArray(output.gaps)) {
    errors.push('gaps must be an array');
  } else {
    output.gaps.forEach((g, i) => {
      if (!g || typeof g !== 'object') {
        errors.push(`gaps[${i}] must be an object`);
        return;
      }
      if (typeof g.ruleId !== 'string' || !g.ruleId)  errors.push(`gaps[${i}].ruleId missing`);
      if (typeof g.triggered !== 'boolean')            errors.push(`gaps[${i}].triggered must be boolean`);
      if (typeof g.evidence !== 'string')              errors.push(`gaps[${i}].evidence must be a string`);
    });
  }

  // readiness
  if (!VALID_READINESS.has(output.readiness)) {
    errors.push(`readiness must be one of: ${[...VALID_READINESS].join(', ')}`);
  }

  // highlights
  if (!Array.isArray(output.highlights)) {
    errors.push('highlights must be an array');
  }

  // metadata
  if (!output.metadata || typeof output.metadata !== 'object') {
    errors.push('metadata must be an object');
  } else {
    const m = output.metadata;
    if (typeof m.model !== 'string')              errors.push('metadata.model must be a string');
    if (typeof m.inputTokens !== 'number')        errors.push('metadata.inputTokens must be a number');
    if (typeof m.outputTokens !== 'number')       errors.push('metadata.outputTokens must be a number');
    if (typeof m.estimatedCostUsd !== 'number')   errors.push('metadata.estimatedCostUsd must be a number');
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

module.exports = { validateSkillOutput };
