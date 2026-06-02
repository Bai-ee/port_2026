// design-evaluation-adapter.mjs — Converts design-evaluation analyzer output
// + styleGuide tokens → sections[] for renderMiniBriefHtml.
//
// Input shape (from DashboardPage):
//   ev          — analyzerOutputs['design-evaluation'] (or null)
//   styleGuide  — visualIdentity.styleGuide (or null)
//   siteName    — hostname string (or empty)
//
// Output: the args object for renderMiniBriefHtml().

const SEV_MAP = { critical: 'high', warning: 'medium', info: 'info', low: 'low' };

// Human-readable labels for the known token verification paths emitted by the
// design-evaluation skill. Falls back to the raw path string if unknown.
const PATH_LABELS = {
  'synth.styleGuide.typography.headingSystem.fontFamily': 'Heading font family',
  'synth.styleGuide.typography.bodySystem.fontFamily':    'Body font family',
  'synth.styleGuide.colors.primary.hex':                  'Primary color',
  'synth.styleGuide.colors.secondary.hex':                'Secondary color',
  'synth.styleGuide.colors.neutral.hex':                  'Neutral color',
};

function verdictFrom(readiness) {
  if (!readiness) return 'partial';
  const r = String(readiness).toLowerCase();
  if (r.includes('ready') && !r.includes('not') && !r.includes('blocked')) return 'ready';
  if (r.includes('block') || r.includes('critical')) return 'blocked';
  return 'partial';
}

function buildStyleGuideRows(sg) {
  const rows = [];
  const head = sg.typography?.headingSystem;
  const body = sg.typography?.bodySystem;
  if (head?.fontFamily) rows.push({ k: 'Heading',   v: [head.fontFamily, head.fontWeight, head.fontSize].filter(Boolean).join(' · ') });
  if (body?.fontFamily) rows.push({ k: 'Body',       v: [body.fontFamily, body.fontSize].filter(Boolean).join(' · ') });
  if (sg.colors?.primary?.hex)   rows.push({ k: 'Primary',   v: sg.colors.primary.hex   + (sg.colors.primary.role   ? ` · ${sg.colors.primary.role}`   : '') });
  if (sg.colors?.secondary?.hex) rows.push({ k: 'Secondary', v: sg.colors.secondary.hex + (sg.colors.secondary.role ? ` · ${sg.colors.secondary.role}` : '') });
  if (sg.colors?.neutral?.hex)   rows.push({ k: 'Neutral',   v: sg.colors.neutral.hex   + (sg.colors.neutral.role   ? ` · ${sg.colors.neutral.role}`   : '') });
  const spacingVals = sg.spacing
    ? Object.values(sg.spacing).filter(Boolean).slice(0, 5).join(', ')
    : '';
  if (spacingVals) rows.push({ k: 'Spacing', v: spacingVals });
  return rows;
}

/**
 * Converts design-evaluation analyzer output + style guide tokens into a
 * sections[] payload for renderMiniBriefHtml.
 *
 * @param {{ ev: object|null, styleGuide: object|null, siteName?: string }} opts
 */
export function designEvaluationAdapter({ ev, styleGuide, siteName } = {}) {
  const subtitle = `Visual system assessment${siteName ? ` · ${siteName}` : ''}`;

  if (!ev) {
    return {
      eyebrow: 'Design Evaluation',
      title:   'Design Evaluation',
      subtitle,
      status:  'empty',
      sections: [],
    };
  }

  const findings      = Array.isArray(ev.findings)      ? ev.findings      : [];
  const highlights    = Array.isArray(ev.highlights)    ? ev.highlights    : [];
  const verifications = Array.isArray(ev.verifications) ? ev.verifications : [];
  const readiness     = ev.readiness || '';
  const sections      = [];

  // 1. Readiness verdict — first word becomes the Doto label
  const verdictWord = (readiness.split(/[\s,.!]+/)[0] || 'UNKNOWN').toUpperCase();
  sections.push({
    type:        'readiness',
    label:       verdictWord,
    verdict:     verdictFrom(readiness),
    title:       readiness || 'Design system assessment',
    description: highlights[0] || undefined,
  });

  // 2. Token verification split (confirmed vs. contradicted)
  if (verifications.length > 0) {
    const confirmed    = verifications.filter((v) =>  v.confirmed).map((v) => v.evidence || PATH_LABELS[v.path] || v.path);
    const contradicted = verifications.filter((v) => !v.confirmed).map((v) => v.evidence || PATH_LABELS[v.path] || v.path);
    sections.push({
      type:  'verification-list',
      eyebrow: 'Token Verification',
      title:   'Style guide tokens vs. live site',
      confirmed,
      contradicted,
    });
  }

  // 3. Additional highlights as a pull-quote prose block
  const extraHighlights = highlights.slice(1);
  if (extraHighlights.length > 0) {
    sections.push({
      type:    'prose',
      eyebrow: 'Overview',
      body:    extraHighlights.join(' '),
    });
  }

  // 4. Findings sorted by severity (critical → warning → info)
  if (findings.length > 0) {
    const SEV_ORDER = { critical: 0, warning: 1, info: 2, low: 3 };
    const sorted = [...findings].sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
    sections.push({
      type:    'finding-list',
      eyebrow: 'Findings',
      title:   `${findings.length} issue${findings.length !== 1 ? 's' : ''} identified`,
      items:   sorted.map((f) => ({
        severity: SEV_MAP[f.severity] || 'info',
        text:     f.label  || f.detail || 'Finding',
        detail:   f.label && f.detail ? f.detail : undefined,
      })),
    });
  }

  // 5. Style guide token summary (when styleGuide is populated)
  if (styleGuide) {
    const rows = buildStyleGuideRows(styleGuide);
    if (rows.length > 0) {
      sections.push({ type: 'stat-rows', eyebrow: 'Style Guide', title: 'Extracted design tokens', rows });
    }
  }

  const hasSubstantiveData = findings.length > 0 || verifications.length > 0 || highlights.length > 0;

  return {
    eyebrow:  'Design Evaluation',
    title:    'Design Evaluation',
    subtitle,
    status:   hasSubstantiveData ? 'ready' : 'partial',
    sections,
  };
}
