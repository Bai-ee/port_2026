'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { buildQuotedPreview } from '../../../features/x-quote-targets/quoted-preview.js';
import { quotedRefOf, localQuotedPreview, needsQuotedLookup, quotedLookupBody, quotedCardView } from './quoted-tweet-model.js';

// QuotedTweetCard — the quoted original, embedded under the editor text the way X lays out a quote post, with a
// "Show quoted post" switch (default ON). Presentation + one read-only lookup (`quoted-post-preview`, Firestore only).
// Approval integrity: when the card is switched off, the quote target URL stays visible (#post-editor-quote-target).
// Styles live in PostEditor's PostEditorStyles (every selector under #post-editor-root).

export default function QuotedTweetCard({ row, call, timeZone }) {
  const ref = quotedRefOf(row);
  const refUrl = ref?.url || '';
  const [show, setShow] = useState(true);
  const [fetched, setFetched] = useState(null);
  const [loading, setLoading] = useState(false);
  const local = useMemo(() => localQuotedPreview(row), [row]); // eslint-disable-line react-hooks/exhaustive-deps
  const lookupBody = useMemo(() => (needsQuotedLookup(row) ? quotedLookupBody(row) : null), [row]); // eslint-disable-line react-hooks/exhaustive-deps
  const lookupKey = lookupBody ? JSON.stringify(lookupBody) : '';

  useEffect(() => {
    setFetched(null);
    if (!lookupKey || typeof call !== 'function') return undefined;
    let live = true;
    setLoading(true);
    call('quoted-post-preview', JSON.parse(lookupKey))
      .then((r) => { if (live) setFetched(r?.preview || null); })
      .catch(() => { /* the URL-only card is the honest fallback */ })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [lookupKey, call]);

  if (!ref) return null;
  const preview = local?.found ? local : (fetched || local || buildQuotedPreview({ url: refUrl }));
  const view = quotedCardView(preview, { timeZone });
  if (!view) return null;

  return (
    <div id="post-editor-quote-shell" className="pe-quote-shell">
      <div id="post-editor-quote-toggle-row" className="pe-quote-toggle-row">
        <span id="post-editor-quote-summary" className="pe-kicker">{view.summaryLabel}</span>
        <button
          type="button"
          id="post-editor-quote-toggle"
          className="pe-quote-toggle"
          role="switch"
          aria-checked={show}
          aria-controls="post-editor-quoted-card"
          onClick={() => setShow((s) => !s)}
        >
          Show quoted post · {show ? 'On' : 'Off'}
        </button>
      </div>
      {show ? (
        <article id="post-editor-quoted-card" className="pe-quoted-card" aria-label="Quoted post" aria-busy={loading || undefined}>
          <header id="post-editor-quoted-header" className="pe-quoted-header">
            <strong className="pe-quoted-name">{view.displayName}</strong>
            {view.handleLabel ? <span className="pe-muted">{view.handleLabel}</span> : null}
            {view.dateLabel ? <span className="pe-muted">· {view.dateLabel}</span> : null}
          </header>
          {view.hasText ? <p id="post-editor-quoted-text" className="pe-quoted-text">{view.text}</p> : <p id="post-editor-quoted-missing" className="pe-muted">{loading ? 'Loading the quoted post…' : view.missingNote}</p>}
          {view.mediaUrl ? <img id="post-editor-quoted-media" className="pe-quoted-media" src={view.mediaUrl} alt="" /> : null}
          {view.mediaNote ? <p id="post-editor-quoted-media-note" className="pe-muted">{view.mediaNote}</p> : null}
          <a id="post-editor-quoted-open" className="pe-quoted-open" href={view.openUrl} target="_blank" rel="noopener noreferrer">Open on X</a>
        </article>
      ) : (
        <a id="post-editor-quote-target" className="pe-quote-target" href={view.openUrl} target="_blank" rel="noopener noreferrer">{view.openUrl}</a>
      )}
    </div>
  );
}
