'use client';

import React, { useMemo } from 'react';
import { buildSolutionsList, resolveSolution } from '../../features/scout-intake/solutions-catalog.mjs';
import { renderDesignMd } from '../../features/scout-intake/design-md-renderer.mjs';
import { renderMiniBriefHtml } from '../../features/scout-intake/mini-brief-renderer.mjs';
import { designEvaluationAdapter } from '../../features/scout-intake/mini-briefs/design-evaluation-adapter.mjs';
import { seoPerformanceAdapter } from '../../features/scout-intake/mini-briefs/seo-performance-adapter.mjs';
import { socialPreviewAdapter } from '../../features/scout-intake/mini-briefs/social-preview-adapter.mjs';
import { agentReadinessAdapter } from '../../features/scout-intake/mini-briefs/agent-readiness-adapter.mjs';
import { cardReportAdapter } from '../../features/scout-intake/mini-briefs/card-report-adapter.mjs';

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

  const genericCardReportHtml = useMemo(() => (
    renderMiniBriefHtml(cardReportAdapter({
      card: activeTileModal,
      siteName,
    }))
  ), [activeTileModal, siteName]);

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
    const reportHtmlByCard = {
      'design-evaluation': designEvalMiniBriefHtml,
      'seo-performance': seoMiniBriefHtml,
      'social-preview': socialMiniBriefHtml,
      'agent-readiness': agentReadinessMiniBriefHtml,
    };
    const reportHtml = reportHtmlByCard[activeTileModal.cardId] || genericCardReportHtml;

    if (activeTileModal.cardId === 'design-evaluation') {
      return (
        <div className="mu-tab-pane" id="design-eval-report-pane" style={{ padding: 0, height: '100%' }}>
          {analyzerOutputs?.['design-evaluation'] && (
            <div id="design-eval-report-toolbar" style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 8px' }}>
              <button
                id="design-eval-report-download-btn"
                type="button"
                className="mu-btn-outline"
                style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
                onClick={() => downloadTextFile(designReportMd, 'DESIGN.md', 'text/markdown;charset=utf-8')}
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

    if (reportHtml) {
      return (
        <div className="mu-tab-pane" id={`${activeTileModal.cardId}-report-pane`} style={{ padding: 0, height: '100%' }}>
          <iframe
            key={`${activeTileModal.cardId}-report-${dashboardState?.latestRunId || 'static'}`}
            id={`${activeTileModal.cardId}-report-iframe`}
            title={`${activeTileModal.title || 'Card'} report`}
            srcDoc={reportHtml}
            sandbox="allow-same-origin"
            style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          />
        </div>
      );
    }
  }

  if (modalTab === 'solutions' && activeTileModal.cardId === 'design-evaluation') {
    return (
      <div className="mu-tab-pane">
        <div id="design-evaluation-md-toolbar" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button
            id="design-evaluation-download-btn"
            type="button"
            className="mu-btn-outline"
            style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}
            onClick={() => downloadTextFile(designSolutionsMd, 'DESIGN.md', 'text/markdown;charset=utf-8')}
          >Download DESIGN.md ↓</button>
        </div>
        <pre
          id="design-evaluation-md-preview"
          className="mu-code-block"
          style={{ background: 'rgba(0,0,0,0.35)', color: '#e8e6e1', maxHeight: '60vh' }}
        >{designSolutionsMd}</pre>
      </div>
    );
  }

  if (modalTab === 'solutions') {
    const solutionsList = buildSolutionsList(activeTileModal.analyzer);
    if (!solutionsList.length) {
      return (
        <div className="mu-tab-pane">
          <div className="mu-empty">No matched solutions yet.</div>
        </div>
      );
    }
    return (
      <div className="mu-tab-pane">
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
                      <a href={solution.expertOffer.cta.href} target="_blank" rel="noopener noreferrer" className="mu-btn-outline mu-btn-outline--accent">
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
    <div className="mu-tab-pane">
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
