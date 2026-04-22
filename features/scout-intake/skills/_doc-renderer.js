'use strict';

// _doc-renderer.js — Renders a skill's structured output into a
// markdown document + lightweight HTML view.
//
// Used by:
//   - runner.js (intake pipeline)           → persist to dashboard_state.artifacts
//   - api/dashboard/run-skill (on-demand)   → persist + return
//
// Output shape:
//   { markdown: string, html: string, title: string, filename: string }
//
// The renderer is deliberately generic — any skill output conforming to
// _output-contract.js (findings, gaps, readiness, highlights, metadata) can
// be rendered without skill-specific code.

const SEVERITY_LABEL = {
  critical: 'Critical',
  warning:  'Warning',
  info:     'Info',
};

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

const READINESS_LABEL = {
  healthy:  'Healthy',
  partial:  'Partial',
  critical: 'Critical',
};

function esc(str) {
  return String(str || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function humanize(id) {
  return String(id || '')
    .split(/[-_]/)
    .map((p) => (p.length ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');
}

/**
 * Render a skill output into markdown.
 * @param {object} output - Skill output (validated against _output-contract.js)
 * @param {object} [opts]
 * @param {string} [opts.siteUrl]  - Website the audit was run against
 * @param {string} [opts.cardId]   - Dashboard card the skill belongs to
 */
function renderSkillMarkdown(output, { siteUrl = '', cardId = '' } = {}) {
  if (!output || typeof output !== 'object') {
    return '# Skill output unavailable\n\nNo output was produced.\n';
  }

  const skillId     = output.skillId     || 'unknown-skill';
  const skillVersion = output.skillVersion || 1;
  const runAt       = output.runAt       || new Date().toISOString();
  const findings    = Array.isArray(output.findings) ? [...output.findings] : [];
  const gaps        = Array.isArray(output.gaps) ? output.gaps : [];
  const readiness   = output.readiness   || 'partial';
  const highlights  = Array.isArray(output.highlights) ? output.highlights : [];
  const metadata    = output.metadata    || {};

  // Sort findings: critical → warning → info
  findings.sort((a, b) => (SEVERITY_ORDER[a?.severity] ?? 9) - (SEVERITY_ORDER[b?.severity] ?? 9));

  const lines = [];
  lines.push(`# ${humanize(skillId)}`);
  lines.push('');
  if (siteUrl) lines.push(`**Site:** ${siteUrl}  `);
  if (cardId)  lines.push(`**Card:** ${cardId}  `);
  lines.push(`**Readiness:** ${READINESS_LABEL[readiness] || readiness}  `);
  lines.push(`**Run at:** ${runAt}  `);
  lines.push(`**Skill version:** ${skillVersion}`);
  lines.push('');

  if (highlights.length) {
    lines.push('## Highlights');
    lines.push('');
    for (const h of highlights) lines.push(`- ${h}`);
    lines.push('');
  }

  if (findings.length) {
    lines.push(`## Findings (${findings.length})`);
    lines.push('');
    for (const f of findings) {
      const sev = SEVERITY_LABEL[f?.severity] || 'Info';
      lines.push(`### [${sev}] ${f?.label || '(no label)'}`);
      lines.push('');
      if (f?.detail)      lines.push(f.detail);
      if (f?.impact)      lines.push(`\n**Impact:** ${f.impact}`);
      if (f?.remediation) lines.push(`\n**Remediation:** ${f.remediation}`);
      if (f?.citation)    lines.push(`\n_Source: ${f.citation}_`);
      lines.push('');
    }
  } else {
    lines.push('## Findings');
    lines.push('');
    lines.push('_No findings reported._');
    lines.push('');
  }

  const triggeredGaps = gaps.filter((g) => g?.triggered);
  if (triggeredGaps.length) {
    lines.push(`## Gaps (${triggeredGaps.length})`);
    lines.push('');
    for (const g of triggeredGaps) {
      lines.push(`- **${g.ruleId}** — ${g.evidence || '(no evidence)'}`);
    }
    lines.push('');
  }

  lines.push('## Run metadata');
  lines.push('');
  if (metadata.model)            lines.push(`- Model: \`${metadata.model}\``);
  if (metadata.inputTokens != null)  lines.push(`- Input tokens: ${metadata.inputTokens}`);
  if (metadata.outputTokens != null) lines.push(`- Output tokens: ${metadata.outputTokens}`);
  if (metadata.estimatedCostUsd != null) lines.push(`- Estimated cost: $${Number(metadata.estimatedCostUsd).toFixed(4)}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Minimal markdown → HTML converter. Handles headings, bullets, bold, italics,
 * inline code, and paragraphs — enough for skill docs. No external deps.
 */
function markdownToHtml(md) {
  const lines = md.split('\n');
  const out = [];
  let inList = false;

  const flushList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  const inline = (s) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  for (const line of lines) {
    if (/^### /.test(line))      { flushList(); out.push(`<h3>${inline(line.slice(4))}</h3>`); }
    else if (/^## /.test(line))  { flushList(); out.push(`<h2>${inline(line.slice(3))}</h2>`); }
    else if (/^# /.test(line))   { flushList(); out.push(`<h1>${inline(line.slice(2))}</h1>`); }
    else if (/^- /.test(line))   { if (!inList) { out.push('<ul>'); inList = true; } out.push(`<li>${inline(line.slice(2))}</li>`); }
    else if (line.trim() === '') { flushList(); out.push(''); }
    else                         { flushList(); out.push(`<p>${inline(line)}</p>`); }
  }
  flushList();
  return out.join('\n');
}

/**
 * Renders a self-contained HTML document (inline CSS, no external deps).
 */
function wrapHtml({ title, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 780px; margin: 40px auto; padding: 0 20px; line-height: 1.55; color: #1a1a1a; }
  h1 { font-size: 28px; border-bottom: 1px solid #e5e5e5; padding-bottom: 8px; margin-top: 0; }
  h2 { font-size: 20px; margin-top: 32px; }
  h3 { font-size: 16px; margin-top: 24px; }
  p  { margin: 8px 0; }
  ul { padding-left: 20px; }
  li { margin: 4px 0; }
  strong { color: #000; }
  em { color: #555; }
  code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-size: 90%; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * High-level: render a full document from a skill output.
 * @returns {{ markdown, html, title, filename }}
 */
function renderSkillDoc(output, opts = {}) {
  const skillId = output?.skillId || 'skill';
  const title   = `${humanize(skillId)} — Report`;
  const markdown = renderSkillMarkdown(output, opts);
  const bodyHtml = markdownToHtml(markdown);
  const html     = wrapHtml({ title, bodyHtml });
  const stamp    = (output?.runAt || new Date().toISOString()).replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${skillId}__${stamp}.html`;

  return { markdown, html, title, filename };
}

module.exports = {
  renderSkillDoc,
  renderSkillMarkdown,
  markdownToHtml,
  wrapHtml,
};
