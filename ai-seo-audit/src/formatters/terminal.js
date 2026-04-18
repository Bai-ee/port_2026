// formatters/terminal.js — Colored terminal summary report.
//
// Uses raw ANSI escape codes — no chalk, no deps.
// Pure function — callable programmatically or from CLI.

// ── ANSI helpers ─────────────────────────────────────────────────────────────

const R = '\x1b[0m';
const ansi = {
  bold:   (s) => `\x1b[1m${s}${R}`,
  dim:    (s) => `\x1b[2m${s}${R}`,
  red:    (s) => `\x1b[31m${s}${R}`,
  yellow: (s) => `\x1b[33m${s}${R}`,
  green:  (s) => `\x1b[32m${s}${R}`,
  blue:   (s) => `\x1b[34m${s}${R}`,
  cyan:   (s) => `\x1b[36m${s}${R}`,
  gray:   (s) => `\x1b[90m${s}${R}`,
  reset:  R,
};

// ── Score bar ─────────────────────────────────────────────────────────────────
// Width = 10 chars. Filled blocks = Math.round(score / 10).

function scoreBar(score) {
  const filled = Math.round(Math.max(0, Math.min(100, score)) / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// ── Status icon ───────────────────────────────────────────────────────────────

function statusIcon(status) {
  if (status === 'pass') return ansi.green('✓');
  if (status === 'warn') return ansi.yellow('⚠');
  return ansi.red('✗');
}

function severityIcon(severity) {
  if (severity === 'critical') return ansi.red('✗');
  if (severity === 'warning')  return ansi.yellow('⚠');
  return ansi.dim('·');
}

// ── Box drawing ───────────────────────────────────────────────────────────────

function box(lines, width) {
  const w = width || (process.stdout.columns || 60);
  const inner = w - 2; // account for ║ on each side
  const top    = '╔' + '═'.repeat(inner) + '╗';
  const bottom = '╚' + '═'.repeat(inner) + '╝';
  const rows   = lines.map((line) => '║  ' + line + ' '.repeat(Math.max(0, inner - 2 - stripAnsi(line).length)) + '║');
  return [top, ...rows, bottom].join('\n');
}

// Strip ANSI codes for length calculations
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// ── Divider ───────────────────────────────────────────────────────────────────

function divider(width) {
  return ansi.dim('─'.repeat(width || (process.stdout.columns || 60)));
}

// ── Section label map ─────────────────────────────────────────────────────────

const SECTION_LABELS = {
  llmsTxt:   'llms.txt       ',
  robotsAi:  'Robots (AI)    ',
  schema:    'Schema         ',
  content:   'Content        ',
  entity:    'Entity         ',
  technical: 'Technical      ',
};

const SECTION_ORDER = ['llmsTxt', 'robotsAi', 'schema', 'content', 'entity', 'technical'];

// ── Main formatter ────────────────────────────────────────────────────────────

/**
 * @param {object} result - Output of runAiSeoAudit
 * @returns {string}
 */
export function format(result) {
  const width  = process.stdout.columns || 60;
  const lines  = [];
  const av     = result.aiVisibility || {};
  const score  = av.score ?? 0;
  const grade  = av.letterGrade ?? '?';
  const status = result.readiness || 'unknown';
  const url    = result.rawSignals?.technical?.canonical || '';

  // ── Header box ────────────────────────────────────────────────────────────
  const header = [
    ansi.bold('AI VISIBILITY AUDIT'),
    ansi.dim(url ? `${url}` : ''),
  ].filter(Boolean);
  lines.push(box(header, width));
  lines.push('');

  // ── Overall score ─────────────────────────────────────────────────────────
  const bar    = scoreBar(score);
  const gradeColor = score >= 75 ? ansi.green(grade) : score >= 50 ? ansi.yellow(grade) : ansi.red(grade);
  const readinessBadge = status === 'critical' ? ansi.red(`[${status}]`) :
                         status === 'partial'  ? ansi.yellow(`[${status}]`) :
                                                 ansi.green(`[${status}]`);
  lines.push(`  ${ansi.bold('Score')}   ${ansi.bold(String(score))} / 100  ${bar}  Grade: ${gradeColor}  ${readinessBadge}`);
  lines.push('');

  // ── Section breakdown ─────────────────────────────────────────────────────
  lines.push(`  ${ansi.bold('Sections')}`);
  lines.push('  ' + divider(width - 2));

  const sections = av.sections || {};
  for (const key of SECTION_ORDER) {
    const sec    = sections[key];
    if (!sec) continue;
    const icon   = statusIcon(sec.status);
    const label  = SECTION_LABELS[key] || key.padEnd(15);
    const secBar = scoreBar(sec.score);
    const pct    = ansi.dim(`(${Math.round((sec.weight || 0) * 100)}%)`);
    lines.push(`  ${icon}  ${label}  ${ansi.bold(String(sec.score).padStart(3))} / 100  ${secBar}  ${pct}`);
  }
  lines.push('');

  // ── Findings ──────────────────────────────────────────────────────────────
  const findings = result.findings || [];
  if (findings.length > 0) {
    lines.push(`  ${ansi.bold(`Findings (${findings.length})`)}`);
    lines.push('  ' + divider(width - 2));
    for (const f of findings) {
      const icon  = severityIcon(f.severity);
      const sev   = f.severity === 'critical' ? ansi.red(`[${f.severity.toUpperCase()}]`) :
                    f.severity === 'warning'  ? ansi.yellow(`[${f.severity.toUpperCase()}]`) :
                                                ansi.dim(`[${f.severity.toUpperCase()}]`);
      lines.push(`  ${icon}  ${sev}  ${f.label}`);
    }
    lines.push('');
  }

  // ── Priority actions (top 3) ──────────────────────────────────────────────
  const actions = (result.priorityActions || []).slice(0, 3);
  if (actions.length > 0) {
    lines.push(`  ${ansi.bold('Priority Actions')}`);
    lines.push('  ' + divider(width - 2));
    for (const a of actions) {
      const sev = a.severity === 'critical' ? ansi.red(`[${a.severity.toUpperCase()}]`) :
                                              ansi.yellow(`[${a.severity.toUpperCase()}]`);
      lines.push(`  ${sev}  ${a.action}`);
    }
    lines.push('');
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push(ansi.dim(`  Audited: ${result.runAt || '—'}  ·  Engine: ${result.metadata?.model || 'native'}`));
  lines.push('');

  return lines.join('\n');
}
