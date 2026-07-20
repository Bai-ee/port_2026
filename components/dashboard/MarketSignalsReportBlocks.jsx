'use client';

import React from 'react';

// REPORT tab = the brief, built ENTIRELY from the brief-kit UI components
// (.brief-kit scope ported from dashboard-modal-component-style-guide.html).
// Extracted from DashboardPage.jsx's render* helpers for the Market Signals
// REPORT tab (parseRecipeAnalysis / renderProse / renderReplyTargetsBlock /
// renderRedditAnalysisBlock / renderInstagramAnalysisBlock /
// renderRecipeBriefBlock / renderWatchlistAnalysisBlock). Both
// parseRecipeAnalysis and Prose are pure and used only by these blocks, so
// they moved along with their only consumers rather than staying behind as
// dead weight in DashboardPage.jsx.

// Extract the leading JSON object + trailing prose from a recipe's analysis
// output (recipes emit "{...json...}\n\n<prose synthesis>").
export function parseRecipeAnalysis(text) {
  if (!text || typeof text !== 'string') return { data: null, prose: '' };
  const start = text.indexOf('{');
  if (start === -1) return { data: null, prose: text.trim() };
  let depth = 0, end = -1, inStr = false, esc = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return { data: null, prose: text.trim() };
  let data = null;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { data = null; }
  return { data, prose: text.slice(end + 1).trim() };
}

// Render the recipe's trailing prose as clean brief copy — strips code fences,
// turns `## heading` into a section label, drops `---` rules, and renders
// `**bold**` inline. Prevents raw markdown tokens from leaking into the mock.
export function Prose({ text, keyPrefix }) {
  if (!text) return null;
  const cleaned = text.replace(/```[a-z]*\n?/gi, '').trim();
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (
    /^\*\*[^*]+\*\*$/.test(p)
      ? <strong key={`${k}-b${i}`}>{p.slice(2, -2)}</strong>
      : <React.Fragment key={`${k}-t${i}`}>{p}</React.Fragment>
  ));
  return cleaned.split(/\n{2,}/).map((raw, i) => {
    const block = raw.trim();
    const k = `${keyPrefix}-pb-${i}`;
    if (!block || /^-{3,}$/.test(block)) return null;
    if (/^#{1,6}\s/.test(block)) return <div key={k} className="b-sec">{block.replace(/^#{1,6}\s+/, '')}</div>;
    const lines = block.split(/\n/).map((l) => l.trim()).filter((l) => l && !/^-{3,}$/.test(l));
    return (
      <p key={k} className="b-body">
        {lines.map((l, j) => (
          <React.Fragment key={`${k}-l${j}`}>{j ? <br /> : null}{inline(l.replace(/^#{1,6}\s+/, ''), `${k}-${j}`)}</React.Fragment>
        ))}
      </p>
    );
  });
}

// Render the Reply Targets skill — ranked posts worth replying to, each with a
// drafted reply, plus a one-click hand-off to Post Me (creates draft replies).
export function ReplyTargetsBlock({ res, replyDraftState, sendReplyTargetsToPostMe }) {
  const { data, prose } = parseRecipeAnalysis(res.analysis);
  const targets = Array.isArray(data?.replyTargets) ? data.replyTargets : [];
  const tierLabel = (t) => (t === 1 ? 'Tier 1 · relationship' : t === 2 ? 'Tier 2 · visibility' : t === 3 ? 'Tier 3 · light touch' : '');
  // Only targets with a drafted reply can become Post Me drafts.
  const sendable = targets
    .filter((t) => String(t?.suggestedReply || '').trim())
    .map((t) => ({ author: t.author, url: t.url, text: t.text, source: t.source, suggestedReply: t.suggestedReply }));
  return (
    <div className="kit-paper" key={`recipe-brief-${res.recipeId}`} id="recipe-brief-reply-targets">
      <h2 className="b-headline">Worth Replying To</h2>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '0 0 16px' }}>
        <button
          type="button"
          className="sg-btn sg-cta"
          disabled={replyDraftState.busy || !sendable.length}
          onClick={() => sendReplyTargetsToPostMe(sendable)}
        >
          {replyDraftState.busy ? 'Sending…' : `Send ${sendable.length || ''} repl${sendable.length === 1 ? 'y' : 'ies'} to Post Me`}
        </button>
        {replyDraftState.msg ? <span className="sg-result-body" style={{ margin: 0 }}>{replyDraftState.msg}</span> : null}
        {replyDraftState.error ? <span className="sg-notice sg-notice-danger" style={{ margin: 0 }}>{replyDraftState.error}</span> : null}
      </div>

      {data?.poolNote ? <div className="b-sowhat" style={{ marginBottom: 16 }}><span className="lbl">Pool</span>{data.poolNote}</div> : null}

      {targets.length ? (
        <div className="b-stack">
          {targets.map((t, i) => (
            <div className="b-card" key={`rt-${i}`}>
              <div className="b-theme-head">
                <span className="b-handle-name">{t.author || 'unknown'}</span>
                <span className="b-tags">
                  {t.score != null ? <span className="status-tag">{t.score}/10</span> : null}
                  {t.tier ? <span className="dur">{tierLabel(t.tier)}</span> : null}
                  {t.source ? <span className="dur">{t.source}</span> : null}
                </span>
              </div>
              {t.text ? <p className="pull" style={{ margin: '12px 0 0', maxWidth: 'none' }}>“{t.text}”</p> : null}
              {t.url ? <p className="b-body mono" style={{ fontSize: 11, margin: '6px 0 0', color: 'var(--ink-soft)' }}><a className="b-link" href={t.url} target="_blank" rel="noopener noreferrer">↗ post</a></p> : null}
              {t.why ? <div className="b-sowhat"><span className="lbl">Why</span>{t.why}</div> : null}
              {t.suggestedReply ? <p className="b-body" style={{ margin: '10px 0 0' }}><strong>Draft reply:</strong> {t.suggestedReply}</p> : null}
              {t.algoRationale ? <div className="b-sowhat rt-algo-read" data-section="reply-algo-read" style={{ marginTop: 10 }}><span className="lbl">Algorithm read</span>{t.algoRationale}</div> : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="b-body">No reply targets this run. Pull the Watchlist with <strong>Mentions</strong> on (or run a brief), then re-run this skill.</p>
      )}

      {prose ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Today’s move</div>
          <div style={{ marginTop: 4 }}><Prose text={prose} keyPrefix="prose-reply-targets" /></div>
        </>
      ) : null}
    </div>
  );
}

// Render the Reddit analysis skill as the same "What's happening" structure
// used by digest email/brief output: overview, suggested move, and threads.
export function RedditAnalysisBlock({ res }) {
  const { data, prose } = parseRecipeAnalysis(res.analysis);
  const dq = data?.dataQuality || null;
  const conf = dq?.overallConfidence;
  const threads = Array.isArray(data?.threads) ? data.threads : (Array.isArray(data?.items) ? data.items : []);
  const spotlight = data?.spotlight || null;
  return (
    <div className="kit-paper" key={`recipe-brief-${res.recipeId}`} id="recipe-brief-reddit-analysis">
      <h2 className="b-headline">Happening on Reddit</h2>

      {dq ? (
        <div className="meta-grid" style={{ marginBottom: 18 }}>
          <div className="meta-tile"><div className="k">Threads analyzed</div><div className="v">{dq.itemsAnalyzed != null ? dq.itemsAnalyzed : '—'}</div></div>
          <div className="meta-tile"><div className="k">Confidence</div><div className="v">{conf || '—'}</div></div>
          <div className="meta-tile"><div className="k">Cost</div><div className="v">{typeof res.costUsd === 'number' && res.costUsd > 0 ? `≈ $${res.costUsd.toFixed(3)}` : '—'}</div></div>
        </div>
      ) : null}

      {data?.overview ? (
        <>
          <div className="b-sec">Overview</div>
          <p className="pull" style={{ marginTop: 8, maxWidth: 'none' }}>{data.overview}</p>
        </>
      ) : null}

      {data?.priorityAction ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Suggested action</div>
          <p className="pull" style={{ marginTop: 8, maxWidth: 'none' }}>{data.priorityAction}</p>
        </>
      ) : null}

      {spotlight?.why ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Thread to watch</div>
          <div className="b-card">
            <div className="b-theme-head">
              <span className="b-handle-name">{spotlight.title || 'Reddit thread'}</span>
              <span className="b-tags">
                {spotlight.subreddit ? <span className="dur">{spotlight.subreddit}</span> : null}
                {spotlight.url ? <a className="b-link" href={spotlight.url} target="_blank" rel="noopener noreferrer">source</a> : null}
              </span>
            </div>
            <p className="b-body" style={{ margin: '10px 0 0' }}>{spotlight.why}</p>
          </div>
        </>
      ) : null}

      {threads.length ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Threads</div>
          <div className="b-stack">
            {threads.map((t, i) => (
              <div className="b-card" key={`reddit-thread-${i}`}>
                <div className="b-theme-head">
                  <span className="b-handle-name">{t.title || 'Reddit signal'}</span>
                  <span className="b-tags">
                    {t.subreddit ? <span className="dur">{t.subreddit}</span> : null}
                    {t.signalType ? <span className="status-tag">{t.signalType}</span> : null}
                    {t.url ? <a className="b-link" href={t.url} target="_blank" rel="noopener noreferrer">source</a> : null}
                  </span>
                </div>
                {t.summary ? <p className="b-body" style={{ margin: '10px 0 0' }}>{t.summary}</p> : null}
                {t.actionableTakeaway ? <div className="b-sowhat"><span className="lbl">So what</span>{t.actionableTakeaway}</div> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {Array.isArray(dq?.gaps) && dq.gaps.length ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>What we still don&apos;t know</div>
          <div className="b-stack">
            {dq.gaps.map((g, i) => (
              <p className="b-body" key={`reddit-gap-${i}`} style={{ margin: 0 }}>• {g}</p>
            ))}
          </div>
        </>
      ) : null}

      {prose ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Summary</div>
          <div style={{ marginTop: 4 }}><Prose text={prose} keyPrefix="prose-reddit-analysis" /></div>
        </>
      ) : null}
    </div>
  );
}

// Instagram mirror of RedditAnalysisBlock — same "Happening on …" structure,
// relabeled for IG accounts/posts.
export function InstagramAnalysisBlock({ res }) {
  const { data, prose } = parseRecipeAnalysis(res.analysis);
  const dq = data?.dataQuality || null;
  const conf = dq?.overallConfidence;
  const threads = Array.isArray(data?.threads) ? data.threads : (Array.isArray(data?.items) ? data.items : []);
  const spotlight = data?.spotlight || null;
  return (
    <div className="kit-paper" key={`recipe-brief-${res.recipeId}`} id="recipe-brief-instagram-analysis">
      <h2 className="b-headline">Happening on Instagram</h2>

      {dq ? (
        <div className="meta-grid" style={{ marginBottom: 18 }}>
          <div className="meta-tile"><div className="k">Posts analyzed</div><div className="v">{dq.itemsAnalyzed != null ? dq.itemsAnalyzed : '—'}</div></div>
          <div className="meta-tile"><div className="k">Confidence</div><div className="v">{conf || '—'}</div></div>
          <div className="meta-tile"><div className="k">Cost</div><div className="v">{typeof res.costUsd === 'number' && res.costUsd > 0 ? `≈ $${res.costUsd.toFixed(3)}` : '—'}</div></div>
        </div>
      ) : null}

      {data?.overview ? (
        <>
          <div className="b-sec">Overview</div>
          <p className="pull" style={{ marginTop: 8, maxWidth: 'none' }}>{data.overview}</p>
        </>
      ) : null}

      {data?.priorityAction ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Suggested action</div>
          <p className="pull" style={{ marginTop: 8, maxWidth: 'none' }}>{data.priorityAction}</p>
        </>
      ) : null}

      {spotlight?.why ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Post to watch</div>
          <div className="b-card">
            <div className="b-theme-head">
              <span className="b-handle-name">{spotlight.title || 'Instagram post'}</span>
              <span className="b-tags">
                {spotlight.subreddit ? <span className="dur">{spotlight.subreddit}</span> : null}
                {spotlight.url ? <a className="b-link" href={spotlight.url} target="_blank" rel="noopener noreferrer">source</a> : null}
              </span>
            </div>
            <p className="b-body" style={{ margin: '10px 0 0' }}>{spotlight.why}</p>
          </div>
        </>
      ) : null}

      {threads.length ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Posts</div>
          <div className="b-stack">
            {threads.map((t, i) => (
              <div className="b-card" key={`instagram-post-${i}`}>
                <div className="b-theme-head">
                  <span className="b-handle-name">{t.title || 'Instagram signal'}</span>
                  <span className="b-tags">
                    {t.subreddit ? <span className="dur">{t.subreddit}</span> : null}
                    {t.signalType ? <span className="status-tag">{t.signalType}</span> : null}
                    {t.url ? <a className="b-link" href={t.url} target="_blank" rel="noopener noreferrer">source</a> : null}
                  </span>
                </div>
                {t.summary ? <p className="b-body" style={{ margin: '10px 0 0' }}>{t.summary}</p> : null}
                {t.actionableTakeaway ? <div className="b-sowhat"><span className="lbl">So what</span>{t.actionableTakeaway}</div> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {Array.isArray(dq?.gaps) && dq.gaps.length ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>What we still don&apos;t know</div>
          <div className="b-stack">
            {dq.gaps.map((g, i) => (
              <p className="b-body" key={`instagram-gap-${i}`} style={{ margin: 0 }}>• {g}</p>
            ))}
          </div>
        </>
      ) : null}

      {prose ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Summary</div>
          <div style={{ marginTop: 4 }}><Prose text={prose} keyPrefix="prose-instagram-analysis" /></div>
        </>
      ) : null}
    </div>
  );
}

// Render one recipe synthesis as a brief-kit paper (UI-kit components only —
// b-eyebrow / b-headline / meta-grid / b-grid / b-card / stat-row / pull / dur).
export function RecipeBriefBlock({ res, recipeCatalog }) {
  const meta = recipeCatalog.find((r) => r.id === res.recipeId);
  const { data, prose } = parseRecipeAnalysis(res.analysis);
  const themes = Array.isArray(data?.themes) ? data.themes : [];
  const jtbd = Array.isArray(data?.jobsToBeDone) ? data.jobsToBeDone : [];
  const vocab = Array.isArray(data?.vocabulary) ? data.vocabulary : [];
  const alternatives = Array.isArray(data?.alternatives) ? data.alternatives : [];
  const contradictions = Array.isArray(data?.contradictions) ? data.contradictions : [];
  const dq = data?.dataQuality || null;
  const gaps = Array.isArray(dq?.gaps) ? dq.gaps : [];
  const conf = dq?.overallConfidence;
  const confClass = (c) => (c === 'low' ? ' warn' : c === 'high' ? ' ok' : '');
  return (
    <div className="kit-paper" key={`recipe-brief-${res.recipeId}`} id={`recipe-brief-${res.recipeId}`}>
      <h2 className="b-headline">{meta?.label || 'Analysis'}</h2>

      {dq ? (
        <div className="meta-grid" style={{ marginBottom: 18 }}>
          <div className="meta-tile"><div className="k">Signals analyzed</div><div className="v">{dq.itemsAnalyzed != null ? dq.itemsAnalyzed : '—'}</div></div>
          <div className="meta-tile"><div className="k">Confidence</div><div className="v">{conf || '—'}</div></div>
          <div className="meta-tile"><div className="k">Cost</div><div className="v">{typeof res.costUsd === 'number' && res.costUsd > 0 ? `≈ $${res.costUsd.toFixed(3)}` : '—'}</div></div>
        </div>
      ) : null}

      {/* Summary first — the human TL;DR, then the structured pieces below. */}
      {prose ? (
        <>
          <div className="b-sec">Summary</div>
          <div style={{ marginTop: 4 }}><Prose text={prose} keyPrefix={`prose-${res.recipeId}`} /></div>
        </>
      ) : null}

      {themes.length ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Themes</div>
          <div className="b-stack">
            {themes.map((t, i) => {
              const q = Array.isArray(t.quotes) ? t.quotes[0] : null;
              return (
                <div className="b-card" key={`th-${res.recipeId}-${i}`}>
                  <div className="b-theme-head">
                    <span className="b-handle-name">{t.name}</span>
                    <span className="b-tags">
                      {t.confidence ? <span className={`status-tag${confClass(t.confidence)}`}>{t.confidence} conf</span> : null}
                      {t.intensity ? <span className="dur">{t.intensity} intensity</span> : null}
                      {t.frequency != null ? <span className="dur">{t.frequency}× seen</span> : null}
                    </span>
                  </div>
                  {t.summary ? <p className="b-body" style={{ margin: '10px 0 0' }}>{t.summary}</p> : null}
                  {q?.quote ? <p className="pull" style={{ margin: '12px 0 0', maxWidth: 'none' }}>“{q.quote}”</p> : null}
                  {(q?.source || q?.url) ? (
                    <p className="b-body mono" style={{ fontSize: 11, margin: '6px 0 0', color: 'var(--ink-soft)' }}>{q?.source || ''}{q?.url ? <> · <a className="b-link" href={q.url} target="_blank" rel="noopener noreferrer">↗ source</a></> : null}</p>
                  ) : null}
                  {t.implication ? <div className="b-sowhat"><span className="lbl">So what</span>{t.implication}</div> : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {jtbd.length ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Jobs to be done</div>
          <div className="b-stack">
            {jtbd.map((j, i) => (
              <div className="meta-grid" key={`jtbd-${res.recipeId}-${i}`}>
                <div className="meta-tile"><div className="k">Functional</div><div className="v">{j.functional || '—'}</div></div>
                <div className="meta-tile"><div className="k">Emotional</div><div className="v">{j.emotional || '—'}</div></div>
                <div className="meta-tile"><div className="k">Social</div><div className="v">{j.social || '—'}</div></div>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {vocab.length ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Customer vocabulary</div>
          <div className="dur-row">
            {vocab.slice(0, 18).map((v, i) => <span className="dur" key={`vc-${res.recipeId}-${i}`}>“{v}”</span>)}
          </div>
        </>
      ) : null}

      {alternatives.length ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Alternatives considered</div>
          <div className="dur-row">
            {alternatives.map((v, i) => <span className="dur" key={`alt-${res.recipeId}-${i}`}>{v}</span>)}
          </div>
        </>
      ) : null}

      {contradictions.length ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Contradictions</div>
          <div className="b-stack">
            {contradictions.map((c, i) => (
              <div className="b-card" key={`con-${res.recipeId}-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span className="status-tag warn" style={{ flexShrink: 0 }}>flag</span>
                <p className="b-body" style={{ margin: 0 }}>{c}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {gaps.length ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>What we still don’t know</div>
          <div className="b-stack">
            {gaps.map((g, i) => (
              <p className="b-body" key={`gap-${res.recipeId}-${i}`} style={{ margin: 0 }}>• {g}</p>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// Top-of-report scribe — the overall read over the watchlist data.
export function WatchlistAnalysisBlock({ a }) {
  if (!a || !a.text) return null;
  const { data, prose } = parseRecipeAnalysis(a.text);
  const spot = data?.spotlight;
  const spotHandle = spot?.handle ? String(spot.handle).replace(/^@+/, '') : '';
  // Bold tracked handle names (with or without @) wherever they appear in free-form text.
  const handleNames = Array.from(new Set(
    (Array.isArray(data?.handles) ? data.handles : [])
      .map((h) => String(h.handle || '').replace(/^@+/, '').trim())
      .filter(Boolean)
  ));
  const boldHandles = (text) => {
    if (!text || !handleNames.length) return text;
    const escaped = handleNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(@?(?:${escaped.join('|')})\\b)`, 'gi');
    return String(text).split(re).map((part, i) => {
      const bare = part.replace(/^@+/, '');
      return handleNames.some((n) => n.toLowerCase() === bare.toLowerCase())
        ? <strong key={i}>{part}</strong>
        : part;
    });
  };
  return (
    <div className="kit-paper" id="watchlist-analysis-block">
      <h2 className="b-headline">Happening on X</h2>
      {data?.overview ? (
        <>
          <div className="b-sec" style={{ marginTop: 4 }}>Overview</div>
          <p className="pull" style={{ marginTop: 8, maxWidth: 'none' }}>{boldHandles(data.overview)}</p>
        </>
      ) : null}
      {data?.priorityAction ? (
        <>
          <div className="b-sec" style={{ marginTop: 22 }}>Suggested action</div>
          <p className="pull" style={{ marginTop: 8, maxWidth: 'none' }}>{data.priorityAction}</p>
        </>
      ) : null}
      {Array.isArray(data?.handles) && data.handles.length ? (
        <>
          <div className="b-sec" style={{ marginTop: 18 }}>Per handle</div>
          <div className="b-handle-grid">
            {data.handles.map((h, i) => {
              const hh = String(h.handle || '').replace(/^@+/, '');
              return (
                <div className="b-card b-handle-card" key={`wla-${i}`}>
                  <span className="b-handle-name">@{hh}</span>
                  {h.posting ? <p className="b-body" style={{ margin: '8px 0 0' }}>{h.posting}</p> : null}
                  {h.talkedAbout ? (
                    <div className="b-handle-foot">
                      <div className="b-sec">Talked about</div>
                      <p className="b-body" style={{ margin: '3px 0 0' }}>{h.talkedAbout}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
      {spot?.why ? (
        <div className="b-feature" style={{ marginTop: 22 }}>
          <div className="lbl">Spotlight · @{spotHandle}</div>
          <div className="txt">{spot.why}</div>
        </div>
      ) : null}
      {!data && prose ? <Prose text={prose} keyPrefix="wla" /> : null}
    </div>
  );
}
