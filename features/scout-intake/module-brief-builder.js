// module-brief-builder.js — deterministic per-module mini-briefs.
//
// Each intake module's raw result is condensed into a small, render-ready
// brief: { moduleId, title, section, status, summaryLine, stats[], highlights[],
// findings[], screenshots?, mockupUrl? }. Built from data the modules already
// produced — no LLM calls, no extra cost.
//
// Failures are first-class: a module that ran and failed, or an enabled module
// that never returned, still gets an entry (status 'failed' / 'missing') so the
// executive brief can say so explicitly instead of silently omitting it.
//
// `section` maps each module to the brief type it rolls up into:
//   performance → Performance Brief (SEO/perf, agent readiness)
//   creative    → Creative Brief (device rendering, design system, design eval, share card)
//
// Consumers:
//   - worker (run-brief route): writes the array to dashboard_state.moduleBriefs
//   - runtime.js (scout-brief pipeline): folds the prompt block into Scribe
//   - brief-preview route: renders the Performance/Creative Brief sections of
//     the executive brief from the same array

const MAX_FINDINGS_PER_MODULE = 6;
const MAX_HIGHLIGHTS_PER_MODULE = 4;

const MODULE_META = {
  'seo-performance':   { title: 'SEO + Performance',    section: 'performance' },
  'agent-readiness':   { title: 'AI Agent Readiness',   section: 'performance' },
  'multi-device-view': { title: 'Cross-Device Layouts', section: 'creative' },
  'social-preview':    { title: 'Social Share Card',    section: 'creative' },
  'style-guide':       { title: 'Brand Snapshot',       section: 'creative' },
  'design-evaluation': { title: 'Design Evaluation',    section: 'creative' },
};

function clip(value, max = 220) {
  const s = String(value || '').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function pickFindings(aggregate) {
  if (!aggregate || !Array.isArray(aggregate.findings)) return [];
  return aggregate.findings.slice(0, MAX_FINDINGS_PER_MODULE).map((f) => ({
    severity: f?.severity || 'info',
    label: clip(f?.label, 90),
    detail: clip(f?.detail || f?.impact, 200),
  }));
}

function pickHighlights(list) {
  return (Array.isArray(list) ? list : [])
    .slice(0, MAX_HIGHLIGHTS_PER_MODULE)
    .map((h) => clip(h, 160))
    .filter(Boolean);
}

function briefSeoPerformance(result) {
  const facts = result?.pagespeed?.facts || null;
  const scores = facts?.scores || {};
  const aggregate = result?.skillAggregate || null;
  const stats = [];
  if (typeof scores.performance === 'number') stats.push({ k: 'Performance', v: `${scores.performance}/100` });
  if (typeof scores.seo === 'number') stats.push({ k: 'SEO', v: `${scores.seo}/100` });
  if (typeof scores.accessibility === 'number') stats.push({ k: 'Accessibility', v: `${scores.accessibility}/100` });
  if (typeof scores.bestPractices === 'number') stats.push({ k: 'Best practices', v: `${scores.bestPractices}/100` });
  const audited = facts && facts.auditStatus !== 'error';
  const summaryLine = audited
    ? `PageSpeed + AI SEO audit complete${typeof scores.performance === 'number' ? ` — performance ${scores.performance}/100, SEO ${scores.seo ?? '—'}/100` : ''}.`
    : 'AI SEO audit complete — PageSpeed could not profile this site this run.';
  const findings = pickFindings(aggregate);
  // The PSI gap is a stated finding, never a silent omission. PAGE_HUNG-class
  // failures usually mean the page never goes idle under Lighthouse (heavy
  // animation/WebGL main-thread work) — that itself is a performance signal.
  if (!audited) {
    findings.unshift({
      severity: 'warning',
      label: 'PageSpeed (Lighthouse) could not complete',
      detail: 'Google’s auditor gave up before the page went idle — typically continuous animation/WebGL keeping the main thread busy. Real-user scores unavailable until the page yields at load.',
    });
  }
  return {
    summaryLine,
    stats,
    highlights: pickHighlights(aggregate?.highlights),
    findings,
    readiness: aggregate?.readiness || null,
  };
}

function briefAgentReadiness(result) {
  const ar = result?.agentReadiness || null;
  if (!ar) return null;
  const stats = [];
  if (typeof ar.score === 'number') stats.push({ k: 'Agent readiness score', v: `${ar.score}/100` });
  if (ar.readiness) stats.push({ k: 'Readiness', v: clip(ar.readiness, 60) });
  return {
    summaryLine: clip(ar.verdict, 220) || 'AI agent / crawler access checks complete.',
    stats,
    highlights: pickHighlights(ar.highlights),
    findings: (Array.isArray(ar.findings) ? ar.findings : []).slice(0, MAX_FINDINGS_PER_MODULE).map((f) => ({
      severity: f?.severity || 'info',
      label: clip(f?.label || f?.check || f?.id, 90),
      detail: clip(f?.detail || f?.impact || f?.summary, 200),
    })),
    readiness: ar.readiness || null,
  };
}

function briefMultiDeviceView(result) {
  const screenshots = {
    desktop: result?.desktopUrl || null,
    tablet: result?.tabletUrl || null,
    mobile: result?.mobileUrl || null,
  };
  const captured = Object.values(screenshots).filter(Boolean).length;
  if (!captured && !result?.mockupUrl) return null;
  return {
    summaryLine: `Homepage captured across ${captured || 3} viewport${captured === 1 ? '' : 's'}${result?.mockupUrl ? ' with a composed device mockup' : ''}.`,
    stats: [],
    highlights: [],
    findings: [],
    screenshots,
    mockupUrl: result?.mockupUrl || null,
  };
}

function briefSocialPreview(result) {
  const meta = result?.siteMeta || null;
  if (!meta) return null;
  const has = (v) => Boolean(String(v || '').trim());
  const missing = [];
  if (!has(meta.ogTitle) && !has(meta.title)) missing.push('og:title');
  if (!has(meta.ogDescription) && !has(meta.description)) missing.push('og:description');
  if (!has(meta.ogImage)) missing.push('og:image');
  return {
    summaryLine: missing.length
      ? `Share-card metadata incomplete — missing ${missing.join(', ')}.`
      : 'Share-card metadata present — links unfurl with title, description, and image.',
    stats: [],
    highlights: [],
    findings: missing.map((tag) => ({
      severity: 'warning',
      label: `Missing ${tag}`,
      detail: `Links shared on social render without ${tag}.`,
    })),
  };
}

function briefStyleGuide(result) {
  const sg = result?.styleGuide || null;
  if (!sg) return null;
  const fontName = sg?.typography?.primaryFont || sg?.typography?.headingFont || null;
  const colorCount = Array.isArray(sg?.colors) ? sg.colors.length : Object.keys(sg?.colors || {}).length;
  return {
    summaryLine: `Design system extracted from the live site${fontName ? ` — primary type ${clip(fontName, 40)}` : ''}${colorCount ? `, ${colorCount} core color${colorCount === 1 ? '' : 's'}` : ''}.`,
    stats: [],
    highlights: [],
    findings: [],
  };
}

function briefDesignEvaluation(result) {
  const out = result?.analyzerOutput || null;
  if (!out) return null;
  return {
    summaryLine: clip(out?.notes || out?.summary, 220) || 'Visual design evaluation complete.',
    stats: [],
    highlights: pickHighlights(out?.highlights),
    findings: pickFindings(out),
  };
}

const BUILDERS = {
  'seo-performance': briefSeoPerformance,
  'agent-readiness': briefAgentReadiness,
  'multi-device-view': briefMultiDeviceView,
  'social-preview': briefSocialPreview,
  'style-guide': briefStyleGuide,
  'design-evaluation': briefDesignEvaluation,
};

function stub(moduleId, status, summaryLine) {
  const meta = MODULE_META[moduleId] || { title: moduleId, section: 'performance' };
  return {
    moduleId,
    title: meta.title,
    section: meta.section,
    status,
    summaryLine,
    stats: [],
    highlights: [],
    findings: [],
  };
}

/**
 * Build per-module mini-briefs from intake module results.
 *
 * Failed runs and enabled-but-absent modules produce explicit entries so the
 * executive brief names what could not be retrieved.
 *
 * @param {Array} moduleResults - runModules() results: [{ cardId, ok, result, errorCode }]
 * @param {object} [options]
 * @param {string[]} [options.expectedIds] - enabled module ids; any with no
 *   result at all are emitted as status 'missing'.
 * @returns {Array} briefs
 */
function buildModuleBriefs(moduleResults, { expectedIds = [] } = {}) {
  const briefs = [];
  const seen = new Set();
  for (const r of Array.isArray(moduleResults) ? moduleResults : []) {
    if (!r?.cardId || !MODULE_META[r.cardId]) continue;
    seen.add(r.cardId);
    if (!r.ok) {
      briefs.push(stub(
        r.cardId,
        'failed',
        `No results retrieved this run${r.errorCode ? ` (${r.errorCode})` : ''} — rerun this module from its card.`
      ));
      continue;
    }
    const build = BUILDERS[r.cardId];
    try {
      const brief = build(r.result || {});
      const meta = MODULE_META[r.cardId];
      if (brief) {
        briefs.push({ moduleId: r.cardId, title: meta.title, section: meta.section, status: 'ok', ...brief });
      } else {
        briefs.push(stub(r.cardId, 'failed', 'Module reported success but returned no usable data this run.'));
      }
    } catch {
      briefs.push(stub(r.cardId, 'failed', 'Result could not be summarized this run.'));
    }
  }
  for (const id of Array.isArray(expectedIds) ? expectedIds : []) {
    if (!MODULE_META[id] || seen.has(id)) continue;
    briefs.push(stub(id, 'missing', 'Module did not run this pass — no data to report.'));
  }
  return briefs;
}

/**
 * Compact prompt block for the executive-brief Scribe. Deterministic text,
 * capped so it can't crowd out Scout signals. Failures are named so the brief
 * can acknowledge gaps honestly.
 */
function buildWebsiteAuditPromptBlock(moduleBriefs) {
  const items = Array.isArray(moduleBriefs) ? moduleBriefs : [];
  if (!items.length) return '';
  const lines = items.map((b) => {
    if (b.status === 'failed' || b.status === 'missing') {
      return `- ${b.title}: NO DATA — ${b.summaryLine}`;
    }
    const parts = [b.summaryLine];
    if (b.stats?.length) parts.push(b.stats.map((s) => `${s.k}: ${s.v}`).join(', '));
    const top = (b.findings || []).slice(0, 2).map((f) => `${f.severity}: ${f.label}`);
    if (top.length) parts.push(`top findings — ${top.join('; ')}`);
    return `- ${b.title}: ${parts.filter(Boolean).join(' | ')}`;
  });
  return `WEBSITE AUDIT FINDINGS — from the client's own site intake (SEO/performance, AI agent readiness, device rendering, social metadata, design system):
${lines.join('\n').slice(0, 2600)}

These are first-party audit facts about the client's website. Where relevant, fold them into the brief's priority action or signals (e.g. a weak share-card or slow LCP is a concrete growth blocker worth naming). If a module reports NO DATA, acknowledge the gap rather than guessing. Do not invent scores or findings beyond what is listed.`;
}

module.exports = { buildModuleBriefs, buildWebsiteAuditPromptBlock, MODULE_META };
