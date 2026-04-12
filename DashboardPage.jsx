'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from './AuthContext';
import InternalPageBackground from './InternalPageBackground';

const tiles = [
  {
    id: 'creative-pipelines',
    number: '01',
    label: 'CREATIVE PIPELINES',
    title: 'Content that sounds like you.',
    description: 'Posts drafted in real time, aligned to brand voice.',
    status: 'LIVE',
    metric: '28 DRAFTS READY',
    viz: 'segbars',
  },
  {
    id: 'company-brain',
    number: '02',
    label: 'COMPANY BRAIN',
    title: 'Searchable, structured, stateful.',
    description: 'Your stack indexed and queryable.',
    status: 'INDEXED',
    metric: '2,847 DOCS · 14 DOMAINS',
    viz: 'memory',
  },
  {
    id: 'knowledge-assistant',
    number: '03',
    label: 'KNOWLEDGE ASSISTANT',
    title: 'Answers from your data.',
    description: 'Team asks, system pulls from your docs.',
    status: 'ACTIVE',
    metric: '142 QUERIES / DAY',
    viz: 'qa',
  },
  {
    id: 'executive-support',
    number: '04',
    label: 'EXECUTIVE SUPPORT',
    title: 'Walk in already briefed.',
    description: 'Every meeting prepared before you sit down.',
    status: '4 TODAY',
    metric: '3 BRIEFS READY',
    viz: 'meetings',
  },
  {
    id: 'daily-operations',
    number: '05',
    label: 'DAILY OPERATIONS',
    title: 'Core tasks run themselves.',
    description: 'Triage, tracking, reports — no oversight.',
    status: 'AUTONOMOUS',
    metric: '23 ACTIONS / H',
    viz: 'rings',
  },
  {
    id: 'email-marketing',
    number: '06',
    label: 'EMAIL MARKETING',
    title: 'Campaigns that learn.',
    description: 'Builds, schedules, optimizes across regions.',
    status: 'SENDING',
    metric: '+4.2% W/W',
    viz: 'spark',
  },
  {
    id: 'ai-research',
    number: '07',
    label: 'AI RESEARCH',
    title: 'Weeks of insight in hours.',
    description: 'Deep consumer and market analysis on demand.',
    status: 'SYNTHESIZING',
    metric: '6 SOURCES',
    viz: 'countdown',
  },
  {
    id: 'financial-tax',
    number: '08',
    label: 'FINANCIAL & TAX',
    title: 'Books reconciled nightly.',
    description: 'Transactions sorted, flagged, report-ready.',
    status: 'SYNCED · QBO',
    metric: '4 REPORTS READY',
    viz: 'stats',
  },
  {
    id: 'compliance',
    number: '09',
    label: 'COMPLIANCE MONITORING',
    title: 'Nothing critical gets missed.',
    description: 'Deadlines, filings, rules — watched continuously.',
    status: 'WATCHING',
    metric: '1 NEEDS ACTION',
    viz: 'deadlines',
  },
  {
    id: 'distribution-insight',
    number: '10',
    label: 'DISTRIBUTION & INSIGHT',
    title: 'One loop for everything.',
    description: 'Publishing, SEO, rankings — unified.',
    status: 'UNIFIED',
    metric: '10 SEO FIXES / WK',
    viz: 'table',
  },
  {
    id: 'rapid-product',
    number: '11',
    label: 'RAPID PRODUCT DEV',
    title: 'Concept to launch, fast.',
    description: 'Tools and integrations shipped on demand.',
    status: 'BUILDING',
    metric: '3 IN FLIGHT',
    viz: 'pipeline',
  },
  {
    id: 'self-improving',
    number: '12',
    label: 'SELF-IMPROVING',
    title: 'Every run smarter.',
    description: 'Workflows refine themselves from feedback.',
    status: 'LEARNING',
    metric: '212 ITERATIONS',
    viz: 'delta',
  },
  {
    id: 'reddit-community',
    number: '13',
    label: 'REDDIT & COMMUNITY',
    title: 'Conversations to be in.',
    description: 'Finds threads, drafts replies for review.',
    status: 'SCANNING',
    metric: '4 DRAFTS READY',
    viz: 'threads',
  },
  {
    id: 'seo-content',
    number: '14',
    label: 'SEO CONTENT',
    title: 'Keywords to capture.',
    description: 'Opportunities surfaced, drafts ready.',
    status: 'DRAFTING',
    metric: '8 OPPORTUNITIES',
    viz: 'keywords',
  },
];

const activityRows = [
  { time: '09:42:12', tag: 'BRAIN', message: 'Indexed 4 new docs from /strategy', badge: '[OK]' },
  { time: '09:42:08', tag: 'PIPELINES', message: 'LinkedIn draft #214 routed for review', badge: '[READY]' },
  { time: '09:41:55', tag: 'FINANCE', message: 'Flagged 1 duplicate Stripe charge for $48.00' },
  { time: '09:41:40', tag: 'COMPLIANCE', message: 'CA sales tax deadline in 6 days — briefing created' },
  { time: '09:41:22', tag: 'RESEARCH', message: 'Competitor teardown complete — 12 insights extracted', badge: '[OK]' },
];

const memoryNodes = Array.from({ length: 96 }, (_, index) => {
  if ([6, 23, 41, 55, 78].includes(index)) return 'hot';
  if (index % 3 === 0 || index % 7 === 0) return 'on';
  return '';
});

async function fetchDashboardBootstrap(user) {
  const token = await user.getIdToken();
  const response = await fetch('/api/dashboard/bootstrap', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || 'Could not load dashboard data.');
  }

  return data;
}

const DashboardPage = () => {
  const { user, userProfile, signOutUser } = useAuth();
  const [theme, setTheme] = useState('light');
  const [localTime, setLocalTime] = useState(() => formatClock(new Date()));
  const [countdownHours, setCountdownHours] = useState(14);
  const [bootstrap, setBootstrap] = useState({ userProfile: null, client: null, dashboardState: null, recentRuns: [] });
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [bootstrapError, setBootstrapError] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLocalTime(formatClock(new Date()));
      setCountdownHours((current) => (current <= 9 ? 14 : current - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setBootstrapLoading(false);
      setBootstrap({ userProfile: null, client: null, recentRuns: [] });
      return undefined;
    }

    setBootstrapLoading(true);
    setBootstrapError('');

    fetchDashboardBootstrap(user)
      .then((data) => {
        if (!cancelled) {
          setBootstrap(data);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setBootstrapError(error instanceof Error ? error.message : 'Could not load dashboard data.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBootstrapLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  const client = bootstrap.client;
  const recentRuns = bootstrap.recentRuns || [];
  const displayProfile = bootstrap.userProfile || userProfile;
  const currentRun = recentRuns[0] || null;

  // ── Canonical display model (dashboard_state/{clientId}) ──────────────────
  // All operational state derives from dashboardState first.
  // client fields are used only for stable identity (companyName, normalizedHost).
  const dashboardState = bootstrap.dashboardState;
  const clientStatus = dashboardState?.status || client?.status || 'provisioning';
  const latestRunStatus = dashboardState?.latestRunStatus || currentRun?.status || null;
  const headline = dashboardState?.headline || null;
  const summaryCards = dashboardState?.summaryCards || [];
  const latestInsights = dashboardState?.latestInsights || [];
  const provisioningState = dashboardState?.provisioningState || null;
  const errorState = dashboardState?.errorState || null;

  const founderLabel = useMemo(() => {
    const displayName = displayProfile?.displayName || user?.displayName || 'B. ALLI';
    return `@${displayName.toUpperCase()}`;
  }, [displayProfile?.displayName, user?.displayName]);

  return (
    <div data-dashboard-theme={theme} style={shellStyle}>
      <InternalPageBackground />
      <style>{dashboardCss}</style>
      <main id="founders-shell">
        <header id="founders-top-strip">
          <Link href="/" id="founders-brand">
            <span className="mark" />
            FOUNDERS / SYSTEM PANEL
          </Link>
          <nav id="founders-top-nav" aria-label="Dashboard sections">
            <a href="#founders-hero-shell" className="is-active">OVERVIEW</a>
            <a href="#capability-section">PIPELINES</a>
            <a href="#capability-section">BRAIN</a>
            <a href="#capability-section">FINANCE</a>
            <a href="#activity-console">INSIGHTS</a>
            <button type="button" onClick={signOutUser} className="logout-link">SIGN OUT</button>
          </nav>
          <div id="theme-toggle" role="group" aria-label="Theme">
            <button type="button" data-theme="dark" className={theme === 'dark' ? 'is-active' : ''} onClick={() => setTheme('dark')}>DARK</button>
            <button type="button" data-theme="light" className={theme === 'light' ? 'is-active' : ''} onClick={() => setTheme('light')}>LIGHT</button>
          </div>
          <div className="env">ENV · PROD · <span className="v">{
            latestRunStatus === 'queued' ? 'INITIAL BRIEF QUEUED' :
            latestRunStatus === 'running' ? 'BRIEF RUNNING' :
            latestRunStatus === 'succeeded' ? 'BRIEF COMPLETE' :
            latestRunStatus === 'failed' ? 'BRIEF FAILED' :
            'CLIENT AUTH LIVE'
          }</span></div>
        </header>

        <section id="founders-hero-shell">
          <div id="founders-hero-numeric-shell">
            <div className="hero-label">{client?.companyName ? `${client.companyName.toUpperCase()} — REAL-TIME` : 'SYSTEMS ONLINE — REAL-TIME'}</div>
            <div id="founders-hero-numeric">
              <span id="founders-hero-num-val">{String(recentRuns.length || 1).padStart(2, '0')}</span>
              <span className="denom">/14</span>
            </div>
            <div id="founders-hero-caption">
              <span className="status-dot" />
              <span>{clientStatus === 'provisioning' ? 'CLIENT PROVISIONING ACTIVE' : clientStatus === 'error' ? 'SETUP REQUIRES ATTENTION' : 'ALL SUBSYSTEMS NOMINAL'}</span>
              <span className="sep">·</span>
              <span>{latestRunStatus ? `LATEST RUN ${String(latestRunStatus).toUpperCase()}` : 'WAITING FOR INITIAL RUN'}</span>
              <span className="sep">·</span>
              <span>{client?.normalizedHost || 'NO SOURCE URL'}</span>
            </div>
          </div>

          <div id="founders-hero-meta">
            <div className="meta-row"><span className="label">LOCAL TIME</span><span className="value">{localTime}</span></div>
            <div className="meta-row"><span className="label">FOUNDER</span><span className="value">{founderLabel}</span></div>
            <div className="meta-row"><span className="label">BUILD</span><span className="value">0.14.2 STABLE</span></div>
            <div className="meta-row"><span className="label">CLIENT</span><span className="value">{client?.companyName || 'UNASSIGNED'}</span></div>
            <div className="meta-row"><span className="label">ACCOUNT</span><span className="value">{user?.email || 'SIGNED IN'}</span></div>
          </div>
        </section>

        <section id="capability-section">
          <div id="capability-section-header">
            <h2>{client?.dashboardTitle || displayProfile?.dashboardTitle || 'An operating stack that runs itself.'}</h2>
            <div className="count">
              {bootstrapLoading
                ? 'LOADING CLIENT STATE'
                : bootstrapError
                  ? 'CLIENT STATE ERROR'
                  : clientStatus === 'provisioning'
                    ? 'INITIALIZATION IN PROGRESS'
                    : headline || client?.websiteUrl || '14 SUBSYSTEMS · ALWAYS-ON'}
            </div>
          </div>

          {bootstrapError ? <div className="db-alert">{bootstrapError}</div> : null}
          {!bootstrapError && errorState ? (
            <div className="db-alert" id="dashboard-error-banner">
              {errorState.message}{errorState.retryPending ? ' Retry is pending.' : ''}
            </div>
          ) : null}
          {!bootstrapError && !errorState && !bootstrapLoading && clientStatus === 'provisioning' ? (
            <div className="db-alert db-alert-muted" id="dashboard-provisioning-banner">
              {provisioningState?.message || 'Your intelligence stack is being initialized. This typically takes a few minutes.'}
            </div>
          ) : null}

          {clientStatus === 'active' && (headline || summaryCards.length > 0 || latestInsights.length > 0) ? (
            <section id="signal-panel">
              {headline ? (
                <div id="signal-headline-row">
                  <span className="signal-label">PRIORITY SIGNAL</span>
                  <p id="signal-headline-text">{headline}</p>
                </div>
              ) : null}
              {summaryCards.length > 0 ? (
                <div id="signal-cards-row">
                  {summaryCards.map((card, i) => (
                    <div className="signal-card" key={`card-${i}`} id={`signal-card-${card.type || i}`}>
                      <div className="signal-card-label">{card.label}</div>
                      <p className="signal-card-value">{card.value}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {latestInsights.length > 0 ? (
                <div id="signal-insights-row">
                  <div className="signal-label">CONTENT OPPORTUNITIES</div>
                  {latestInsights.map((insight, i) => (
                    <div className="signal-insight-row" key={`insight-${i}`} id={`signal-insight-${i}`}>
                      <span className="signal-insight-priority">[{String(insight.priority || 'MED').toUpperCase()}]</span>
                      <span className="signal-insight-topic">{insight.topic}</span>
                      {insight.whyNow ? <span className="signal-insight-why">{insight.whyNow}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <div id="capability-grid">
            {tiles.map((tile) => (
              <article className="tile" id={`tile-${tile.number}-${tile.id}`} key={tile.id}>
                <div className="tile-number">
                  <span>{tile.number} / {tile.label}</span>
                  <span className="power-dot lamp" />
                </div>
                <h3 className="tile-heading">{tile.title}</h3>
                <p className="tile-description">{tile.description}</p>
                <div className="tile-viz">{renderViz(tile.viz, countdownHours)}</div>
                <div className="tile-foot">
                  <span className="status-live">{tile.status}</span>
                  <span>{tile.metric}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="activity-console">
          <div id="activity-console-head">
            <h3>SYSTEM ACTIVITY — LAST 60S</h3>
            <div id="activity-count-val">17</div>
            <div className="sub">EVENTS / MIN</div>
          </div>
          <div id="activity-log-stream">
            {activityRows.map((row) => (
              <div className="log-line" key={`${row.time}-${row.tag}`}>
                <span className="time">{row.time}</span>
                <span className="tag">{row.tag}</span>
                <span className="msg">
                  {row.message} {row.badge ? <span className="ok">{row.badge}</span> : null}
                </span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

const renderViz = (type, countdownHours) => {
  switch (type) {
    case 'segbars':
      return (
        <div className="segbar-wrap">
          {[
            ['INSTAGRAM', 8, 'on'],
            ['X / TWITTER', 10, 'on'],
            ['LINKEDIN', 6, 'on'],
            ['TIKTOK', 4, 'warn'],
          ].map(([label, value, state]) => (
            <React.Fragment key={label}>
              <div className="segbar-row"><span>{label}</span><span className="val">{String(value).padStart(2, '0')} / 10</span></div>
              <div className="segbar-track">
                {Array.from({ length: 10 }, (_, i) => (
                  <div key={`${label}-${i}`} className={`segbar-cell ${i < value ? state : ''}`.trim()} />
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>
      );
    case 'memory':
      return (
        <div className="memory-map">
          {memoryNodes.map((state, index) => (
            <div key={index} className={`memory-node ${state}`.trim()} />
          ))}
        </div>
      );
    case 'qa':
      return (
        <div className="qa-wrap">
          <div className="qa-q">WHERE IS Q3 ROADMAP?</div>
          <div className="qa-a">Notion / strategy / q3-2026. Last edited 2d ago by @priya. Top 3 milestones: voice-cloning beta, EU launch, pricing test.<span className="cursor" /></div>
        </div>
      );
    case 'meetings':
      return (
        <div className="mtg-wrap">
          {[
            ['10:30', 'BOARD SYNC', 'READY'],
            ['13:00', 'DESIGN REVIEW', 'READY'],
            ['15:45', 'INVESTOR CALL', 'READY'],
            ['17:30', '1:1 · PRIYA', 'DRAFTING'],
          ].map(([time, title, badge]) => (
            <div className="mtg-row" key={`${time}-${title}`}>
              <span className="time">{time}</span>
              <span className="title">{title}</span>
              <span className={`badge ${badge === 'DRAFTING' ? 'pending' : ''}`.trim()}>{badge}</span>
            </div>
          ))}
        </div>
      );
    case 'rings':
      return (
        <div className="rings">
          {[
            ['87%', 'TRIAGE', 'display', 87],
            ['62%', 'TASKS', 'warning', 62],
            ['100%', 'UPDATES', 'success', 100],
          ].map(([value, label, tone, percent]) => (
            <div className="ring-cell" key={label}>
              <svg className="ring-svg" width="58" height="58" viewBox="0 0 58 58">
                <circle className="ring-bg" cx="29" cy="29" r="24" fill="none" strokeWidth="4" />
                <circle
                  className={`ring-fill ring-fill-${tone} stroke-lit`}
                  cx="29"
                  cy="29"
                  r="24"
                  fill="none"
                  strokeWidth="4"
                  strokeDasharray="150.8"
                  strokeDashoffset={150.8 - ((150.8 * percent) / 100)}
                  transform="rotate(-90 29 29)"
                />
              </svg>
              <div className="ring-val">{value}</div>
              <div className="ring-label">{label}</div>
            </div>
          ))}
        </div>
      );
    case 'spark':
      return (
        <div className="spark-wrap">
          <div className="spark-val">38.4<span className="unit">% OPEN RATE</span></div>
          <svg className="spark-svg" viewBox="0 0 200 40" preserveAspectRatio="none">
            <line className="spark-grid" x1="0" y1="30" x2="200" y2="30" strokeWidth="1" strokeDasharray="2 3" />
            <path className="spark-line stroke-lit" d="M0,30 L18,26 L36,28 L54,20 L72,24 L90,15 L108,18 L126,12 L144,14 L162,8 L180,10 L200,6" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle className="spark-dot stroke-lit" cx="200" cy="6" r="2.5" />
          </svg>
          <div className="chips">
            <span className="chip on">EU</span>
            <span className="chip">NA</span>
            <span className="chip on">APAC</span>
          </div>
        </div>
      );
    case 'countdown':
      return (
        <div className="countdown-wrap">
          <div className="countdown">{String(countdownHours).padStart(2, '0')}<span className="unit">H TO DELIVERY</span></div>
          <div className="countdown-meta">COMPETITOR TEARDOWN · Q2 2026</div>
        </div>
      );
    case 'stats':
      return (
        <div className="stat-wrap">
          {[
            ['RECONCILED', '$184,220.00', ''],
            ['FLAGGED', '$2,340.18', 'warn'],
            ['PENDING', '$12,884.00', ''],
            ['TAX WITHHELD', '$38,201.44', ''],
          ].map(([label, value, tone]) => (
            <div className="stat-row" key={label}>
              <span className="label">{label}</span>
              <span className={`value ${tone}`.trim()}>{value}</span>
            </div>
          ))}
        </div>
      );
    case 'deadlines':
      return (
        <div className="deadline-wrap">
          {[
            ['FORM 10-Q FILING', '18 DAYS', 60, false],
            ['CA SALES TAX', '6 DAYS', 85, true],
            ['GDPR AUDIT', '42 DAYS', 25, false],
            ['SOC 2 REVIEW', '71 DAYS', 15, false],
          ].map(([name, days, width, warn]) => (
            <div className="deadline-row" key={name}>
              <div className="deadline-head"><span className="name">{name}</span><span className={`days ${warn ? 'warn' : ''}`.trim()}>{days}</span></div>
              <div className="deadline-bar"><div className={`fill ${warn ? 'warn' : ''}`.trim()} style={{ width: `${width}%` }} /></div>
            </div>
          ))}
        </div>
      );
    case 'table':
      return (
        <table className="mini-table">
          <thead>
            <tr><th>CHANNEL</th><th className="num">POSTS</th><th className="num">Δ RANK</th></tr>
          </thead>
          <tbody>
            <tr><td>ORGANIC</td><td className="num">142</td><td className="num delta-up">▲ 8</td></tr>
            <tr><td>SOCIAL</td><td className="num">68</td><td className="num delta-up">▲ 3</td></tr>
            <tr><td>REFERRAL</td><td className="num">24</td><td className="num delta-down">▼ 2</td></tr>
            <tr><td>DIRECT</td><td className="num">—</td><td className="num delta-up">▲ 1</td></tr>
          </tbody>
        </table>
      );
    case 'pipeline':
      return (
        <div className="pipeline-wrap">
          <div className="pipeline">
            <div className="pipe-stop done" />
            <div className="pipe-line done" />
            <div className="pipe-stop done" />
            <div className="pipe-line done" />
            <div className="pipe-stop active lamp-lg" />
            <div className="pipe-line" />
            <div className="pipe-stop" />
            <div className="pipe-line" />
            <div className="pipe-stop" />
          </div>
          <div className="pipe-labels">
            <span>BRIEF</span><span>SPEC</span><span className="active">BUILD</span><span>QA</span><span>SHIP</span>
          </div>
        </div>
      );
    case 'delta':
      return (
        <div className="delta-wrap">
          {[
            ['RESPONSE TIME', '+12%', 55, 72],
            ['ACCEPT RATE', '+8%', 48, 60],
            ['COST / RUN', '−18%', 74, 52],
          ].map(([label, pct, before, after]) => (
            <div className="delta-pair" key={label}>
              <div className="delta-label"><span>{label}</span><span className="pct">{pct}</span></div>
              <div className="delta-bar-before"><div className="fill" style={{ width: `${before}%` }} /></div>
              <div className="delta-bar-after"><div className="fill" style={{ width: `${after}%` }} /></div>
            </div>
          ))}
        </div>
      );
    case 'threads':
      return (
        <div className="thread-wrap">
          {[
            ['R/SAAS', 'Best AI tools for small teams', '2 DRAFTS', false],
            ['R/STARTUPS', 'How founders automate ops', '1 DRAFT', false],
            ['R/MARKETING', 'Cold email that works 2026', '1 DRAFT', false],
            ['R/DEVOPS', 'Monitoring for seed co.', 'WATCH', true],
            ['R/BIZ', 'Pricing experiments Q2', 'WATCH', true],
          ].map(([sub, title, drafts, watch]) => (
            <div className="thread-row" key={`${sub}-${title}`}>
              <span className="sub">{sub}</span>
              <span className="title">{title}</span>
              <span className={`drafts ${watch ? 'watch' : ''}`.trim()}>{drafts}</span>
            </div>
          ))}
        </div>
      );
    case 'keywords':
      return (
        <div className="kw-wrap">
          {[
            ['AI AGENTS FOR STARTUPS', '18K / MO', 92],
            ['FOUNDER DASHBOARD TOOLS', '9.4K / MO', 64],
            ['AUTOMATED COMPLIANCE', '6.1K / MO', 48],
            ['SELF-SERVE BRAND VOICE', '3.8K / MO', 32],
          ].map(([term, vol, width]) => (
            <div className="kw-row" key={term}>
              <div className="kw-head"><span>{term}</span><span className="vol">{vol}</span></div>
              <div className="kw-bar"><div className="fill" style={{ width: `${width}%` }} /></div>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
};

const formatClock = (date) =>
  date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

const shellStyle = {
  minHeight: '100dvh',
  position: 'relative',
  overflow: 'hidden',
};

const dashboardCss = `
  :root {
    --accent: #D71921;
    --success: #4A9E5C;
    --warning: #D4A843;
    --font-display: "Doto", "Space Mono", monospace;
    --font-ui: "Space Grotesk", system-ui, sans-serif;
    --font-mono: "Space Mono", monospace;
    --ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  }
  [data-dashboard-theme="dark"] {
    --page: #000000;
    --surface: #111111;
    --surface-raised: #1A1A1A;
    --border: #222222;
    --border-visible: #333333;
    --text-disabled: #666666;
    --text-secondary: #999999;
    --text-primary: #E8E8E8;
    --text-display: #FFFFFF;
    --dot-grid-color: rgba(255,255,255,0.045);
  }
  [data-dashboard-theme="light"] {
    --page: #F5F5F5;
    --surface: #FFFFFF;
    --surface-raised: #F0F0F0;
    --border: #E4E4E4;
    --border-visible: #C8C8C8;
    --text-disabled: #A3A3A3;
    --text-secondary: #666666;
    --text-primary: #222222;
    --text-display: #000000;
    --dot-grid-color: rgba(0,0,0,0.065);
  }
  [data-dashboard-theme] {
    background: transparent;
    color: var(--text-primary);
    min-height: 100dvh;
    transition: background 300ms var(--ease), color 300ms var(--ease);
    font-family: var(--font-ui);
  }
  [data-dashboard-theme] * { box-sizing: border-box; }
  #founders-shell {
    position: relative;
    z-index: 1;
    max-width: 1440px;
    margin: 0 auto;
    padding: 40px 48px 96px;
    background-image:
      linear-gradient(180deg, rgba(245, 241, 223, 0.08), rgba(245, 241, 223, 0.04)),
      radial-gradient(circle, var(--dot-grid-color) 0.8px, transparent 0.8px);
    background-size: 16px 16px;
  }
  #founders-top-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 28px;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    flex-wrap: wrap;
  }
  #founders-brand {
    color: var(--text-display);
    display: flex;
    align-items: center;
    text-decoration: none;
  }
  #founders-brand .mark {
    display: inline-block;
    width: 11px;
    height: 11px;
    border: 1.5px solid var(--text-display);
    margin-right: 10px;
    position: relative;
  }
  #founders-brand .mark::after {
    content: "";
    position: absolute;
    inset: 2px;
    background: var(--text-display);
  }
  #founders-top-nav {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
    align-items: center;
  }
  #founders-top-nav a,
  #founders-top-nav .logout-link {
    color: var(--text-disabled);
    text-decoration: none;
    font-family: inherit;
    font-size: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    cursor: pointer;
  }
  #founders-top-nav a.is-active {
    color: var(--text-display);
  }
  #founders-top-nav a.is-active::before { content: "[ "; color: var(--text-secondary); }
  #founders-top-nav a.is-active::after { content: " ]"; color: var(--text-secondary); }
  #theme-toggle {
    display: inline-flex;
    border: 1px solid var(--border-visible);
    border-radius: 999px;
    overflow: hidden;
    padding: 2px;
  }
  #theme-toggle button {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    padding: 6px 14px;
    color: var(--text-secondary);
    border-radius: 999px;
  }
  #theme-toggle button.is-active {
    background: var(--text-display);
    color: var(--page);
  }
  .env .v { color: var(--text-display); }
  #founders-hero-shell {
    display: grid;
    grid-template-columns: 1.5fr 1fr;
    gap: 64px;
    padding: 80px 0 80px;
    border-bottom: 1px solid var(--border);
    align-items: end;
  }
  .hero-label,
  .meta-row .label,
  #capability-section-header .count,
  .tile-number,
  .tile-foot,
  #activity-console-head h3,
  #activity-console-head .sub,
  .log-line .tag,
  .log-line .time {
    font-family: var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .hero-label {
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 400;
    color: var(--text-secondary);
    margin-bottom: 24px;
  }
  #founders-hero-numeric {
    font-family: var(--font-display);
    font-weight: 400;
    font-size: clamp(88px, 14vw, 176px);
    line-height: 0.9;
    color: var(--text-display);
    letter-spacing: -0.03em;
  }
  #founders-hero-numeric .denom { color: var(--text-disabled); }
  #founders-hero-caption {
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin-top: 28px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  #founders-hero-caption .status-dot,
  .tile-number .power-dot,
  .status-live::before {
    border-radius: 999px;
    background: var(--success);
  }
  #founders-hero-caption .status-dot {
    width: 9px;
    height: 9px;
    display: inline-block;
  }
  #founders-hero-meta { display: flex; flex-direction: column; }
  .meta-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 14px 0;
    border-bottom: 1px solid var(--border);
  }
  .meta-row:last-child { border-bottom: none; }
  .meta-row .label { font-size: 11px; color: var(--text-secondary); }
  .meta-row .value { font-family: var(--font-mono); font-size: 14px; color: var(--text-display); }
  #capability-section { padding: 80px 0 0; }
  #capability-section-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 40px;
    gap: 24px;
    flex-wrap: wrap;
  }
  #capability-section-header h2 {
    font-weight: 300;
    font-size: clamp(28px, 3.4vw, 42px);
    color: var(--text-display);
    letter-spacing: -0.02em;
    line-height: 1.05;
    max-width: 680px;
  }
  #capability-section-header .count {
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .db-alert {
    margin: 0 0 20px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-display);
    font-size: 12px;
    line-height: 1.5;
  }
  .db-alert-muted {
    color: var(--text-secondary);
  }
  #capability-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
  }
  .tile {
    aspect-ratio: 16 / 9;
    background: var(--surface);
    padding: 20px;
    display: grid;
    grid-template-areas:
      "num num"
      "head viz"
      "desc viz"
      "foot foot";
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    grid-template-rows: auto auto auto 1fr;
    column-gap: 20px;
    row-gap: 4px;
    overflow: hidden;
  }
  .tile-number {
    grid-area: num;
    font-size: 10px;
    color: var(--text-disabled);
    margin-bottom: 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tile-number .power-dot {
    width: 6px;
    height: 6px;
    display: inline-block;
  }
  .tile-heading {
    grid-area: head;
    font-weight: 400;
    font-size: 16px;
    line-height: 1.2;
    color: var(--text-display);
    letter-spacing: -0.01em;
  }
  .tile-description {
    grid-area: desc;
    font-size: 11.5px;
    color: var(--text-secondary);
    line-height: 1.45;
    max-width: 32ch;
    margin-top: 6px;
  }
  .tile-viz {
    grid-area: viz;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    min-width: 0;
    align-self: stretch;
  }
  .tile-foot {
    grid-area: foot;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 10px;
    color: var(--text-secondary);
    display: flex;
    justify-content: space-between;
    gap: 12px;
    align-self: end;
  }
  .status-live {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .status-live::before {
    content: "";
    width: 5px;
    height: 5px;
    display: inline-block;
  }
  .segbar-wrap, .qa-wrap, .mtg-wrap, .spark-wrap, .countdown-wrap, .stat-wrap, .deadline-wrap, .pipeline-wrap, .delta-wrap, .thread-wrap, .kw-wrap {
    width: 100%;
  }
  .segbar-row, .deadline-head, .kw-head, .delta-label, .thread-row, .stat-row, .mini-table {
    font-family: var(--font-mono);
  }
  .segbar-row {
    display: flex;
    justify-content: space-between;
    font-size: 8.5px;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }
  .segbar-row .val { color: var(--text-display); }
  .segbar-track { display: flex; gap: 2px; margin-bottom: 10px; }
  .segbar-cell { flex: 1; height: 5px; background: var(--border); }
  .segbar-cell.on { background: var(--text-display); }
  .segbar-cell.warn { background: var(--warning); }
  .memory-map {
    width: 100%;
    display: grid;
    grid-template-columns: repeat(16, 1fr);
    gap: 5px;
    aspect-ratio: 16 / 7;
  }
  .memory-node {
    background: var(--border);
    border-radius: 999px;
    aspect-ratio: 1;
  }
  .memory-node.on { background: var(--text-primary); }
  .memory-node.hot { background: var(--text-display); }
  .qa-q {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-display);
    margin-bottom: 8px;
    line-height: 1.4;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .qa-q::before { content: "Q / "; color: var(--text-secondary); }
  .qa-a {
    font-size: 11px;
    color: var(--text-secondary);
    line-height: 1.5;
    padding-left: 12px;
    border-left: 1px solid var(--border-visible);
  }
  .cursor {
    display: inline-block;
    width: 6px;
    height: 11px;
    background: var(--text-display);
    vertical-align: -1px;
    margin-left: 2px;
  }
  .mtg-row {
    display: grid;
    grid-template-columns: 42px 1fr auto;
    gap: 10px;
    align-items: baseline;
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
  }
  .mtg-row:last-child { border-bottom: none; }
  .mtg-row .time { color: var(--text-secondary); }
  .mtg-row .title { color: var(--text-display); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mtg-row .badge { color: var(--success); font-size: 8.5px; display: inline-flex; align-items: center; gap: 5px; }
  .mtg-row .badge.pending { color: var(--warning); }
  .mtg-row .badge::before {
    content: "";
    width: 5px;
    height: 5px;
    background: currentColor;
    border-radius: 999px;
  }
  .rings {
    display: flex;
    gap: 10px;
    width: 100%;
    justify-content: space-around;
    align-items: center;
  }
  .ring-cell { text-align: center; }
  .ring-bg { stroke: var(--border); }
  .ring-fill-display { stroke: var(--text-display); }
  .ring-fill-warning { stroke: var(--warning); }
  .ring-fill-success { stroke: var(--success); }
  .ring-val { font-family: var(--font-mono); font-size: 12px; color: var(--text-display); margin-top: 6px; }
  .ring-label { font-family: var(--font-mono); font-size: 8.5px; color: var(--text-secondary); margin-top: 1px; letter-spacing: 0.08em; text-transform: uppercase; }
  .spark-val {
    font-family: var(--font-mono);
    font-size: 24px;
    color: var(--text-display);
    line-height: 1;
    margin-bottom: 4px;
  }
  .spark-val .unit, .countdown .unit, .countdown-meta, .chip {
    font-family: var(--font-mono);
    text-transform: uppercase;
  }
  .spark-val .unit { font-size: 9px; color: var(--text-secondary); margin-left: 5px; letter-spacing: 0.08em; }
  .spark-svg { width: 100%; height: 38px; display: block; margin: 2px 0 10px; }
  .spark-grid { stroke: var(--border); }
  .spark-line { stroke: var(--text-display); }
  .spark-dot { fill: var(--text-display); }
  .chips { display: flex; gap: 4px; }
  .chip {
    border: 1px solid var(--border-visible);
    padding: 2px 9px;
    font-size: 9px;
    color: var(--text-secondary);
    border-radius: 999px;
    letter-spacing: 0.08em;
  }
  .chip.on { color: var(--text-display); border-color: var(--text-display); }
  .countdown {
    font-family: var(--font-display);
    font-size: clamp(60px, 7vw, 84px);
    line-height: 0.9;
    color: var(--text-display);
    letter-spacing: -0.02em;
  }
  .countdown .unit {
    font-size: 13px;
    color: var(--text-secondary);
    margin-left: 6px;
    letter-spacing: 0.08em;
  }
  .countdown-meta { font-size: 9px; color: var(--text-secondary); margin-top: 8px; letter-spacing: 0.08em; }
  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 7px 0;
    border-bottom: 1px solid var(--border);
  }
  .stat-row:last-child { border-bottom: none; }
  .stat-row .label { font-size: 9.5px; color: var(--text-secondary); letter-spacing: 0.08em; text-transform: uppercase; }
  .stat-row .value { font-size: 12px; color: var(--text-display); }
  .stat-row .value.warn { color: var(--warning); }
  .deadline-row { margin-bottom: 10px; }
  .deadline-head {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    margin-bottom: 4px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .deadline-head .name { color: var(--text-secondary); }
  .deadline-head .days { color: var(--text-display); }
  .deadline-head .days.warn { color: var(--warning); }
  .deadline-bar, .kw-bar, .delta-bar-before, .delta-bar-after {
    height: 3px;
    background: var(--border);
    position: relative;
  }
  .deadline-bar > .fill, .kw-bar > .fill, .delta-bar-before > .fill, .delta-bar-after > .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
  }
  .deadline-bar > .fill, .kw-bar > .fill, .delta-bar-after > .fill { background: var(--text-display); }
  .deadline-bar > .fill.warn { background: var(--warning); }
  .delta-bar-before > .fill { background: var(--text-secondary); }
  .mini-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
  }
  .mini-table th {
    text-align: left;
    padding: 4px 6px 6px 0;
    color: var(--text-secondary);
    font-size: 8.5px;
    border-bottom: 1px solid var(--border-visible);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    font-weight: 400;
  }
  .mini-table td {
    padding: 7px 6px 7px 0;
    color: var(--text-display);
    border-bottom: 1px solid var(--border);
  }
  .mini-table tr:last-child td { border-bottom: none; }
  .num { text-align: right; padding-right: 0; }
  .delta-up { color: var(--success); }
  .delta-down { color: var(--accent); }
  .pipeline {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 4px 0;
  }
  .pipe-stop {
    width: 10px;
    height: 10px;
    background: var(--border);
    border-radius: 999px;
    flex-shrink: 0;
  }
  .pipe-stop.done { background: var(--text-display); }
  .pipe-stop.active {
    width: 16px;
    height: 16px;
    background: var(--text-display);
    border: 3px solid var(--surface);
    outline: 1px solid var(--text-display);
  }
  .pipe-line { flex: 1; height: 1px; background: var(--border); }
  .pipe-line.done { background: var(--text-display); }
  .pipe-labels {
    display: flex;
    justify-content: space-between;
    margin-top: 12px;
    font-family: var(--font-mono);
    font-size: 8.5px;
    color: var(--text-disabled);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .pipe-labels .active { color: var(--text-display); }
  .delta-pair { margin-bottom: 10px; }
  .delta-label {
    font-size: 9px;
    color: var(--text-secondary);
    margin-bottom: 4px;
    display: flex;
    justify-content: space-between;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .delta-label .pct { color: var(--success); }
  .delta-bar-before { margin-bottom: 3px; }
  .thread-row {
    display: grid;
    grid-template-columns: 68px 1fr auto;
    gap: 9px;
    padding: 6px 0;
    border-bottom: 1px solid var(--border);
    align-items: baseline;
    font-size: 9px;
  }
  .thread-row:last-child { border-bottom: none; }
  .thread-row .sub { color: var(--text-secondary); text-transform: uppercase; }
  .thread-row .title {
    color: var(--text-display);
    font-family: var(--font-ui);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .thread-row .drafts { color: var(--warning); text-transform: uppercase; }
  .thread-row .drafts.watch { color: var(--text-disabled); }
  .kw-row { margin-bottom: 8px; }
  .kw-head {
    display: flex;
    justify-content: space-between;
    font-size: 9px;
    color: var(--text-display);
    margin-bottom: 4px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .kw-head .vol { color: var(--text-secondary); }
  #activity-console {
    margin-top: 40px;
    padding: 36px 40px;
    border: 1px solid var(--border);
    background: var(--surface);
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 48px;
  }
  #activity-console-head h3 {
    font-weight: 400;
    font-size: 11px;
    color: var(--text-secondary);
    margin-bottom: 14px;
  }
  #activity-count-val {
    font-family: var(--font-display);
    font-size: 68px;
    line-height: 0.9;
    color: var(--text-display);
  }
  #activity-console-head .sub {
    font-size: 10px;
    color: var(--text-secondary);
    margin-top: 6px;
  }
  #activity-log-stream {
    font-family: var(--font-mono);
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 11px;
    border-left: 1px solid var(--border);
    padding-left: 32px;
  }
  .log-line {
    display: grid;
    grid-template-columns: 74px 110px 1fr;
    gap: 16px;
    align-items: baseline;
  }
  .log-line .time { color: var(--text-disabled); }
  .log-line .tag { color: var(--text-secondary); }
  .log-line .msg { color: var(--text-display); }
  .log-line .ok { color: var(--success); margin-left: 6px; }
  .lamp {
    box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 12%, transparent), 0 0 10px color-mix(in srgb, currentColor 55%, transparent);
  }
  .lamp-lg {
    box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 12%, transparent), 0 0 14px color-mix(in srgb, currentColor 60%, transparent);
  }
  .stroke-lit {
    filter: drop-shadow(0 0 3px color-mix(in srgb, currentColor 55%, transparent));
  }
  @media (max-width: 1200px) {
    #founders-hero-shell {
      grid-template-columns: 1fr;
      gap: 32px;
    }
    #activity-console {
      grid-template-columns: 1fr;
      gap: 24px;
    }
    #activity-log-stream {
      border-left: none;
      border-top: 1px solid var(--border);
      padding-left: 0;
      padding-top: 24px;
    }
  }
  #signal-panel {
    margin-bottom: 32px;
    border: 1px solid var(--border);
    background: var(--surface);
    padding: 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .signal-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin-bottom: 8px;
    display: block;
  }
  #signal-headline-row { border-bottom: 1px solid var(--border); padding-bottom: 20px; }
  #signal-headline-text {
    font-size: 13px;
    color: var(--text-display);
    line-height: 1.55;
    max-width: 80ch;
  }
  #signal-cards-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
  }
  .signal-card {
    border: 1px solid var(--border);
    padding: 14px 16px;
    background: var(--surface-raised);
  }
  .signal-card-label {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }
  .signal-card-value {
    font-size: 12px;
    color: var(--text-display);
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .signal-insight-row {
    display: grid;
    grid-template-columns: 52px 1fr auto;
    gap: 12px;
    align-items: baseline;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .signal-insight-row:last-child { border-bottom: none; }
  .signal-insight-priority { color: var(--text-secondary); font-size: 9px; }
  .signal-insight-topic { color: var(--text-display); }
  .signal-insight-why { color: var(--text-secondary); font-size: 10px; text-align: right; max-width: 40ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (max-width: 900px) {
    #founders-shell { padding: 32px 24px 64px; }
    #capability-grid { grid-template-columns: 1fr; }
    .tile {
      aspect-ratio: auto;
      min-height: 220px;
      grid-template-areas:
        "num"
        "head"
        "desc"
        "viz"
        "foot";
      grid-template-columns: 1fr;
      row-gap: 14px;
    }
    .tile-description { max-width: none; }
    .log-line {
      grid-template-columns: 1fr;
      gap: 4px;
    }
  }
`;

export default DashboardPage;
