// design-md-renderer.mjs — Pure function that composes a DESIGN.md string from
// extracted style-guide tokens + design-evaluation skill findings.
//
// Spec reference: https://github.com/google-labs-code/design.md
//
// Input shape:
//   {
//     siteName?: string,
//     styleGuide: object|null,      // synth.styleGuide (from design-system-extractor)
//     skillOutput: object|null,     // design-evaluation skill output (standard contract)
//   }
//
// Output: DESIGN.md string (YAML front matter + markdown body).
// Deterministic — no LLM call, no randomness. Given the same inputs, returns
// the same string. Keep it that way so snapshot tests stay stable.

function safeString(v, fallback = '') {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function quoteYamlString(v) {
  // Hex values and anything with special chars get quoted.
  const s = String(v);
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return `"${s}"`;
  if (/[:#&*!|>'"%@`]/.test(s))      return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}

function renderColorsYaml(colors) {
  if (!colors || typeof colors !== 'object') return '';
  const out = ['colors:'];
  // DESIGN.md spec uses: primary, secondary, tertiary, neutral.
  const mapping = [
    ['primary',   colors.primary?.hex   || colors.primary],
    ['secondary', colors.secondary?.hex || colors.secondary],
    ['tertiary',  colors.tertiary?.hex  || colors.accent?.hex || colors.accent],
    ['neutral',   colors.neutral?.hex   || colors.background?.hex || colors.background],
  ];
  for (const [k, v] of mapping) {
    if (v) out.push(`  ${k}: ${quoteYamlString(v)}`);
  }
  return out.length > 1 ? out.join('\n') : '';
}

function renderTypographyYaml(typography) {
  if (!typography || typeof typography !== 'object') return '';
  const out = ['typography:'];
  const order = ['h1', 'h2', 'h3', 'body-md', 'body', 'label-caps', 'label'];
  const seen  = new Set();
  for (const key of order) {
    const t = typography[key];
    if (!t || typeof t !== 'object') continue;
    seen.add(key);
    out.push(`  ${key}:`);
    if (t.fontFamily) out.push(`    fontFamily: ${quoteYamlString(t.fontFamily)}`);
    if (t.fontSize)   out.push(`    fontSize: ${quoteYamlString(t.fontSize)}`);
    if (t.fontWeight) out.push(`    fontWeight: ${quoteYamlString(t.fontWeight)}`);
  }
  return out.length > 1 ? out.join('\n') : '';
}

function renderScalarMapYaml(label, obj) {
  if (!obj || typeof obj !== 'object') return '';
  const entries = Object.entries(obj).filter(([, v]) => v != null);
  if (!entries.length) return '';
  return [`${label}:`, ...entries.map(([k, v]) => `  ${k}: ${quoteYamlString(v)}`)].join('\n');
}

function renderFrontMatter({ siteName, styleGuide }) {
  const parts = ['---', `name: ${quoteYamlString(siteName || 'Untitled')}`];
  const sg = styleGuide || {};
  const colors  = renderColorsYaml(sg.colors);
  const typo    = renderTypographyYaml(sg.typography);
  const rounded = renderScalarMapYaml('rounded', sg.rounded || sg.radii);
  const spacing = renderScalarMapYaml('spacing', sg.spacing);
  if (colors)  parts.push(colors);
  if (typo)    parts.push(typo);
  if (rounded) parts.push(rounded);
  if (spacing) parts.push(spacing);
  parts.push('---');
  return parts.join('\n');
}

function renderOverview({ highlights }) {
  const lines = ['## Overview', ''];
  if (Array.isArray(highlights) && highlights.length) {
    lines.push('Design direction:');
    lines.push('');
    for (const h of highlights) lines.push(`- ${safeString(h)}`);
  } else {
    lines.push('_No overview synthesized — run the Design Evaluation skill to populate._');
  }
  return lines.join('\n');
}

function renderFindings({ findings }) {
  const lines = ['## Evaluation', ''];
  if (!Array.isArray(findings) || findings.length === 0) {
    lines.push('_No findings — either design is healthy or the skill has not run._');
    return lines.join('\n');
  }
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  const sorted = [...findings].sort(
    (a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9),
  );
  for (const f of sorted) {
    const sev   = safeString(f.severity, 'info').toUpperCase();
    const label = safeString(f.label, 'Finding');
    lines.push(`### [${sev}] ${label}`);
    lines.push('');
    if (f.detail)   lines.push(safeString(f.detail));
    if (f.citation) {
      lines.push('');
      lines.push(`_Source: \`${safeString(f.citation)}\`_`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

function renderReadiness({ readiness }) {
  const r = safeString(readiness, 'unknown');
  return `## Readiness\n\n\`${r}\``;
}

/**
 * Compose a DESIGN.md string.
 *
 * @param {object} args
 * @param {string} [args.siteName]
 * @param {object|null} [args.styleGuide]   - synth.styleGuide
 * @param {object|null} [args.skillOutput]  - design-evaluation skill output
 * @returns {string}
 */
export function renderDesignMd({ siteName, styleGuide = null, skillOutput = null } = {}) {
  const findings   = skillOutput?.findings   || [];
  const highlights = skillOutput?.highlights || [];
  const readiness  = skillOutput?.readiness  || 'unknown';

  return [
    renderFrontMatter({ siteName, styleGuide }),
    '',
    renderOverview({ highlights }),
    '',
    renderFindings({ findings }),
    '',
    renderReadiness({ readiness }),
    '',
  ].join('\n');
}

