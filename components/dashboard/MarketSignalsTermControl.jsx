'use client';

import { splitMarketingBriefTerms } from '../../lib/dashboard/marketing-brief-config';

// Generic per-item control for a string-list config field (handles, keywords,
// category terms): a list-card whose rows each have ON/OFF + remove. Disabled
// items are parked in `<field>Off` (a UI-only field the scout pipeline never
// reads), so toggling off excludes an item from the run without deleting it.
// Extracted from DashboardPage.jsx's renderTermControl.
export default function MarketSignalsTermControl({ field, offField, title, addCard, suffix = '', marketingBriefConfig, setMarketingBriefConfig, openCapabilityCard }) {
  const active = splitMarketingBriefTerms(marketingBriefConfig?.[field]);
  const off = splitMarketingBriefTerms(marketingBriefConfig?.[offField]).filter((t) => !active.includes(t));
  const toggle = (t) => setMarketingBriefConfig((prev) => {
    const on = splitMarketingBriefTerms(prev?.[field]);
    const o = splitMarketingBriefTerms(prev?.[offField]);
    return on.includes(t)
      ? { ...(prev || {}), [field]: on.filter((x) => x !== t).join('\n'), [offField]: [...o.filter((x) => x !== t), t].join('\n') }
      : { ...(prev || {}), [field]: [...on, t].join('\n'), [offField]: o.filter((x) => x !== t).join('\n') };
  });
  const remove = (t) => setMarketingBriefConfig((prev) => ({
    ...(prev || {}),
    [field]: splitMarketingBriefTerms(prev?.[field]).filter((x) => x !== t).join('\n'),
    [offField]: splitMarketingBriefTerms(prev?.[offField]).filter((x) => x !== t).join('\n'),
  }));
  const rows = [...active.map((t) => ({ t, on: true })), ...off.map((t) => ({ t, on: false }))];
  return (
    <article className="sg-list">
      <div className="sg-list-head">
        <span className="sg-list-title">{title}</span>
        <span className="sg-chip">{active.length} on{off.length ? ` · ${off.length} off` : ''}{suffix}</span>
        <button type="button" className="sg-btn" onClick={() => openCapabilityCard(addCard)}>+ Add</button>
      </div>
      {rows.length ? rows.map(({ t, on }) => (
        <div key={t} className={`sg-inv${on ? '' : ' is-off'}`}>
          <span className="name">{t}</span>
          <button type="button" className={`sg-btn ${on ? 'sg-btn-on' : 'sg-btn-off'}`} style={{ minWidth: 52 }} onClick={() => toggle(t)}>{on ? 'ON' : 'OFF'}</button>
          <button type="button" className="sg-btn sg-btn-danger" aria-label={`Remove ${t}`} style={{ minWidth: 38, padding: '0 10px' }} onClick={() => remove(t)}>×</button>
        </div>
      )) : (
        <p className="sg-hint" style={{ margin: '4px 0 0' }}>Nothing yet — <strong>+ Add</strong> opens the card.</p>
      )}
    </article>
  );
}
