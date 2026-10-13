'use client';

import React from 'react';
import Badge from '../content-ui/ui/Badge.jsx';

// ResultsPostList — one labelled group of post-result rows (Posted / Waiting /
// Needs attention). PURE PRESENTATION over features/x-content-inventory/results.js
// rows. Missing metrics render 'not measured yet', never 0.

const STATUS_TONE = { posted: 'green', failed: 'red', expired: 'red', needs_review: 'amber' };

const fmtNum = (v) => (v == null ? '—' : Number(v).toLocaleString());
const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function originLine(r) {
  const o = r.origin || {};
  const bits = [];
  if (o.strategyVersion != null) bits.push(`plan v${o.strategyVersion}`);
  if (o.runId) bits.push(`run ${String(o.runId).slice(0, 8)}`);
  if (r.packageTitle) bits.push(`package ${r.packageTitle}`);
  else if (r.packageId) bits.push(`package ${String(r.packageId).slice(0, 8)}`);
  if (o.sourceRefKind) bits.push(`from ${o.sourceRefKind}`);
  return bits.join(' · ');
}

export default function ResultsPostList({ id, title, rows, emptyText, kind, total }) {
  const list = rows || [];
  return (
    <div id={id} className="xce-results-group">
      <h4 id={`${id}-title`} className="xce-results-group-title">{title} <span className="xce-results-group-count">{Number.isFinite(total) && total > list.length ? `showing ${list.length} of ${total}` : list.length}</span></h4>
      {!list.length ? (
        <p id={`${id}-empty`} className="xce-empty-note" style={{ margin: 0 }}>{emptyText}</p>
      ) : (
        <ul id={`${id}-rows`} className="xce-results-rows">
          {list.map((r) => {
            const origin = originLine(r);
            const when = kind === 'posted' ? r.postedAt : r.scheduledAt;
            const m = r.metrics;
            return (
              <li key={r.id} id={`results-post-${r.id}`} className="xce-results-row">
                <div className="xce-results-row-head">
                  <span className="xce-results-time">{fmtTime(when)}</span>
                  <Badge tone={STATUS_TONE[r.status] || 'grey'}>{r.heldReason ? 'held' : r.selfReported ? 'posted · you reported' : r.status === 'manual' ? 'posting manually' : r.status}</Badge>
                  {r.engine ? <span className="xce-results-engine">{r.engine}</span> : null}
                </div>
                <p className="xce-results-excerpt">{r.content || '(no text)'}</p>
                {origin ? <p className="xce-results-origin">{origin}</p> : null}
                {kind === 'posted' ? (
                  m ? (
                    <dl className="xce-results-metrics">
                      <div><dt>Views</dt><dd>{fmtNum(m.views)}</dd></div>
                      <div><dt>Likes</dt><dd>{fmtNum(m.likes)}</dd></div>
                      <div><dt>Replies</dt><dd>{fmtNum(m.replies)}</dd></div>
                      <div><dt>Reposts</dt><dd>{fmtNum(m.reposts)}</dd></div>
                      <div><dt>Quotes</dt><dd>{fmtNum(m.quotes)}</dd></div>
                      <div><dt>Saves</dt><dd>{fmtNum(m.bookmarks)}</dd></div>
                    </dl>
                  ) : null
                ) : null}
                {kind === 'posted' ? <p className="xce-results-note">{r.metricsNote}</p> : null}
                {r.selfReported ? <p className="xce-results-note">Self-reported, not verified by X{r.permalink ? <> · <a href={r.permalink} target="_blank" rel="noopener noreferrer">link</a></> : null}</p> : null}
                {r.heldReason ? <p className="xce-results-failure">Held for review: {r.heldReason}</p> : null}
                {r.failure ? (
                  <p className="xce-results-failure">
                    {r.failure.errorClass || r.status}{r.failure.error ? `: ${r.failure.error}` : ''} · not retried automatically
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
