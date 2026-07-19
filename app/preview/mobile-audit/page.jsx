'use client';

// Dev-only, no-auth harness for visually iterating on mobile modal layout.
// Reproduces the REAL modal shell chain (overlay → card → bento-grid →
// content → tabbed-container → tab-content → signals-pane → signals-sg) with
// the real dashboard stylesheet, so 375px screenshots match production nesting.
// Not linked anywhere; safe to delete after the mobile-audit pass.

import React from 'react';
import '../../../styles/dashboard/index.css';

function SgSourceRow({ label, desc, on, withRun, withChevron }) {
  return (
    <div className="sg-source">
      <span className="sg-source-value">
        <span>{label}{!on ? ' · off' : ''}<small>{desc}</small></span>
      </span>
      <span className="sg-source-actions">
        <button type="button" className={`sg-btn ${on ? 'sg-btn-on' : 'sg-btn-off'}`} style={{ minWidth: 52 }}>{on ? 'ON' : 'OFF'}</button>
        {withRun ? <button type="button" className="sg-btn sg-btn-outline">Run</button> : null}
        {withChevron ? <button type="button" className="sg-btn">▼</button> : null}
      </span>
    </div>
  );
}

export default function MobileAuditHarness() {
  return (
    <>
      <div id="tile-detail-modal-overlay" style={{ position: 'static', display: 'flex', justifyContent: 'center' }}>
        <div id="tile-detail-modal-card">
          <div id="tile-detail-modal-header" className="tile-detail-bento-cell">
            <div id="tile-detail-modal-header-main">
              <h2 id="tile-detail-modal-title">Market Signals</h2>
            </div>
            <button id="tile-detail-modal-close" type="button">CLOSE</button>
          </div>

          <div id="tile-detail-bento-grid">
            <div id="tile-detail-bento-image-cell" className="tile-detail-bento-cell">
              <div className="tile-intake-placeholder tile-detail-bento-placeholder" style={{ background: '#ece7df' }} />
            </div>

            <div id="tile-detail-bento-content">
              <div id="signals-analyzer-findings" className="tile-detail-bento-cell tile-detail-tabbed-container">
                <div className="tile-detail-tabs">
                  <button type="button" className="tile-detail-tab tile-detail-tab--active">SOURCES</button>
                  <button type="button" className="tile-detail-tab">REPORT</button>
                  <button type="button" className="tile-detail-tab">DATA</button>
                </div>
                <div className="tile-detail-tab-content">
                  <div className="tile-detail-tab-pane signals-pane">
                    <div className="signals-sg">

                      <section className="sg-section" id="signals-search-sources-section">
                        <div className="sg-head">
                          <span className="sg-index">01</span>
                          <div>
                            <h3>Search Sources</h3>
                            <p>Toggle a source on, then Run to confirm exactly what it returns. Lightweight — does not refresh the stored brief.</p>
                          </div>
                          <button type="button" className="sg-btn sg-cta" id="signals-run-all-btn"><span>Run all</span></button>
                        </div>
                        <div style={{ display: 'grid', gap: 10 }}>
                          <SgSourceRow label="Web / News" desc="Open web — market news, launches, pages your audience sees." on withRun withChevron />
                          <SgSourceRow label="X / Twitter" desc="Timely posts and reply windows a social manager could act on." on withRun />
                          <SgSourceRow label="Reddit" desc="Questions, complaints, and recommendations in real buyer language." on={false} />
                        </div>
                      </section>

                      <section className="sg-section">
                        <div className="sg-head">
                          <span className="sg-index">03</span>
                          <div>
                            <h3>Recency &amp; Local</h3>
                            <p>Freshness window for the run, and the optional local-weather signal.</p>
                          </div>
                        </div>
                        <div className="sg-range">
                          <span className="sg-label">Freshness window — 14 days</span>
                          <input type="range" min="1" max="30" defaultValue={14} />
                          <div className="sg-range-scale"><span>1d</span><span>30d</span></div>
                        </div>
                        <div className="sg-source">
                          <span className="sg-source-value"><span>Local Weather<small>On — used as a live operational signal</small></span></span>
                          <span className="sg-source-actions">
                            <input className="sg-input sg-input-zip" type="text" placeholder="ZIP" defaultValue="90210" />
                            <button type="button" className="sg-btn sg-btn-on" style={{ minWidth: 52 }}>ON</button>
                            <button type="button" className="sg-btn sg-btn-outline">Open</button>
                          </span>
                        </div>
                      </section>

                      <section className="sg-section" id="signals-analysis-skills-section">
                        <div className="sg-head">
                          <span className="sg-index">04</span>
                          <div>
                            <h3>Analysis Skills</h3>
                            <p>Toggle analysis skills on — they run with the live sources via <strong>Run all</strong> (top).</p>
                          </div>
                        </div>
                        <div style={{ display: 'grid', gap: 10 }}>
                          <SgSourceRow label="Customer Research" desc="Mines stored signals for voice-of-customer themes and objections." on />
                          <SgSourceRow label="Watchlist Analysis" desc="Summarizes what competitors are doing on X right now." on={false} />
                        </div>
                      </section>

                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
