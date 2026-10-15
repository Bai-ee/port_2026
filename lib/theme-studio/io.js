// Import / export presentation helpers (pure). The engine (lib/theme) does the
// real work; this layer decides labels, filenames and what the UI may claim.

import { reportStatus, CONTRAST_STATEMENT } from '../theme/index.js';

export function slugify(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'theme';
}

/** What the export panel may say: in-app checks only, never a conformance claim. */
export function exportBanner(report) {
  if (!report) {
    return { status: 'draft', tone: 'neutral', title: 'Draft', detail: 'Checking the draft against the in-app contrast rules.' };
  }
  const status = reportStatus(report);
  const { failRequired, advisoryFail } = report.summary;
  if (status === 'validated') {
    return {
      status,
      tone: 'ok',
      title: 'Validated against the in-app checks',
      detail: `No required contrast check fails${advisoryFail ? ` (${advisoryFail} advisory ${advisoryFail === 1 ? 'finding' : 'findings'} remain)` : ''}. ${CONTRAST_STATEMENT}`,
    };
  }
  const errs = report.structure.errors.length;
  const parts = [];
  if (failRequired) parts.push(`${failRequired} required ${failRequired === 1 ? 'check fails' : 'checks fail'}`);
  if (errs) parts.push(`${errs} structure ${errs === 1 ? 'error' : 'errors'}`);
  return {
    status,
    tone: 'warn',
    title: 'Draft',
    detail: `${parts.join(' and ') || 'Not yet validated'}. The validation report is included in the export. ${CONTRAST_STATEMENT}`,
  };
}

/** Files for the export section. The status is part of every filename. */
export function bundleFiles(bundle, meta = {}) {
  const base = `${slugify(meta.id || meta.name)}`;
  const tag = bundle && bundle.status === 'validated' ? 'validated' : 'draft';
  return [
    { key: 'json', label: 'Theme JSON', filename: `${base}.${tag}.theme.json`, mime: 'application/json', content: bundle.json },
    { key: 'css', label: 'CSS', filename: `${base}.${tag}.theme.css`, mime: 'text/css', content: bundle.css },
    { key: 'guide', label: 'Color guide', filename: `${base}.${tag}.color-guide.md`, mime: 'text/markdown', content: bundle.guideMarkdown },
    { key: 'report', label: 'Validation report', filename: `${base}.${tag}.report.json`, mime: 'application/json', content: bundle.reportJson },
  ];
}

const MAX_SHOWN = 40;

/** Turn a ValidationResult into something the import panel renders verbatim. */
export function describeImport(result) {
  if (!result) return null;
  const errors = result.errors || [];
  const warnings = result.warnings || [];
  const ok = !!(result.ok && result.definition);
  let headline;
  if (!ok) headline = `Cannot import: ${errors.length} ${errors.length === 1 ? 'error' : 'errors'}.`;
  else if (warnings.length) headline = `Valid, with ${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}. Review before loading.`;
  else headline = 'Valid theme file.';
  return {
    ok,
    canLoad: ok,
    headline,
    errors: errors.slice(0, MAX_SHOWN),
    warnings: warnings.slice(0, MAX_SHOWN),
    hiddenErrors: Math.max(0, errors.length - MAX_SHOWN),
    hiddenWarnings: Math.max(0, warnings.length - MAX_SHOWN),
    name: ok ? result.definition.meta.name : null,
  };
}

/** Filter color-guide rows by token, usage, group or value. */
export function filterGuideRows(rows, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => (
    r.token.toLowerCase().includes(q)
    || r.usage.toLowerCase().includes(q)
    || r.group.toLowerCase().includes(q)
    || r.light.hex.toLowerCase().includes(q)
    || r.dark.hex.toLowerCase().includes(q)
  ));
}
