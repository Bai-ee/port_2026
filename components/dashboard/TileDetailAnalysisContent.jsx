'use client';

import React, { useMemo } from 'react';
import { buildSolutionsList, resolveSolution } from '../../features/scout-intake/solutions-catalog.mjs';
import { renderDesignMd } from '../../features/scout-intake/design-md-renderer.mjs';
import { renderMiniBriefHtml } from '../../features/scout-intake/mini-brief-renderer.mjs';
import { designEvaluationAdapter } from '../../features/scout-intake/mini-briefs/design-evaluation-adapter.mjs';
import { seoPerformanceAdapter } from '../../features/scout-intake/mini-briefs/seo-performance-adapter.mjs';
import { socialPreviewAdapter } from '../../features/scout-intake/mini-briefs/social-preview-adapter.mjs';
import { agentReadinessAdapter } from '../../features/scout-intake/mini-briefs/agent-readiness-adapter.mjs';

const SKILL_DOC_BY_CARD = { 'seo-performance': 'seo-depth-audit' };

function getSiteName(client) {
  const raw = client?.websiteUrl || client?.name || '';
  if (!raw) return '';
  try {
    return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '');
  } catch {
    return String(raw).split('?')[0];
  }
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TileDetailAnalysisContent({
  modalTab,
  activeTileModal,
  client,
  styleGuideData,
  analyzerOutputs,
  dashboardState,
  siteMeta,
  seoAudit,
  moduleRunLoading,
  handleModuleRun,
}) {
  if (!activeTileModal || !['report', 'solutions', 'problems'].includes(modalTab)) {
    return null;
  }

  const siteName = useMemo(() => getSiteName(client), [client]);

  const designEvalMiniBriefHtml = useMemo(() => (
    renderMiniBriefHtml(designEvaluationAdapter({
      ev: analyzerOutputs?.['design-evaluation'] || null,
      styleGuide: styleGuideData,
      siteName,
    }))
  ), [analyzerOutputs, styleGuideData, siteName]);

  const seoMiniBriefHtml = useMemo(() => (
    renderMiniBriefHtml(seoPerformanceAdapter({
      seoAudit: seoAudit || null,
      analyzerOutputs,
      siteName,
    }))
  ), [seoAudit, analyzerOutputs, siteName]);

  const socialMiniBriefHtml = useMemo(() => (
    renderMiniBriefHtml(socialPreviewAdapter({
      siteMeta: siteMeta ?? null,
      siteName,
    }))
  ), [siteMeta, siteName]);

  const agentReadinessMiniBriefHtml = useMemo(() => (
    renderMiniBriefHtml(agentReadinessAdapter({
      analyzerOutputs,
      siteName,
    }))
  ), [analyzerOutputs, siteName]);

  const designReportMd = useMemo(() => (
    renderDesignMd({
      siteName,
      styleGuide: styleGuideData,
      skillOutput: analyzerOutputs?.['design-evaluation'] || null,
    })
  ), [siteName, styleGuideData, analyzerOutputs]);

  const designSolutionsMd = useMemo(() => {
    if (activeTileModal.cardId !== 'design-evaluation') return '';
    return renderDesignMd({
      siteName: siteName || 'Untitled',
      styleGuide: styleGuideData,
      skillOutput: activeTileModal.analyzer,
    });
  }, [activeTileModal.cardId, activeTileModal.analyzer, siteName, styleGuideData]);

  if (modalTab === 'report') {
    if (activeTileModal.cardId === 'design-evaluation') {
      return (
        <div className="tile-detail-tab-pane" id="design-eval-report-pane" style={{ display: 'flex', flexDirection: 'column', padding: 0, height: '100%' }}>
          {analyzerOutputs?.['design-evaluation'] && (
            <div id="design-eval-report-toolbar" style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 8px', flexShrink: 0 }}>
              <button
                id="design-eval-report-download-btn"
                type="button"
                className="tile-solution-expert-cta"
                onClick={() => downloadTextFile(designReportMd, 'DESIGN.md', 'text/markdown;charset=utf-8')}
                style={{ cursor: 'pointer', border: 'none' }}
              >Download DESIGN.md ↓</button>
            </div>
          )}
          <iframe
            key={`de-report-${dashboardState?.latestRunId || 'static'}`}
            id="design-eval-report-iframe"
            title="Design Evaluation brief"
            srcDoc={designEvalMiniBriefHtml}
            sandbox="allow-same-origin"
            style={{ flex: 1, width: '100%', border: 'none', minHeight: 0, display: 'block' }}
          />
        </div>
      );
    }

    if (activeTileModal.cardId === 'seo-performance') {
      return (
        <div className="tile-detail-tab-pane" id="seo-perf-report-pane" style={{ padding: 0, height: '100%' }}>
          <iframe
            key={`seo-report-${dashboardState?.latestRunId || 'static'}`}
            id="seo-perf-report-iframe"
            title="SEO Performance brief"
            srcDoc={seoMiniBriefHtml}
            sandbox="allow-same-origin"
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          />
        </div>
      );
    }

    if (activeTileModal.cardId === 'social-preview') {
      return (
        <div className="tile-detail-tab-pane" id="social-preview-report-pane" style={{ padding: 0, height: '100%' }}>
          <iframe
            key={`social-report-${dashboardState?.latestRunId || 'static'}`}
            id="social-preview-report-iframe"
            title="Social Preview brief"
            srcDoc={socialMiniBriefHtml}
            sandbox="allow-same-origin"
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          />
        </div>
      );
    }

    if (activeTileModal.cardId === 'agent-readiness') {
      return (
        <div className="tile-detail-tab-pane" id="agent-readiness-report-pane" style={{ padding: 0, height: '100%' }}>
          <iframe
            key={`agent-readiness-report-${dashboardState?.latestRunId || 'static'}`}
            id="agent-readiness-report-iframe"
            title="Agent Readiness brief"
            srcDoc={agentReadinessMiniBriefHtml}
            sandbox="allow-same-origin"
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          />
        </div>
      );
    }

    const skillId = SKILL_DOC_BY_CARD[activeTileModal.cardId];
    const doc = dashboardState?.artifacts?.skillDocs?.[skillId] || null;
    if (!doc) {
      return (
        <div className="tile-detail-tab-pane">
          <p className="tile-analyzer-solutions-empty">Report not generated yet. Run the card to produce one.</p>
        </div>
      );
    }

    const isRerunning = !!moduleRunLoading?.[activeTileModal.cardId];

    const downloadDoc = async (format) => {
      try {
        const auth = (typeof window !== 'undefined' && window.__auth) || null;
        const token = await auth?.currentUser?.getIdToken?.();
        if (!token) {
          window.alert('Sign-in required to download.');
          return;
        }
        const response = await fetch(`/api/dashboard/skill-doc?skillId=${encodeURIComponent(skillId)}&format=${format}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          window.alert(`Download failed: ${response.status}`);
          return;
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = (doc.filename || `${skillId}.html`).replace(/\.html?$/i, format === 'md' ? '.md' : '.html');
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        window.alert(`Download error: ${err?.message || 'unknown'}`);
      }
    };

    return (
      <div className="tile-detail-tab-pane">
        <div id={`${activeTileModal.cardId}-report-toolbar`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            {doc.title} · {new Date(doc.runAt).toLocaleString()}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              id={`${activeTileModal.cardId}-report-rerun`}
              type="button"
              className="tile-solution-expert-cta"
              onClick={() => handleModuleRun(activeTileModal.cardId, true)}
              disabled={isRerunning}
              style={{ cursor: isRerunning ? 'wait' : 'pointer', border: 'none', opacity: isRerunning ? 0.6 : 1 }}
            >{isRerunning ? 'Rerunning…' : 'Rerun audit ↻'}</button>
            <button
              id={`${activeTileModal.cardId}-report-download-html`}
              type="button"
              className="tile-solution-expert-cta"
              onClick={() => downloadDoc('html')}
              style={{ cursor: 'pointer', border: 'none' }}
            >Download HTML ↓</button>
            <button
              id={`${activeTileModal.cardId}-report-download-md`}
              type="button"
              className="tile-solution-expert-cta"
              onClick={() => downloadDoc('md')}
              style={{ cursor: 'pointer', border: 'none' }}
            >Download MD ↓</button>
          </div>
        </div>
        <iframe
          id={`${activeTileModal.cardId}-report-frame`}
          title={doc.title}
          srcDoc={doc.html}
          sandbox=""
          style={{
            width: '100%',
            height: '60vh',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 6,
            background: '#fff',
          }}
        />
      </div>
    );
  }

  if (modalTab === 'solutions' && activeTileModal.cardId === 'design-evaluation') {
    return (
      <div className="tile-detail-tab-pane">
        <div id="design-evaluation-md-toolbar" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            id="design-evaluation-download-btn"
            type="button"
            className="tile-solution-expert-cta"
            onClick={() => downloadTextFile(designSolutionsMd, 'DESIGN.md', 'text/markdown;charset=utf-8')}
            style={{ cursor: 'pointer', border: 'none' }}
          >Download DESIGN.md ↓</button>
        </div>
        <pre
          id="design-evaluation-md-preview"
          style={{
            margin: 0,
            padding: 12,
            background: 'rgba(0,0,0,0.35)',
            color: '#e8e6e1',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            borderRadius: 6,
            maxHeight: '60vh',
            overflow: 'auto',
          }}
        >{designSolutionsMd}</pre>
      </div>
    );
  }

  if (modalTab === 'solutions') {
    const solutionsList = buildSolutionsList(activeTileModal.analyzer);
    if (!solutionsList.length) {
      return (
        <div className="tile-detail-tab-pane">
          <p className="tile-analyzer-solutions-empty">No matched solutions yet.</p>
        </div>
      );
    }
    return (
      <div className="tile-detail-tab-pane">
        <ol id={`${activeTileModal.cardId}-solutions-list`} className="tile-solutions-list">
          {solutionsList.map(({ key, source, severity, finding, solution, isGeneric }) => {
            const problemClean = String(solution.problem || '').replace(/\.+$/, '').trim();
            const expertTitle = String(solution.expertOffer?.title || '').trim();
            const combinedHeadline = isGeneric
              ? (expertTitle || problemClean)
              : (problemClean && expertTitle ? `${problemClean} — ${expertTitle}` : (problemClean || expertTitle));
            const sourceLabel = source === 'gap' ? `Gap: ${finding?.ruleId || ''}` : (finding?.label || '');
            return (
              <li key={key} id={`${activeTileModal.cardId}-solution-${solution.id}`} className={`tile-solution-card severity-${severity || solution.severity || 'info'}${source === 'gap' ? ' source-gap' : ''}`}>
                <header className="tile-solution-header">
                  <div className="tile-solution-header-top">
                    {source === 'gap' ? <span className="tile-analyzer-gap-chip">gap</span> : <span className="tile-analyzer-severity-chip">{severity || solution.severity}</span>}
                    {sourceLabel && <span className="tile-solution-source-label">{sourceLabel}</span>}
                  </div>
                  <h4 className="tile-solution-problem">{combinedHeadline}</h4>
                </header>
                {solution.expertOffer && (
                  <section className="tile-solution-expert">
                    {solution.expertOffer.summary && <p className="tile-solution-expert-summary">{solution.expertOffer.summary}</p>}
                    {solution.expertOffer.cta?.href && (
                      <a href={solution.expertOffer.cta.href} target="_blank" rel="noopener noreferrer" className="tile-solution-expert-cta">
                        {solution.expertOffer.cta.label || 'Book a call'} →
                      </a>
                    )}
                    {solution.diy && (
                      <details className="tile-solution-diy-details">
                        <summary className="tile-solution-diy-summary-toggle"><span className="tile-solution-diy-toggle-label">Prefer to do it yourself?</span></summary>
                        <div className="tile-solution-diy">
                          {solution.diy.summary && <p className="tile-solution-diy-summary">{solution.diy.summary}</p>}
                          {Array.isArray(solution.diy.steps) && solution.diy.steps.length > 0 && (
                            <ol className="tile-solution-steps">
                              {solution.diy.steps.map((step, idx) => <li key={idx} className="tile-solution-step">{step}</li>)}
                            </ol>
                          )}
                        </div>
                      </details>
                    )}
                  </section>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div className="tile-detail-tab-pane">
      {activeTileModal.analyzer?.readiness && (
        <div id={`${activeTileModal.cardId}-analyzer-readiness`} className={`tile-analyzer-readiness readiness-${activeTileModal.analyzer.readiness}`}>
          <span className="tile-analyzer-readiness-label">
            {activeTileModal.analyzer.readiness === 'critical'
              ? 'Holding you back'
              : activeTileModal.analyzer.readiness === 'partial'
                ? 'Needs attention'
                : 'In a good spot'}
          </span>
        </div>
      )}
      {Array.isArray(activeTileModal.analyzer?.findings) && activeTileModal.analyzer.findings.length > 0 && (
        <ul className="tile-analyzer-findings-list">
          {activeTileModal.analyzer.findings.map((finding) => {
            const catalogEntry = resolveSolution(finding);
            const headline = catalogEntry?.problem || finding.label;
            return (
              <li key={finding.id} className={`tile-analyzer-finding severity-${finding.severity || 'info'}`}>
                <div className="tile-analyzer-finding-header">
                  <span className="tile-analyzer-severity-chip">{finding.severity}</span>
                  <span className="tile-analyzer-finding-label">{headline}</span>
                </div>
                {catalogEntry?.whyItMatters && <p className="tile-solution-why">{catalogEntry.whyItMatters}</p>}
                {finding.detail && <p className="tile-analyzer-finding-detail">{finding.detail}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
