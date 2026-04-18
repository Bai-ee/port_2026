// formatters/compare.js — Side-by-side comparison formatter.
//
// Supports --format=summary (two-column terminal) and --format=json.
// Pure functions — callable programmatically or from CLI.

// ── ANSI helpers (duplicated to keep formatter self-contained) ───────────────

const R = '\x1b[0m';
const ansi = {
  bold:   (s) => `\x1b[1m${s}${R}`,
  dim:    (s) => `\x1b[2m${s}${R}`,
  red:    (s) => `\x1b[31m${s}${R}`,
  yellow: (s) => `\x1b[33m${s}${R}`,
  green:  (s) => `\x1b[32m${s}${R}`,
  cyan:   (s) => `\x1b[36m${s}${R}`,
  gray:   (s) => `\x1b[90m${s}${R}`,
};

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function scoreBar(score, width) {
  const w      = width || 10;
  const filled = Math.round(Math.max(0, Math.min(100, score)) / (100 / w));
  return '█'.repeat(filled) + '░'.repeat(w - filled);
}

function statusIcon(status) {
  if (status === 'pass') return ansi.green('✓');
  if (status === 'warn') return ansi.yellow('⚠');
  return ansi.red('✗');
}

function deltaStr(delta) {
  if (delta == null) return ansi.dim('  —  ');
  if (delta > 0)  return ansi.green(`+${delta}`);
  if (delta < 0)  return ansi.red(String(delta));
  return ansi.dim(' 0  ');
}

const SECTION_ORDER = ['llmsTxt', 'robotsAi', 'schema', 'content', 'entity', 'technical'];
const SECTION_LABELS = {
  llmsTxt:   'llms.txt',
  robotsAi:  'Robots (AI)',
  schema:    'Schema',
  content:   'Content',
  entity:    'Entity',
  technical: 'Technical',
};

// ── Compute deltas ────────────────────────────────────────────────────────────

function computeDeltas(resultA, resultB) {
  const sectionsA = resultA?.aiVisibility?.sections || {};
  const sectionsB = resultB?.aiVisibility?.sections || {};
  const deltas = {
    score: (resultB?.aiVisibility?.score ?? 0) - (resultA?.aiVisibility?.score ?? 0),
    sections: {},
  };
  for (const key of SECTION_ORDER) {
    const a = sectionsA[key]?.score;
    const b = sectionsB[key]?.score;
    if (a != null && b != null) {
      deltas.sections[key] = b - a;
    }
  }
  return deltas;
}

// ── Competitive gap finding ids ───────────────────────────────────────────────
// Issues present in site A but NOT in site B (B is better — A has the problem, B doesn't).

function competitiveGaps(resultA, resultB) {
  const idsB = new Set(
    (resultB?.findings || [])
      .filter((f) => f.severity === 'critical' || f.severity === 'warning')
      .map((f) => f.id)
  );
  return (resultA?.findings || [])
    .filter((f) => (f.severity === 'critical' || f.severity === 'warning') && !idsB.has(f.id));
}

// ── JSON compare ──────────────────────────────────────────────────────────────

/**
 * @param {object|Error} resultA
 * @param {object|Error} resultB
 * @returns {string}
 */
export function formatJson(resultA, resultB) {
  const isErrA = resultA instanceof Error;
  const isErrB = resultB instanceof Error;
  const output = {
    siteA:  isErrA ? { error: resultA.message } : resultA,
    siteB:  isErrB ? { error: resultB.message } : resultB,
    deltas: (!isErrA && !isErrB) ? computeDeltas(resultA, resultB) : null,
  };
  return JSON.stringify(output, null, 2);
}

// ── Terminal compare ──────────────────────────────────────────────────────────

/**
 * @param {object|Error} resultA
 * @param {object|Error} resultB
 * @param {string} urlA
 * @param {string} urlB
 * @returns {string}
 */
export function formatSummary(resultA, resultB, urlA, urlB) {
  const termWidth  = process.stdout.columns || 80;
  const colWidth   = Math.floor(termWidth / 2) - 2;
  const lines      = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  const divLine = ansi.dim('═'.repeat(termWidth));
  lines.push(divLine);
  lines.push(padCol(ansi.bold('SITE A  ') + ansi.dim(shortUrl(urlA)), colWidth) + '  ' + ansi.bold('SITE B  ') + ansi.dim(shortUrl(urlB)));
  lines.push(divLine);
  lines.push('');

  // ── Score row ──────────────────────────────────────────────────────────────
  const scoreA = safeScore(resultA);
  const scoreB = safeScore(resultB);
  lines.push(
    padCol(
      ansi.bold('Score: ') + colorScore(scoreA) + '  ' + scoreBar(scoreA, 8),
      colWidth
    ) + '  ' +
    ansi.bold('Score: ') + colorScore(scoreB) + '  ' + scoreBar(scoreB, 8)
  );
  lines.push(
    padCol(
      ansi.bold('Grade: ') + gradeStr(resultA),
      colWidth
    ) + '  ' +
    ansi.bold('Grade: ') + gradeStr(resultB)
  );
  lines.push(
    padCol(
      ansi.bold('Status: ') + readinessStr(resultA),
      colWidth
    ) + '  ' +
    ansi.bold('Status: ') + readinessStr(resultB)
  );
  lines.push('');

  // ── Section breakdown with deltas ─────────────────────────────────────────
  lines.push(ansi.bold('Section Scores'));
  lines.push(ansi.dim('─'.repeat(termWidth)));

  const deltas = (!(resultA instanceof Error) && !(resultB instanceof Error))
    ? computeDeltas(resultA, resultB)
    : { sections: {} };

  for (const key of SECTION_ORDER) {
    const label = (SECTION_LABELS[key] || key).padEnd(12);
    const secA  = resultA?.aiVisibility?.sections?.[key];
    const secB  = resultB?.aiVisibility?.sections?.[key];
    const scA   = secA?.score ?? '—';
    const scB   = secB?.score ?? '—';
    const iconA = secA ? statusIcon(secA.status) : ansi.dim('·');
    const iconB = secB ? statusIcon(secB.status) : ansi.dim('·');
    const d     = deltas.sections[key];
    const delta = d != null ? ` ${deltaStr(d)}` : '';
    lines.push(
      padCol(`${iconA}  ${label}  ${String(scA).padStart(3)}`, colWidth) +
      `  ${iconB}  ${label}  ${String(scB).padStart(3)}${delta}`
    );
  }
  lines.push('');

  // ── Competitive gaps ───────────────────────────────────────────────────────
  if (!(resultA instanceof Error) && !(resultB instanceof Error)) {
    const gaps = competitiveGaps(resultA, resultB);
    if (gaps.length > 0) {
      lines.push(ansi.bold('Competitive Gaps') + ansi.dim(' (Site A has, Site B resolved)'));
      lines.push(ansi.dim('─'.repeat(termWidth)));
      for (const f of gaps) {
        const sev = f.severity === 'critical' ? ansi.red(`[${f.severity.toUpperCase()}]`) : ansi.yellow(`[${f.severity.toUpperCase()}]`);
        lines.push(`  ${sev}  ${f.id}  ${ansi.dim('—')}  ${f.label}`);
      }
      lines.push('');
    }
  }

  // ── Error display ──────────────────────────────────────────────────────────
  if (resultA instanceof Error || resultB instanceof Error) {
    lines.push(ansi.bold('Errors'));
    lines.push(ansi.dim('─'.repeat(termWidth)));
    if (resultA instanceof Error) lines.push(ansi.red(`  Site A: ${resultA.message}`));
    if (resultB instanceof Error) lines.push(ansi.red(`  Site B: ${resultB.message}`));
    lines.push('');
  }

  lines.push(ansi.dim('─'.repeat(termWidth)));
  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeScore(result) {
  if (result instanceof Error) return 0;
  return result?.aiVisibility?.score ?? 0;
}

function colorScore(score) {
  const s = String(score);
  if (score >= 75) return ansi.green(s);
  if (score >= 50) return ansi.yellow(s);
  return ansi.red(s);
}

function gradeStr(result) {
  if (result instanceof Error) return ansi.red('?');
  const g = result?.aiVisibility?.letterGrade ?? '?';
  const s = result?.aiVisibility?.score ?? 0;
  if (s >= 75) return ansi.green(g);
  if (s >= 50) return ansi.yellow(g);
  return ansi.red(g);
}

function readinessStr(result) {
  if (result instanceof Error) return ansi.red('error');
  const r = result?.readiness || 'unknown';
  if (r === 'critical') return ansi.red(r);
  if (r === 'partial')  return ansi.yellow(r);
  if (r === 'healthy')  return ansi.green(r);
  return ansi.dim(r);
}

function shortUrl(url) {
  if (!url) return '—';
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '').slice(0, 40);
}

/** Pad a string (with ANSI codes) to a visual width. */
function padCol(str, width) {
  const visual = stripAnsi(str).length;
  const pad    = Math.max(0, width - visual);
  return str + ' '.repeat(pad);
}
