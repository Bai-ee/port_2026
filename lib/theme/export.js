// Export / import (contract §14). Round trip: importThemeJson(exportThemeJson(d))
// yields the same canonical definition and byte-identical toCss.

import { normalizeDefinition, parseDefinition } from './validate.js';
import { toCss } from './css.js';
import { toColorGuideMarkdown } from './guide.js';
import { buildReport, reportStatus } from './report.js';

/** Canonical JSON, 2-space indent, trailing newline. Never throws. */
export function exportThemeJson(def) {
  return `${JSON.stringify(normalizeDefinition(def), null, 2)}\n`;
}

export function importThemeJson(text) {
  return parseDefinition(text);
}

/**
 * { json, css, guideMarkdown, reportJson, status }.
 * `status` is 'draft' until the structure is sound and no required check fails,
 * then 'validated' (automated in-app checks only, never a conformance claim);
 * it is also written into meta.status of the exported JSON.
 */
export function buildExportBundle(def) {
  const canonical = normalizeDefinition(def);
  const report = buildReport(canonical);
  const status = reportStatus(report);
  const stamped = { ...canonical, meta: { ...canonical.meta, status } };
  return {
    json: exportThemeJson(stamped),
    css: toCss(stamped),
    guideMarkdown: toColorGuideMarkdown(stamped),
    reportJson: `${JSON.stringify(report, null, 2)}\n`,
    status,
  };
}
