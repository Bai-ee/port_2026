// seo-performance-adapter.mjs — Converts seoAudit + skill outputs → sections[]
// for renderMiniBriefHtml.
//
// Skill data lives at:
//   analyzerOutputs['seo-performance'].skills['seo-depth-audit']  — findings, highlights, readiness, gaps
//   analyzerOutputs['seo-performance'].skills['ai-seo-audit']     — findings, highlights, aiVisibility, rawSignals
//   analyzerOutputs['seo-performance'].aggregate                  — aggregate readiness
//
// PSI data lives at:
//   seoAudit.scores, seoAudit.coreWebVitals, seoAudit.labCoreWebVitals, seoAudit.opportunities

const SEV_MAP = { critical: 'high', warning: 'medium', high: 'high', medium: 'medium', low: 'low', info: 'info' };

function scoreStatus(v) {
  if (v == null) return 'neutral';
  if (v >= 90) return 'ok';
  if (v >= 50) return 'warn';
  return 'bad';
}

function verdictFrom(readiness) {
  if (!readiness) return 'partial';
  const r = String(readiness).toLowerCase();
  if (r.includes('ready') && !r.includes('not') && !r.includes('blocked')) return 'ready';
  if (r.includes('block') || r.includes('critical')) return 'blocked';
  return 'partial';
}

function mapFindings(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return [];
  return findings.map((f) => ({
    severity: SEV_MAP[f.severity] || 'info',
    text:     f.label || f.detail || 'Finding',
    detail:   f.label && f.detail ? f.detail : undefined,
  }));
}

/**
 * Converts SEO performance data into a sections[] payload for renderMiniBriefHtml.
 *
 * @param {{ seoAudit: object|null, aiVisibility: object|null, analyzerOutputs: object|null, siteName?: string }} opts
 */
export function seoPerformanceAdapter({ seoAudit, aiVisibility, analyzerOutputs, siteName } = {}) {
  const subtitle = `Search & visibility performance${siteName ? ` · ${siteName}` : ''}`;

  const scores      = seoAudit?.scores ?? null;
  const cwv         = seoAudit?.coreWebVitals ?? {};
  const lab         = seoAudit?.labCoreWebVitals ?? {};
  const opps        = Array.isArray(seoAudit?.opportunities) ? seoAudit.opportunities : [];

  const seoCard       = analyzerOutputs?.['seo-performance'] || null;
  const seoDepthAudit = seoCard?.skills?.['seo-depth-audit'] || null;
  const aiSeoAudit    = seoCard?.skills?.['ai-seo-audit']    || null;

  if (!seoAudit && !seoCard) {
    return {
      eyebrow:  'SEO Performance',
      title:    'Search & Visibility',
      subtitle,
      status:   'empty',
      sections: [],
    };
  }

  const sections = [];

  // ── Part 1: Lighthouse / PageSpeed Insights ──────────────────────────────

  // 1. Score tiles
  if (scores) {
    const scoreItems = [
      { label: 'Performance',    value: scores.performance,   status: scoreStatus(scores.performance) },
      { label: 'SEO',            value: scores.seo,           status: scoreStatus(scores.seo) },
      { label: 'Accessibility',  value: scores.accessibility, status: scoreStatus(scores.accessibility) },
      { label: 'Best Practices', value: scores.bestPractices, status: scoreStatus(scores.bestPractices) },
    ].filter((s) => s.value != null);
    if (scoreItems.length > 0) {
      sections.push({ type: 'score-block', eyebrow: 'Lighthouse · PageSpeed Insights', scores: scoreItems });
    }
  }

  // 2. Core Web Vitals bars (budget-consumed scale — full bar = at the slow threshold)
  const lcpMs  = cwv.lcp?.p75  ?? lab.lcp?.p75;
  const inpMs  = cwv.inp?.p75;
  const clsVal = cwv.cls?.p75  ?? lab.cls?.p75;
  const ttfbMs = cwv.ttfb?.p75 ?? lab.ttfb?.p75;
  const cwvItems = [
    lcpMs  != null && { name: 'LCP',  value: parseFloat((lcpMs / 1000).toFixed(1)), max: 4.0,  unit: 's'  },
    inpMs  != null && { name: 'INP',  value: inpMs,                                  max: 500,  unit: 'ms' },
    clsVal != null && { name: 'CLS',  value: parseFloat(Number(clsVal).toFixed(2)),  max: 0.25, unit: ''   },
    ttfbMs != null && { name: 'TTFB', value: ttfbMs,                                 max: 1800, unit: 'ms' },
  ].filter(Boolean);
  if (cwvItems.length > 0) {
    sections.push({
      type:    'bars',
      eyebrow: 'Lighthouse · Core Web Vitals',
      title:   'Budget consumed — longer bar = closer to the slow threshold',
      items:   cwvItems,
    });
  }

  // 3. PSI performance opportunities
  if (opps.length > 0) {
    sections.push({
      type:    'finding-list',
      eyebrow: 'Lighthouse · Opportunities',
      title:   'Performance improvements flagged by PageSpeed',
      items:   opps.slice(0, 6).map((op, i) => {
        const ms       = op.savingsMs ?? 0;
        const severity = ms > 500 ? 'high' : ms > 200 ? 'medium' : 'low';
        return {
          severity,
          text:   op.title || `Opportunity ${i + 1}`,
          detail: ms > 0 ? `Est. savings: ${ms}ms` : undefined,
        };
      }),
    });
  }

  // ── Part 2: SEO Skill Evaluation ─────────────────────────────────────────

  // 4. Readiness verdict (synthesised by the SEO skill, not Lighthouse)
  const readiness = seoDepthAudit?.readiness || seoCard?.aggregate?.readiness || null;
  if (readiness) {
    const verdictWord = (readiness.split(/[\s,.!]+/)[0] || 'UNKNOWN').toUpperCase();
    sections.push({
      type:    'readiness',
      label:   verdictWord,
      verdict: verdictFrom(readiness),
      title:   readiness,
      description: (seoDepthAudit?.highlights?.[0] || aiSeoAudit?.highlights?.[0]) ?? undefined,
    });
  }

  // 5. SEO depth-audit skill findings
  const depthFindings = mapFindings(seoDepthAudit?.findings);
  if (depthFindings.length > 0) {
    sections.push({
      type:    'finding-list',
      eyebrow: 'SEO Skill · Depth Audit',
      title:   `${depthFindings.length} finding${depthFindings.length !== 1 ? 's' : ''} from SEO depth audit`,
      items:   depthFindings,
    });
  }

  // 6. AI SEO audit skill findings
  const aiFindings = mapFindings(aiSeoAudit?.findings);
  if (aiFindings.length > 0) {
    sections.push({
      type:    'finding-list',
      eyebrow: 'SEO Skill · AI Analysis',
      title:   `${aiFindings.length} AI-identified issue${aiFindings.length !== 1 ? 's' : ''}`,
      items:   aiFindings,
    });
  }

  // 7. AI SEO score tile (separate from PSI — this is the skill's visibility score)
  const aiScore = aiVisibility?.score ?? aiSeoAudit?.aiVisibility?.score ?? null;
  if (aiScore != null) {
    sections.push({
      type:    'score-block',
      eyebrow: 'SEO Skill · AI Visibility',
      scores:  [{ label: 'AI Visibility', value: aiScore, status: scoreStatus(aiScore) }],
    });
  }

  // 8. AI visibility highlights as a pull-quote (cross-skill synthesis)
  const aiHighlights = [
    ...(aiSeoAudit?.highlights  || []),
    ...(seoDepthAudit?.highlights || []),
  ].filter(Boolean).slice(0, 3);
  if (aiHighlights.length > 0) {
    sections.push({
      type:    'prose',
      eyebrow: 'SEO Skill · AI Visibility',
      title:   'LLM citation readiness',
      body:    aiHighlights.join(' '),
    });
  }

  const hasData = scores != null || cwvItems.length > 0 || depthFindings.length > 0 || aiFindings.length > 0 || opps.length > 0;

  return {
    eyebrow:  'SEO Performance',
    title:    'Search & Visibility',
    subtitle,
    status:   hasData ? 'ready' : 'partial',
    sections,
  };
}
