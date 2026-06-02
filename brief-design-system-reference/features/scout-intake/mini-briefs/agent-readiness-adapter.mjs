// agent-readiness-adapter.mjs — Converts agent-readiness skill outputs → sections[]
// for renderMiniBriefHtml.
//
// Data lives at:
//   analyzerOutputs['agent-readiness'].skills['agent-readiness']  — score, dimensions, verdict, checks, findings, highlights
//   analyzerOutputs['agent-readiness'].skills['ai-seo-audit']     — aiVisibility.score, highlights

import { FIX_LIBRARY } from '../agent-ready/fix-library.mjs';

function scoreStatus(v) {
  if (v == null) return 'neutral';
  if (v >= 80) return 'ok';
  if (v >= 50) return 'warn';
  return 'bad';
}

function verdictFrom(readiness) {
  if (!readiness) return 'partial';
  const r = String(readiness).toLowerCase();
  if (r.includes('not') && r.includes('ready')) return 'blocked';
  if (r.includes('partial') || r.includes('partially')) return 'partial';
  if (r.includes('ready') && !r.includes('blocked')) return 'ready';
  if (r.includes('block') || r.includes('critical')) return 'blocked';
  return 'partial';
}

const DIMENSION_LABELS = {
  discoverability: 'Discoverability',
  accessibility:   'Accessibility',
  botAccess:       'Bot Access',
  capabilities:    'Capabilities',
};

/**
 * Converts agent-readiness data into a sections[] payload for renderMiniBriefHtml.
 *
 * @param {{ analyzerOutputs: object|null, siteName?: string }} opts
 */
export function agentReadinessAdapter({ analyzerOutputs, siteName } = {}) {
  const subtitle = `AI agent compatibility${siteName ? ` · ${siteName}` : ''}`;

  const card        = analyzerOutputs?.['agent-readiness'] || null;
  const agentData   = card?.skills?.['agent-readiness']    || null;
  const aiSeoData   = card?.skills?.['ai-seo-audit']       || null;

  if (!agentData && !aiSeoData) {
    return {
      eyebrow:  'Agent Readiness',
      title:    'AI Agent Readiness',
      subtitle,
      status:   'empty',
      sections: [],
    };
  }

  const sections = [];

  // 1. AI Visibility score (from ai-seo-audit skill)
  const aiScore = aiSeoData?.aiVisibility?.score ?? null;
  if (aiScore != null) {
    sections.push({
      type:    'score-block',
      eyebrow: 'AI SEO · Visibility Score',
      scores:  [{ label: 'AI Visibility', value: aiScore, status: scoreStatus(aiScore) }],
    });
  }

  // 2. Overall + per-dimension scores
  if (agentData?.score != null) {
    const scoreItems = [
      { label: 'Overall', value: Math.round(agentData.score), status: scoreStatus(agentData.score) },
    ];
    const dims = agentData.dimensions || {};
    for (const [key, val] of Object.entries(dims)) {
      if (val != null) {
        scoreItems.push({
          label:  DIMENSION_LABELS[key] || key,
          value:  Math.round(val),
          status: scoreStatus(val),
        });
      }
    }
    sections.push({
      type:    'score-block',
      eyebrow: 'Agent Readiness · Scores',
      scores:  scoreItems,
    });
  }

  // 3. Readiness verdict pill
  const verdict = agentData?.verdict || null;
  if (verdict) {
    sections.push({
      type:        'readiness',
      label:       verdict.toUpperCase(),
      verdict:     verdictFrom(verdict),
      title:       verdict,
      description: agentData?.highlights?.[0] ?? undefined,
    });
  }

  // 4. Failed / warned checks as finding-list
  const checks = Array.isArray(agentData?.checks) ? agentData.checks : [];
  const flaggedChecks = checks.filter((c) => c.status === 'fail' || c.status === 'warn');
  if (flaggedChecks.length > 0) {
    sections.push({
      type:    'finding-list',
      eyebrow: 'Agent Readiness · Checks',
      title:   `${flaggedChecks.length} check${flaggedChecks.length !== 1 ? 's' : ''} need attention`,
      items:   flaggedChecks.map((c) => {
        let detail;
        if (c.evidence && typeof c.evidence === 'object') {
          const parts = Object.entries(c.evidence)
            .filter(([, v]) => v != null && v !== false && v !== '')
            .map(([k, v]) => `${k}: ${v}`);
          detail = parts.length > 0 ? parts.join(' · ') : undefined;
        } else if (c.evidence) {
          detail = String(c.evidence);
        }
        return { severity: c.status === 'fail' ? 'high' : 'medium', text: c.id, detail };
      }),
    });
  }

  // 5. Fix blocks per failed/warned check (Phase 8: prefer LLM custom prompt, fall back to static)
  //    Each fix gets TWO blocks:
  //      A) Agent prompt  — the full instruction to paste into Claude Code / Cursor
  //      B) File snippet  — the drop-in file/config content
  const customFixes = agentData?.customFixes || {};
  for (const c of flaggedChecks) {
    const staticFix = c.fixId ? FIX_LIBRARY[c.fixId] : null;
    if (!staticFix) continue;
    const custom = c.fixId ? customFixes[c.fixId] : null;
    const isCustom = Boolean(custom?.prompt);

    // Block A — agent prompt (route this to Claude Code / Cursor)
    sections.push({
      type:     'code-block',
      eyebrow:  `${staticFix.title}${isCustom ? ' · AI-customised' : ''}`,
      title:    isCustom
        ? 'Custom prompt generated for your stack — paste into Claude Code or Cursor'
        : 'Paste into Claude Code or Cursor to implement this fix',
      body:     isCustom ? custom.prompt : staticFix.prompt,
      language: 'text',
    });

    // Block B — drop-in file/config snippet
    const snippetBody = isCustom ? (custom.snippet || staticFix.snippet) : staticFix.snippet;
    if (snippetBody && snippetBody !== (isCustom ? custom.prompt : staticFix.prompt)) {
      sections.push({
        type:     'code-block',
        eyebrow:  `${staticFix.title} · File to create`,
        title:    'Drop-in file content — copy and save to your repo',
        body:     snippetBody,
        language: 'text',
      });
    }
  }

  // 6. Cloudflare supplemental scan (Phase 7) — always render, even pre-rerun
  const cfFindings = Array.isArray(agentData?.cfFindings) ? agentData.cfFindings : [];
  const cfSignals  = agentData?.cfSignals || null;

  const cfItems = cfFindings.map((f) => ({
    severity: f.severity || 'info',
    text:     f.text,
    detail:   f.detail || undefined,
  }));

  if (cfSignals) {
    // Prepend a CDN status row if not already in findings
    const hasCdnRow = cfItems.some((f) => f.text?.toLowerCase().includes('cloudflare cdn'));
    if (!hasCdnRow) {
      cfItems.unshift({
        severity: cfSignals.onCloudflare ? 'info' : 'low',
        text:     cfSignals.onCloudflare ? 'Site is served via Cloudflare CDN' : 'No Cloudflare CDN detected',
        detail:   cfSignals.cacheStatus
          ? `Cache status: ${cfSignals.cacheStatus}`
          : cfSignals.onCloudflare
            ? 'cf-ray header confirmed'
            : 'Consider Cloudflare for DDoS protection and bot management',
      });
    }
    if (cfSignals.botManagement) {
      cfItems.push({ severity: 'info', text: 'Cloudflare Bot Management active', detail: 'cf-mitigated or cf-ipcountry header detected' });
    }
    if (cfSignals.radarRank?.rank) {
      cfItems.push({ severity: 'info', text: `Cloudflare Radar global rank: #${cfSignals.radarRank.rank.toLocaleString()}`, detail: undefined });
    }
  }

  sections.push({
    type:    'finding-list',
    eyebrow: 'Cloudflare · Infrastructure Scan',
    title:   cfSignals
      ? (cfSignals.radarAvailable
          ? 'CF header analysis + Radar API cross-check'
          : 'CF header analysis — add CLOUDFLARE_RADAR_API_TOKEN to enable Radar')
      : 'Rerun the card to populate Cloudflare scan data',
    items:   cfItems.length > 0 ? cfItems : [{
      severity: 'info',
      text:     'No Cloudflare data yet',
      detail:   'Cloudflare scan runs automatically on next card execution',
    }],
  });

  // 7. AI SEO highlights as prose
  const aiHighlights = (aiSeoData?.highlights || []).filter(Boolean).slice(0, 3);
  if (aiHighlights.length > 0) {
    sections.push({
      type:    'prose',
      eyebrow: 'AI SEO · Highlights',
      title:   'LLM citation readiness',
      body:    aiHighlights.join(' '),
    });
  }

  const hasData = agentData?.score != null || flaggedChecks.length > 0 || aiScore != null;

  return {
    eyebrow:  'Agent Readiness',
    title:    'AI Agent Readiness',
    subtitle,
    status:   hasData ? 'ready' : 'partial',
    sections,
  };
}
