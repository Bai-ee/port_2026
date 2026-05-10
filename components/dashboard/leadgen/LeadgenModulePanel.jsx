'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

// Reuses the exact BrandSystemChat visual shell:
//   #lgmc-shell → #lgmc-header (avatar + online dot + name + step count)
//   #lgmc-progress-rail → #lgmc-progress-fill
//   #lgmc-messages → chat-row / chat-avatar-sm / chat-bubble / chat-bubble-bot
// CSS mirrors bsc-* rules 1:1 so both panels look identical.

const STAGE_CHAT = {
  // analysis modules
  fetch:          'Connecting to the website…',
  analyze:        'Analysing design tokens and content…',
  synthesize:     'Running AI synthesis…',
  skill:          'Running skill analysis…',
  'ai-seo':       'Checking AI visibility signals…',
  'agent-ready':  'Probing agent-readiness signals…',
  capture:        'Capturing screenshots…',
  compose:        'Compositing device mockup…',
  normalize:      'Wrapping up…',
  persist:        'Saving results…',
  // prepare-brief stages
  brief:          'Building creative brief from scraped data…',
  // generate-mockup stages
  mockup:         'Generating visual concept with gpt-image-2…',
  // fetch-references stages
  references:     'Querying Lazyweb for vertical-matched design references…',
  // generate-site stages
  prompt:         'Building generation prompt…',
  generate:       'Generating homepage with Claude Sonnet — this takes ~30s…',
  validate:       'Validating HTML output…',
  deploy:         'Deploying preview to Vercel…',
  compare:        'Running AI Readiness before/after comparison…',
};

// Human-readable completion messages per module
function buildDoneMessage(moduleId, result, succeeded) {
  if (!succeeded) return 'Analysis finished with errors — check the terminal for details.';
  switch (moduleId) {
    case 'seo-performance': {
      const s = result?.pagespeed;
      if (!s) return 'SEO + Performance analysis complete.';
      return `Done. PageSpeed — Perf: ${s.performance ?? '—'} · A11y: ${s.accessibility ?? '—'} · SEO: ${s.seo ?? '—'} · Best Practices: ${s.bestPractices ?? '—'}.`;
    }
    case 'agent-readiness': {
      const score = result?.score;
      const verdict = result?.verdict;
      if (score == null) return 'AI Readiness analysis complete.';
      return `Done. Agent Readiness: ${score}/100${verdict ? ` — ${verdict}` : ''}.`;
    }
    case 'social-preview': {
      const m = result?.siteMeta;
      if (!m) return 'Social Preview complete — no meta tags found.';
      return `Done. ${m.ogTitle ? 'OG title found.' : 'No OG title.'} ${m.ogImage ? 'OG image present.' : 'No OG image.'} Twitter card: ${m.twitterCard || 'none'}.`;
    }
    case 'multi-device-view':
      return `Done. ${result?.mockupUrl ? 'Device mockup generated — desktop, tablet, and mobile captured.' : 'Screenshots captured.'}`;
    case 'design-evaluation': {
      const colors = result?.styleGuide?.colors?.length ?? 0;
      const fonts  = result?.styleGuide?.typography?.length ?? 0;
      return `Done. ${colors} colour token${colors !== 1 ? 's' : ''} and ${fonts} typography token${fonts !== 1 ? 's' : ''} extracted.`;
    }
    case 'design-references': {
      const count = result?.totalImages ?? 0;
      const sections = result?.sections?.length ?? 0;
      if (!count) return 'No design references found — try running after setting the prospect vertical.';
      return `Done. ${count} reference image${count !== 1 ? 's' : ''} across ${sections} section${sections !== 1 ? 's' : ''} — ready for site generation.`;
    }
    case 'generate-mockup': {
      const url = result?.mockupUrl;
      return url ? 'Visual mockup generated — review it then click Generate Site.' : 'Mockup generation complete.';
    }
    case 'prepare-brief': {
      const lines = result?.lines;
      const services = result?.services;
      return lines
        ? `Brief ready — ${lines} lines · ${services} service${services !== 1 ? 's' : ''} scraped. Review then click Generate Site.`
        : 'Creative brief generated.';
    }
    case 'generate-site': {
      const url = result?.previewUrl;
      const c   = result?.comparison;
      if (!url) return 'Site generated.';
      if (c?.before?.score != null && c?.after?.score != null) {
        return `Done. Preview live. AI Readiness: ${c.before.score} → ${c.after.score} (+${c.improvement ?? '?'} points).`;
      }
      return `Preview deployed — ${url}`;
    }
    default:
      return 'Analysis complete.';
  }
}

export default function LeadgenModulePanel({
  open, placeId, moduleId, moduleLabel, endpoint, getIdToken, onClose, onDone,
}) {
  const [termLines,    setTermLines]    = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [phase,        setPhase]        = useState('idle');
  const [progress,     setProgress]     = useState(0); // 0..100 for the rail

  const termRef      = useRef(null);
  const chatRef      = useRef(null);
  const abortRef     = useRef(null);
  const lastStageRef = useRef(null);
  const msgIdRef     = useRef(0);

  const nextId = () => `lgm-${++msgIdRef.current}`;

  // Lock body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Auto-scroll both columns
  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [termLines]);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, phase]);

  // Start run on open
  useEffect(() => {
    if (!open || !placeId || !moduleId) return;
    runModule();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placeId, moduleId]);

  const appendTerm = useCallback((type, prefix, text, cursor = false) => {
    setTermLines((prev) => {
      const base = cursor ? prev.filter((l) => !l.cursor) : prev;
      return [...base, { type, prefix, text, cursor }];
    });
  }, []);

  const appendChat = useCallback((text) => {
    setChatMessages((prev) => [...prev, { id: nextId(), text }]);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function runModule() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    lastStageRef.current = null;

    setTermLines([]);
    setChatMessages([]);
    setPhase('running');
    setProgress(5);

    appendTerm('info', '▶', `Starting ${moduleLabel || moduleId}…`, true);
    appendChat(`Starting **${moduleLabel || moduleId}** analysis…`);

    const token = await getIdToken?.();

    let res;
    try {
      res = await fetch(endpoint || '/api/leadgen/module', {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ placeId, moduleId }),
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      setPhase('failed');
      appendTerm('error', '✕', err.message);
      appendChat(`Error: ${err.message}`);
      return;
    }

    if (!res.ok) {
      setPhase('failed');
      const txt = await res.text().catch(() => '');
      const msg = `HTTP ${res.status}${txt ? ': ' + txt.slice(0, 120) : ''}`;
      appendTerm('error', '✕', msg);
      appendChat(`Failed — ${msg}`);
      return;
    }

    // Stage order used to advance the progress rail
    const STAGES = ['fetch', 'analyze', 'capture', 'skill', 'ai-seo', 'agent-ready', 'synthesize', 'compose', 'normalize', 'persist'];
    let stageIdx = 0;

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n');
        buf = parts.pop();

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          let evt;
          try { evt = JSON.parse(trimmed); } catch { continue; }

          if (evt.type === 'start') {
            appendTerm('info', '→', `Target: ${evt.websiteUrl}`);
            appendChat(`Target: ${evt.websiteUrl}`);

          } else if (evt.type === 'progress') {
            appendTerm('info', '·', evt.label || evt.stage, true);
            const stage = evt.stage;
            if (stage && stage !== lastStageRef.current && STAGE_CHAT[stage]) {
              lastStageRef.current = stage;
              appendChat(STAGE_CHAT[stage]);
              const idx = STAGES.indexOf(stage);
              if (idx !== -1) {
                stageIdx = Math.max(stageIdx, idx);
                setProgress(Math.round(10 + (stageIdx / STAGES.length) * 80));
              }
            }

          } else if (evt.type === 'done') {
            const succeeded = evt.status !== 'failed';
            appendTerm('ok', '✓', succeeded ? 'Complete' : 'Finished with warnings');
            setPhase(succeeded ? 'done' : 'failed');
            setProgress(100);
            appendChat(buildDoneMessage(moduleId, evt.result, succeeded));
            onDone?.(evt.result);

          } else if (evt.type === 'error') {
            appendTerm('error', '✕', evt.message || 'Unknown error');
            appendChat(`Error: ${evt.message || 'Unknown error'}`);
            setPhase('failed');
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setPhase('failed');
        appendTerm('error', '✕', err.message);
        appendChat(`Error: ${err.message}`);
      }
    }
  }

  const statusDotColor = phase === 'failed' ? '#D71921' : phase === 'done' ? '#4A9E5C' : '#D4A843';
  const statusPulse    = phase === 'running' ? 'status-pulse 1.4s ease-in-out infinite' : 'none';
  const marqueeText    = `${(moduleLabel || moduleId || '').toUpperCase()}  ·  ANALYSIS  ·  `;
  const onlineDotColor = phase === 'done' ? '#4A9E5C' : phase === 'failed' ? '#D71921' : '#D4A843';

  return (
    <div
      id="intake-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${moduleLabel || moduleId} run`}
      style={open ? undefined : { display: 'none' }}
    >
      <div
        id="intake-modal-card"
        data-with-survey="true"
        style={{
          position: 'relative', zIndex: 2, width: '100%', maxWidth: '52rem',
          padding: 'clamp(1.25rem, 5vw, 2rem)', borderRadius: '10px', boxSizing: 'border-box',
          background: 'rgba(255,255,255,0.6)', backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow: '0px 5px 10px rgba(0,0,0,0.1), 0px 15px 30px rgba(0,0,0,0.1), 0px 20px 40px rgba(0,0,0,0.15)',
          border: '1px solid rgba(255,255,255,0.5)',
        }}
      >
        {/* Brand row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem', justifyContent: 'space-between' }}>
          <img src="/img/sig.png" alt="" aria-hidden="true" style={{ width: '2.75rem', height: 'auto', display: 'block' }} />
          <span style={{ fontSize: '0.82rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.44)', fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
            {moduleLabel || moduleId}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2.4rem', height: '2.4rem', borderRadius: '999px', background: 'rgba(255,255,255,0.34)', border: '1px solid rgba(42,36,32,0.12)' }} aria-hidden="true">
            <span style={{ width: '0.46rem', height: '0.46rem', borderRadius: '999px', background: statusDotColor, animation: statusPulse }} />
          </span>
        </div>

        {/* Marquee */}
        <div style={{ width: '100%', overflow: 'hidden', margin: '0 0 0.7rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', animation: 'lgm-marquee 14s linear infinite', willChange: 'transform' }}>
            {['a', 'b'].map((k) => (
              <span key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={{ flexShrink: 0, whiteSpace: 'nowrap', color: '#2a2420', fontSize: 'clamp(1.5rem, 5vw, 3.4rem)', lineHeight: 1.05, letterSpacing: '-0.04em', fontFamily: '"Doto", "Space Mono", monospace', fontWeight: 700 }}>
                {marqueeText}
              </span>
            ))}
          </div>
        </div>

        {/* Body: terminal (left) + chat (right) */}
        <div id="intake-modal-body">

          {/* ── Terminal column ── */}
          <div id="intake-modal-terminal-col">
            <div id="intake-modal-terminal-titlebar">
              <span className="term-win-dot term-win-dot-close" />
              <span className="term-win-dot term-win-dot-min" />
              <span className="term-win-dot term-win-dot-max" />
              <span id="intake-modal-terminal-title">{moduleId}.run</span>
            </div>
            <div id="intake-modal-terminal-embed" ref={termRef}>
              {termLines.map((line, i) => (
                <div key={`t-${i}`} className={`term-line term-${line.type}`}>
                  <span className="term-pfx">{line.prefix}</span>
                  <span className="term-msg">{line.text}</span>
                  {line.cursor ? <span className="term-caret" /> : null}
                </div>
              ))}
            </div>
          </div>

          {/* ── Chat column — exact BrandSystemChat shell ── */}
          <div id="intake-modal-survey-col" data-resolved={phase === 'done' ? 'true' : 'false'}>
            <div id="lgmc-shell">

              {/* Header — mirrors #bsc-header */}
              <div id="lgmc-header">
                <div id="lgmc-avatar-wrap">
                  <img id="lgmc-avatar-img" src="/img/profile2_400x400.png" alt="" aria-hidden="true" />
                  <span id="lgmc-online-dot" style={{ background: onlineDotColor }} aria-hidden="true" />
                </div>
                <div id="lgmc-identity">
                  <span id="lgmc-name">{moduleLabel || 'Analysis'}</span>
                </div>
              </div>

              {/* Progress rail — mirrors #bsc-progress-rail */}
              <div id="lgmc-progress-rail" aria-hidden="true">
                <span id="lgmc-progress-fill" style={{ width: `${progress}%` }} />
              </div>

              {/* Messages — mirrors #bsc-messages */}
              <div id="lgmc-messages" ref={chatRef}>
                {chatMessages.map((msg) => (
                  <div key={msg.id} className="chat-row chat-row-bot">
                    <img className="chat-avatar-sm" src="/img/profile2_400x400.png" alt="" aria-hidden="true" />
                    <div className="chat-bubble chat-bubble-bot">
                      {msg.text}
                    </div>
                  </div>
                ))}

                {/* Typing indicator while running */}
                {phase === 'running' && (
                  <div className="chat-row chat-row-bot">
                    <img className="chat-avatar-sm" src="/img/profile2_400x400.png" alt="" aria-hidden="true" />
                    <div className="chat-bubble chat-bubble-bot chat-typing-bubble">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                    </div>
                  </div>
                )}

                {/* Re-run after finish */}
                {(phase === 'done' || phase === 'failed') && (
                  <button
                    type="button"
                    onClick={runModule}
                    style={{ alignSelf: 'flex-start', marginTop: 6, fontFamily: '"Space Mono", monospace', fontSize: '0.68rem', background: 'none', border: '1px solid rgba(42,36,32,0.18)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', color: 'rgba(42,36,32,0.5)', letterSpacing: '0.06em' }}
                  >
                    Re-run
                  </button>
                )}
              </div>

            </div>
          </div>
        </div>

        {/* Footer */}
        <div id="intake-modal-footer">
          <span id="intake-modal-footer-host">leadgen · {moduleId}</span>
          <button type="button" id="intake-modal-footer-cancel" onClick={onClose} aria-label={`Close ${moduleLabel || moduleId}`}>
            [ close ]
          </button>
        </div>
      </div>

      <style>{`
        @keyframes lgm-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }

        /* Shell — exact mirror of #bsc-shell */
        #lgmc-shell {
          display: flex; flex-direction: column;
          width: 100%; min-height: 0; flex: 1 1 auto;
          background: linear-gradient(180deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.5) 100%);
          box-shadow: 0 5px 10px rgba(0,0,0,0.1), 0 15px 30px rgba(0,0,0,0.1), 0 20px 40px rgba(0,0,0,0.15);
          backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
          border-radius: 10px; border: 1px solid rgba(42,36,32,0.1); overflow: hidden;
        }

        /* Header — exact mirror of #bsc-header */
        #lgmc-header {
          display: flex; align-items: center; gap: 0.65rem;
          padding: 0.75rem 1rem;
          border-bottom: 1px solid rgba(42,36,32,0.08);
          background: rgba(255,255,255,0.7); flex-shrink: 0;
        }
        #lgmc-avatar-wrap { position: relative; flex-shrink: 0; }
        #lgmc-avatar-img { width: 2.4rem; height: 2.4rem; border-radius: 999px; object-fit: cover; display: block; }
        #lgmc-online-dot {
          position: absolute; bottom: 1px; right: 1px;
          width: 0.55rem; height: 0.55rem; border-radius: 999px;
          border: 2px solid rgba(255,252,248,0.92); transition: background 0.3s;
        }
        #lgmc-identity { display: flex; flex-direction: column; gap: 0.15rem; flex: 1; min-width: 0; }
        #lgmc-name { font-family: "Space Grotesk", system-ui, sans-serif; font-weight: 700; font-size: 0.88rem; color: #2a2420; line-height: 1.2; }

        /* Progress rail — exact mirror of #bsc-progress-rail */
        #lgmc-progress-rail { height: 2px; background: rgba(42,36,32,0.08); flex-shrink: 0; position: relative; overflow: hidden; }
        #lgmc-progress-fill {
          display: block; height: 100%;
          background: linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%);
          transition: width 0.35s ease;
        }

        /* Messages — exact mirror of #bsc-messages */
        #lgmc-messages {
          flex: 1 1 auto; min-height: 0; overflow-y: auto;
          -webkit-overflow-scrolling: touch;
          padding: 1rem; display: flex; flex-direction: column; gap: 0.65rem;
          scrollbar-width: thin; scrollbar-color: rgba(42,36,32,0.14) transparent;
          overscroll-behavior: contain;
        }
        #lgmc-messages::-webkit-scrollbar { width: 3px; }
        #lgmc-messages::-webkit-scrollbar-thumb { background: rgba(42,36,32,0.14); border-radius: 2px; }
        #lgmc-messages::-webkit-scrollbar-track { background: transparent; }
      `}</style>
    </div>
  );
}
