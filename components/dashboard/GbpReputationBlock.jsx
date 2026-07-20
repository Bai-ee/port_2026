'use client';

// GBP Reputation REPORT block — renders the deterministic reputation
// projection (Rosita's mock until live GBP OAuth lands). Read-only drafts.
// Pure/closure-free — extracted from DashboardPage.jsx's renderGbpReputationBlock.
export default function GbpReputationBlock({ rep }) {
  if (!rep) return null;
  const isDanger = rep.priorityAction?.severity === 'high';
  return (
    <div className="kit-paper" id="gbp-reputation-report-block">
      {!rep.connected ? (
        <>
          <h2 className="b-headline">Connect Google Business Profile</h2>
          <p className="b-sub">{rep.priorityAction?.reason || 'No live reputation data is available yet.'}</p>
        </>
      ) : (
        <>
          <h2 className="b-headline">{rep.locationName}</h2>
          <p className="b-sub">{rep.ratingAverage} rating across {rep.reviewCount} reviews · {rep.unrepliedCount} need a reply{rep.negativeUnrepliedCount ? `, incl. ${rep.negativeUnrepliedCount} negative` : ''}.</p>
          <div className="scores" style={{ margin: '12px 0' }}>
            <div className="score"><div className="lbl">Rating</div><div className="num">{rep.ratingAverage}</div></div>
            <div className="score"><div className="lbl">Need reply</div><div className="num">{rep.unrepliedCount}</div></div>
            <div className="score"><div className="lbl">Negative</div><div className="num">{rep.negativeUnrepliedCount}</div></div>
            <div className="score"><div className="lbl">SEO done</div><div className="num">{rep.seoChecklist.completed}/{rep.seoChecklist.total}</div></div>
          </div>
          <div className={`sg-notice ${isDanger ? 'sg-notice-danger' : 'sg-notice-muted'}`} style={{ margin: '8px 0 14px' }}>
            <strong>First action:</strong> {rep.priorityAction.label} — {rep.priorityAction.reason}
          </div>
          {rep.suggestedReplies.length ? (
            <>
              <div className="b-sec">Reviews needing reply · draft responses</div>
              <div className="b-stack">
                {rep.suggestedReplies.slice(0, 4).map((s, i) => (
                  <div className="b-card" key={`gbp-reply-${i}`}>
                    <div className="stat-row"><div className="k">{s.rating}★ · {s.reviewer}</div><div className="v" style={{ textTransform: 'uppercase', fontSize: 11, opacity: 0.7 }}>{s.sentiment}</div></div>
                    <div className="stat-row"><div className="k">Draft</div><div className="v">{s.draft}</div></div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {rep.seoChecklist.priorityItems.length ? (
            <>
              <div className="b-sec" style={{ marginTop: 16 }}>Local SEO · next gaps</div>
              <div className="b-stack">
                {rep.seoChecklist.priorityItems.map((it, i) => (
                  <div className="b-bubble" key={`gbp-seo-${i}`}><div className="txt">{it.label} <span style={{ opacity: 0.6 }}>· {it.frequency}</span></div></div>
                ))}
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
