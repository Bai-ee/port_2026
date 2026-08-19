// Pure digest HTML renderer, extracted from app/api/admin/daily-digest/route.js
// (Phase 2 email-system rebuild). No Next/Firestore/network I/O — safe to import
// under plain node --test as well as the Next bundler.

import digestConfig from '../intelligence/_digest-config.js';

export function appOrigin() {
  // ⚠️ Deliberately NO `VERCEL_URL` fallback: this project runs SSO Deployment
  // Protection ("all_except_custom_domains"), so VERCEL_URL is a PROTECTED host
  // — a link or self-request built on it lands on the vercel.com login page,
  // not the app (2026-08-18 email root cause). Env override → custom domain.
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://hitloop.agency';
  return String(raw).replace(/\/+$/, '');
}

export function appUrl(path = '/') {
  const cleanPath = String(path || '/').startsWith('/') ? path : `/${path}`;
  return `${appOrigin()}${cleanPath}`;
}

export function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Build the "Today's Agenda" HTML block for the brief. */
// ── Digest visual theme (ported from clients/.../platform-brief.html) ─────────
// Email-safe adaptation: warm-cream surfaces, Doto display numerals, Space Mono
// micro-labels, Space Grotesk body. Web fonts load via @import where supported
// (Apple Mail); Gmail strips them and falls back to the monospace/sans stacks,
// which preserves the data-terminal character.
export const DT = {
  bg: '#fbf8f0',
  card: '#fffdf7',
  ink: '#12100c',
  soft: '#5a5346',
  light: '#8a8070',
  line: '#e7ddc8',
  dash: 'rgba(18,16,12,0.10)',
  accent: '#b8542e',
  // Brand gradient (matches the dashboard primary-button / tab-underline:
  // cyan → purple → pink) + solid/ tint fallbacks for the TODAY highlight.
  grad: 'linear-gradient(135deg,#00c2e6 0%,#6a1aff 52%,#ff00b3 100%)',
  brand: '#6a1aff',
  brandTint: 'rgba(106,26,255,0.08)',
  fDisp: "'Doto','Space Mono','Courier New',monospace",
  fBody: "'Space Grotesk',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  fMono: "'Space Mono','Courier New',monospace",
};

// Shared data-cell styles
const TH = `padding:10px 14px;text-align:left;font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};border-bottom:1px solid ${DT.line};`;
const THR = TH + 'text-align:right;';
const TD = `padding:11px 14px;border-bottom:1px dashed ${DT.dash};font-family:${DT.fBody};font-size:13px;color:${DT.ink};`;
const TDsub = `padding:11px 14px;border-bottom:1px dashed ${DT.dash};font-family:${DT.fBody};font-size:13px;color:${DT.soft};`;
const TDnum = `padding:11px 14px;border-bottom:1px dashed ${DT.dash};font-family:${DT.fMono};font-size:13px;font-weight:700;text-align:right;color:${DT.ink};`;
const TDempty = `padding:18px;text-align:center;font-family:${DT.fBody};font-size:13px;color:${DT.light};`;

export function dKicker(text) {
  return `<div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:${DT.light};margin:0 0 8px;">${text}</div>`;
}

function dMini(text) {
  return `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin:0 0 9px;">${text}</div>`;
}

function dSectionHead(kicker, title) {
  return `${dKicker(kicker)}<div class="sec-title" style="font-family:${DT.fDisp};font-weight:900;font-size:30px;line-height:.95;letter-spacing:-.005em;text-transform:uppercase;color:${DT.ink};margin:0 0 18px;">${title}</div>`;
}

// Every section: top hairline divider + mono eyebrow + Doto display title + body
export function dSection(kicker, title, body) {
  return `<div style="border-top:1px solid ${DT.line};padding-top:32px;margin-top:32px;">
    ${dSectionHead(kicker, title)}
    ${body}
  </div>`;
}

// Sub-block inside a per-brief section: a small mono label + its content. Empty
// content collapses to '' so a brief section only shows the items turned on.
function dSub(label, html) {
  if (!html || !String(html).trim()) return '';
  return `<div style="margin:0 0 22px;">${dMini(label)}${html}</div>`;
}

// One headed section per brief (top hairline + kicker + Doto title), with its
// data items as dSub blocks. Returns '' when every child sub-block is empty so
// a fully-off brief produces no header. This is the "STAND UP" grammar — each
// brief gets one section to voice its data.
function dBriefSection(kicker, title, parts) {
  const body = (Array.isArray(parts) ? parts : [parts]).filter((p) => p && String(p).trim()).join('');
  if (!body.trim()) return '';
  return `<div style="border-top:1px solid ${DT.line};padding-top:32px;margin-top:32px;">
    ${dSectionHead(kicker, title)}
    ${body}
  </div>`;
}

function dStatusBadge(label) {
  const k = String(label || '').toLowerCase();
  let bg = '#f6f0e2', fg = '#8a6a1f';
  if (['ready', 'complete', 'completed', 'succeeded', 'success'].includes(k)) { bg = '#edf4ec'; fg = '#2f6b3d'; }
  else if (['error', 'failed', 'cancelled', 'canceled'].includes(k)) { bg = '#f7ece8'; fg = '#a8392a'; }
  return `<span style="display:inline-block;padding:3px 9px;border-radius:5px;font-family:${DT.fMono};font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:${bg};color:${fg};">${escapeHtml(String(label))}</span>`;
}

function dChip(label, value) {
  return `<span style="display:inline-block;margin:0 6px 8px 0;padding:6px 13px;border-radius:999px;background:rgba(18,16,12,0.04);border:1px solid rgba(18,16,12,0.09);font-family:${DT.fBody};font-size:12px;color:${DT.soft};">${label}${value != null ? `: <strong style="font-family:${DT.fMono};color:${DT.ink};">${value}</strong>` : ''}</span>`;
}

// Wrapping inline-block stat cards (reflow to 2-up on narrow screens)
function dStatCells(stats, perRow) {
  const width = perRow === 5 ? 18 : 23;
  const mr = perRow === 5 ? 2.5 : 2;
  const minw = perRow === 5 ? 92 : 118;
  return `<div style="font-size:0;line-height:0;">${stats.map((s) => `
    <div style="display:inline-block;vertical-align:top;width:${width}%;min-width:${minw}px;margin:0 ${mr}% 10px 0;background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:18px 14px;box-sizing:border-box;">
      <div style="font-family:${DT.fDisp};font-weight:900;font-size:38px;line-height:1;letter-spacing:-.02em;color:${DT.ink};">${s.num}</div>
      <div style="margin-top:9px;font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};">${s.label}</div>
    </div>`).join('')}</div>`;
}

function dDataTable(headers, bodyRows) {
  const head = headers.map((h) => `<th style="${h.right ? THR : TH}">${h.label}</th>`).join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:${DT.card};border:1px solid ${DT.line};border-radius:14px;overflow:hidden;">
    <thead><tr>${head}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>`;
}

function buildAgendaSection(agenda) {
  // Visibility is toggle-gated by the caller (include.agenda). This builder
  // always renders a section so preview and live stay in sync.
  if (agenda.error) {
    return dSection('Schedule', 'Agenda', `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:14px 16px;font-family:${DT.fBody};font-size:13px;color:${DT.accent};">Calendar unavailable: ${escapeHtml(agenda.error)}</div>`);
  }

  const days = agenda.days || [];
  if (!days.length) {
    return dSection('Schedule', 'Agenda', `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:14px 16px;font-family:${DT.fBody};font-size:13px;color:${DT.light};">No events on the calendar for the next 5 days.</div>`);
  }

  // Swipe carousel: each day is a fixed-width card in a horizontally scrolling
  // strip — conserves vertical space and shows all days. The strip is hard-
  // contained (outer overflow:hidden + max-width:100%) so it NEVER widens the
  // email body; only the strip scrolls. Today is first. Clients that strip
  // overflow scroll (Gmail app) clip to width — showing today first, which is
  // the intended graceful fallback. scroll-snap gives clean paging where supported.
  const dayCards = days.map((day) => {
    const evs = day.events || [];
    const rows = evs.length
      ? evs.map((ev, i) => `
        <div style="padding:10px 14px;${i ? `border-top:1px dashed ${DT.dash};` : ''}white-space:normal;font-family:${DT.fBody};font-size:13px;color:${DT.ink};">
          <span style="display:block;font-family:${DT.fMono};font-size:10px;font-weight:700;letter-spacing:.04em;color:${day.isToday ? DT.brand : DT.accent};margin-bottom:3px;">${escapeHtml(ev.timeLabel)}</span>
          ${escapeHtml(ev.summary)}${ev.location ? `<span style="display:block;margin-top:2px;font-size:11px;color:${DT.light};">${escapeHtml(ev.location)}</span>` : ''}
        </div>`).join('')
      : `<div style="padding:14px;white-space:normal;font-family:${DT.fBody};font-size:12px;color:${DT.light};">${agenda.demo ? 'Open' : 'No events'}</div>`;

    return `<div style="display:inline-block;vertical-align:top;white-space:normal;font-size:13px;line-height:normal;width:260px;max-width:80%;margin-right:10px;scroll-snap-align:start;background:${DT.card};border:1px solid ${day.isToday ? DT.brand : DT.line};border-radius:14px;overflow:hidden;box-sizing:border-box;">
      <div style="padding:11px 14px;border-bottom:1px solid ${DT.line};background:${day.isToday ? DT.brandTint : 'transparent'};">
        ${day.isToday ? `<span style="display:inline-block;margin-right:7px;font-family:${DT.fMono};font-size:8px;font-weight:700;letter-spacing:.12em;color:#fff;background:${DT.brand};background-image:${DT.grad};border-radius:4px;padding:2px 5px;vertical-align:middle;">TODAY</span>` : ''}<span style="font-family:${DT.fMono};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${day.isToday ? DT.brand : DT.ink};">${escapeHtml(day.weekday)}</span><span style="font-family:${DT.fMono};font-size:10px;letter-spacing:.06em;color:${DT.light};"> &middot; ${escapeHtml(day.dateLabel)}</span>
      </div>
      ${rows}
    </div>`;
  }).join('');

  const hint = `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};margin:0 0 10px;">Swipe &rarr; ${days.length} day${days.length !== 1 ? 's' : ''}</div>`;
  const carousel = `<div style="max-width:100%;overflow:hidden;"><div style="overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap;font-size:0;line-height:0;padding-bottom:8px;scroll-snap-type:x mandatory;">${dayCards}</div></div>`;

  // Demo (Email Digest `demoMetrics.calendar`): the strip renders in full with
  // every day OPEN, so the slot reads as available rather than as a dead day.
  const demoNote = agenda.demo
    ? `<div style="font-family:${DT.fBody};font-size:12px;color:${DT.light};margin-top:2px;">Not connected yet — connect your calendar and your real schedule fills these days.</div>`
    : '';

  return dSection('Schedule', 'Agenda', `${hint}${carousel}${demoNote}`);
}

/** Standalone Weather section (its own toggle: include.weather). Reads the
 *  weather from the first brief that carries it. Always renders a section so
 *  preview and live stay in sync (empty state when no forecast). */
function buildWeatherSection(briefs) {
  const briefList = Array.isArray(briefs) ? briefs : [];
  const w = briefList.map((b) => b?.intel?.weather).find((x) => x && x.today);
  const body = w && w.today
    ? `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:16px 18px;">
        <div style="font-family:${DT.fBody};font-size:15px;color:${DT.ink};"><strong>${escapeHtml(w.today.name)}:</strong> ${escapeHtml(w.today.short)} &middot; ${escapeHtml(String(w.today.temp))}&deg;${escapeHtml(w.today.unit)}${w.today.wind ? ` &middot; wind ${escapeHtml(w.today.wind)}` : ''}</div>
        ${w.threeDayLine ? `<div style="margin-top:6px;font-family:${DT.fBody};font-size:12px;color:${DT.soft};">3-day: ${escapeHtml(w.threeDayLine)}</div>` : ''}
      </div>`
    : `<p style="font-family:${DT.fBody};font-size:13px;color:${DT.light};margin:0;">No forecast available for this run.</p>`;
  return dSection(`Local Weather${w?.place ? ` &middot; ${escapeHtml(w.place)}` : ''}`, 'Weather', body);
}

/** Follower posts (own toggle: include.followerPosts). ONE post from each
 *  followed handle (the first activity item), rendered in the "Conversation /
 *  angle" grammar with an obvious "View post" link. Empty state for parity. */
function buildFollowerPostsSection(briefs) {
  const briefList = Array.isArray(briefs) ? briefs : [];
  const seen = new Set();
  const items = [];
  for (const b of briefList) {
    for (const w of (b?.intel?.watchlist || [])) {
      const handle = String(w.handle || '').replace(/^@+/, '').trim();
      if (!handle || seen.has(handle.toLowerCase())) continue;
      const post = (w.found && Array.isArray(w.activity) && w.activity.length) ? w.activity[0] : null;
      if (!post || !post.text) continue;
      seen.add(handle.toLowerCase());
      items.push({ handle, text: post.text, url: post.url || '' });
    }
  }
  const shown = items.slice(0, EMAIL_CAPS.followerPosts);
  const rows = shown.length
    ? shown.map((it) => `<tr>
        <td style="${TD}">
          <strong style="font-family:${DT.fMono};color:${DT.ink};">@${escapeHtml(it.handle)}</strong>${it.url ? ` <a href="${escapeHtml(it.url)}" style="color:${DT.accent};font-family:${DT.fMono};font-size:11px;letter-spacing:.06em;text-transform:uppercase;">&rarr; View post</a>` : ''}
          <div style="margin-top:4px;color:${DT.soft};font-size:13px;line-height:1.5;">${escapeHtml(String(it.text).slice(0, 280))}</div>
        </td>
      </tr>`).join('') + emailOverflowRow(items.length - shown.length, 'follower posts')
    : `<tr><td style="${TDempty}">No posts from followed handles this run.</td></tr>`;
  // Inner table only — composed as the "Follower posts" sub-block under the
  // Market Signals brief header by buildEmailHtml.
  return dDataTable([{ label: 'Conversation / angle' }], rows);
}

// Inner content only — composed as the "Homepage" sub-block under the Web
// Performance brief header by buildEmailHtml.
function buildHomepageAnalyticsSection(homepage) {
  if (homepage.error) {
    return `<p style="font-family:${DT.fBody};font-size:13px;color:${DT.accent};margin:0;">Unavailable: ${escapeHtml(homepage.error)}</p>`;
  }

  if (!homepage.totalEvents) {
    // `demo` = the zeroed fixture (Email Digest demo-metrics group): read as an
    // available slot, not as "nothing happened today".
    return `<p style="font-family:${DT.fBody};font-size:13px;color:${DT.light};margin:0;">${homepage.demo
      ? 'Not connected yet — clicks, scroll depth and web vitals from your site land here once tracking is on.'
      : 'No interaction events in the last 24 hours.'}</p>`;
  }

  const chips = homepage.byInteractionType
    .map((item) => dChip(escapeHtml(item.name.replace(/_/g, ' ')), item.count))
    .join('');

  const targetRows = homepage.topTargets.length
    ? homepage.topTargets.map((item) => `<tr><td style="${TD}max-width:420px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(item.name)}</td><td style="${TDnum}">${item.count}</td></tr>`).join('')
    : `<tr><td colspan="2" style="${TDempty}">No click targets recorded</td></tr>`;

  const outboundRows = homepage.outboundLinks.length
    ? homepage.outboundLinks.map((item) => `<tr><td style="${TD}max-width:420px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(item.name)}</td><td style="${TDnum}">${item.count}</td></tr>`).join('')
    : `<tr><td colspan="2" style="${TDempty}">No outbound clicks recorded</td></tr>`;

  const scrollChips = homepage.scrollDepths.length
    ? homepage.scrollDepths.map((item) => dChip(escapeHtml(item.name), item.count)).join('')
    : `<span style="font-family:${DT.fBody};font-size:13px;color:${DT.light};">No scroll milestones yet</span>`;

  const vitalChips = homepage.webVitals.length
    ? homepage.webVitals.map((item) => dChip(`${escapeHtml(item.name)} avg`, `${item.average}${item.poor ? ` &middot; poor ${item.poor}` : ''}`)).join('')
    : `<span style="font-family:${DT.fBody};font-size:13px;color:${DT.light};">No web vitals yet</span>`;

  return `<div style="margin-bottom:16px;">${chips}</div>
    <div style="margin-bottom:14px;">${dDataTable([{ label: 'Top clicks / fields' }, { label: 'Events', right: true }], targetRows)}</div>
    <div style="margin-bottom:14px;">${dDataTable([{ label: 'Outbound links' }, { label: 'Clicks', right: true }], outboundRows)}</div>
    <div style="margin-bottom:16px;">${dMini('Scroll depth')}${scrollChips}</div>
    <div>${dMini('Web vitals')}${vitalChips}</div>`;
}

// Per-domain accent tints for the executive-summary callout cards. Email-safe
// flat hex (no gradients): a soft tint background + a stronger ink for the tag
// and the card's left rule, so each callout is scannable by category.
const CALLOUT_COLORS = {
  Platform:   { bg: '#f7ece8', fg: '#a8392a' },
  Traffic:    { bg: '#e9f0f4', fg: '#2f5d7a' },
  Calendar:   { bg: '#edf4ec', fg: '#2f6b3d' },
  Strategy:   { bg: '#efeaf6', fg: '#5a3d8a' },
  Engagement: { bg: '#f6f0e2', fg: '#8a6a1f' },
  Pipeline:   { bg: '#eceef1', fg: '#4a5568' },
};

/** Below the video/post table: the Social Auto-Publish attribution + action row.
 *  ctx = {clientName, handle, mode, approvalUrl, publishedAt, platformLabel,
 *  preview, skipped, error, postContent} — undefined/mode 'off' renders nothing (today's
 *  row, byte-identical). Table-based, no flex, no JS (Outlook-safe). */
function buildAutoPublishRow(ctx) {
  if (!ctx || !ctx.mode || ctx.mode === 'off') return '';
  const platformLabel = escapeHtml(ctx.platformLabel || 'X');
  const attribution = ctx.clientName
    ? `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};margin:10px 0 6px;">${escapeHtml(ctx.clientName)} &rarr; ${ctx.handle ? `@${escapeHtml(ctx.handle)}` : `<em style="font-style:normal;">not connected</em>`}</div>`
    : '';

  let action = '';
  if (ctx.mode === 'approval' && ctx.approvalUrl) {
    // Bulletproof-table CTA — no flex, no JS, Outlook-safe.
    const href = escapeHtml(ctx.approvalUrl);
    action = `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:8px;background:${DT.ink};">
      <a href="${href}" style="display:inline-block;padding:10px 18px;font-family:${DT.fMono};font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#fff;text-decoration:none;">POST TO ${platformLabel}</a>
    </td></tr></table>`;
  } else if (ctx.mode === 'approval') {
    const line = ctx.preview
      ? `Preview — the sent email includes a working Post button.`
      : ctx.claimedByRollup
        ? `Included in today's Pending Approval roll-up email instead.`
        : ctx.skipped === 'not-connected'
          ? `Not connected — connect ${platformLabel} for this client in Social Accounts.`
          : `No pending approval right now.`;
    action = `<div style="font-family:${DT.fBody};font-size:12px;color:${DT.soft};">${escapeHtml(line)}</div>`;
  } else if (ctx.mode === 'auto') {
    const line = ctx.publishedAt
      ? `PUBLISHED &middot; @${escapeHtml(ctx.handle || '')} &middot; ${escapeHtml(new Date(ctx.publishedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))}`
      : ctx.preview
        ? `Will auto-publish on send.`
        : ctx.error
          ? `Auto-publish failed &middot; ${escapeHtml(ctx.error)}`
          : `Not published this run &middot; ${escapeHtml(ctx.skipped || 'unknown reason')}`;
    action = `<div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.06em;color:${ctx.publishedAt ? '#2f9e6b' : DT.soft};">${line}</div>`;
  }

  return `${attribution}${action}`;
}

/** ONE "Post content" row — [video play-card | X post copy]. Email-safe: the
 *  video column is a dark branded card (▶ + duration) LINKING to the MP4 (clients
 *  can't play video). Stacks to 1 column on mobile via the .vp-col-* classes.
 *  `kind` labels the source (Remix / Promo). Returns '' when there's no video.
 *  `ctx` (Social Auto-Publish attribution + button) is undefined for Promo and
 *  for any client with mode 'off' — renders the row byte-identical to before. */
export function buildVideoPostRow(item, kind = 'Video', ctx = null) {
  if (!item || !item.url) return '';
  const href = escapeHtml(String(item.url));
  const secs = Number(item.duration) || 0;
  const durLabel = secs > 0 ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} &middot; ${escapeHtml(kind)}` : escapeHtml(kind);
  const effectiveCaption = ctx?.postContent || item.caption;
  const caption = effectiveCaption
    ? escapeHtml(effectiveCaption)
    : `<span style="color:${DT.light};">Promo post generates on send.</span>`;
  // A carried-over video (today's render wasn't ready) is labeled on the card.
  // Silent reuse previously made a stalled pipeline look like a working one.
  const staleBadge = item.stale
    ? `<div style="margin-top:8px;font-family:${DT.fMono};font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#ffb454;">&#9888; from ${escapeHtml(item.staleLabel || 'an earlier run')}</div>`
    : '';
  const videoCard = `<a href="${href}" style="text-decoration:none;display:block;">
    <div style="background:${DT.ink};border-radius:12px;text-align:center;padding:30px 12px;">
      <span style="display:inline-block;width:46px;height:46px;line-height:46px;border-radius:50%;background:${DT.brand};background-image:${DT.grad};color:#fff;font-size:16px;">&#9654;</span>
      <div style="margin-top:10px;font-family:${DT.fMono};font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,0.72);">${durLabel}</div>
      ${staleBadge}
    </div>
  </a>`;
  const postCol = `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin:0 0 6px;">X &middot; Post</div>
    <p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.ink};margin:0 0 10px;white-space:pre-line;">${caption}</p>
    <a href="${href}" style="color:${DT.brand};font-family:${DT.fMono};font-size:11px;letter-spacing:.06em;text-transform:uppercase;">&rarr; View video</a>
    ${buildAutoPublishRow(ctx)}`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 4px;">
    <tr>
      <td class="vp-col-media" valign="top" width="42%" style="width:42%;vertical-align:top;">${videoCard}</td>
      <td class="vp-col-text" valign="top" width="58%" style="width:58%;vertical-align:top;padding-left:14px;">${postCol}</td>
    </tr>
  </table>`;
}

/** LLM executive-summary card body (no section wrapper — composed under the TODAY
 *  header by buildEmailHtml). Per-domain callout cards when the model returned
 *  structured callouts; falls back to the flat paragraph; empty state otherwise. */
function buildSummaryBody(summary) {
  const callouts = Array.isArray(summary?.callouts) ? summary.callouts : [];
  // Honest staleness: a scheduled send whose refresh failed still sends the
  // last-good summary, visibly labeled (owner decision, 2026-08-18) — never
  // silently passed off as today's.
  const staleLine = summary?.staleNote
    ? `<div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;color:${DT.light};margin:12px 0 0;">⚠ ${escapeHtml(summary.staleNote)}</div>`
    : '';

  // Structured callouts → marketing-director grammar: a warm report card with a
  // mono eyebrow, a Doto headline, the lead as a pull-quote, then one labeled
  // block per category (sec label + bold headline + line) — like the
  // Overview / Suggested-action blocks in the watchlist brief.
  // Same grammar as Weather: dSection header (hairline + kicker + Doto title)
  // with the content in a cream card body below — no title-inside-card.
  if (callouts.length) {
    const lead = summary.lead
      ? `<p style="font-family:${DT.fBody};font-weight:300;font-size:18px;line-height:1.35;padding:0;margin:0 0 20px;color:${DT.ink};">${escapeHtml(summary.lead)}</p>`
      : '';
    const blocks = callouts.map((c, i) => {
      const col = CALLOUT_COLORS[c.category] || CALLOUT_COLORS.Strategy;
      const label = `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:${col.fg};margin:0 0 6px;">${escapeHtml(c.category)}</div>`;
      return `<div style="${i ? `border-top:1px dashed ${DT.dash};padding-top:16px;` : ''}margin-bottom:16px;">
        ${label}
        ${c.headline ? `<div style="font-family:${DT.fBody};font-weight:700;font-size:16px;line-height:1.3;color:${DT.ink};margin-bottom:4px;">${escapeHtml(c.headline)}</div>` : ''}
        ${c.line ? `<div style="font-family:${DT.fBody};font-size:14px;line-height:1.55;color:${DT.soft};">${escapeHtml(c.line)}</div>` : ''}
      </div>`;
    }).join('');
    return `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:20px;margin-bottom:18px;">${lead}${blocks}${staleLine}</div>`;
  }

  // Fallback: flat paragraph (or empty state). Toggle-gated by the caller
  // (include.execSummary); empty state keeps preview == sent in sync.
  const text = summary && summary.paragraph
    ? escapeHtml(summary.paragraph).replace(/\n+/g, ' ')
    : '';
  const body = text || `<span style="color:${DT.light};">No executive summary generated for this run.</span>`;
  return `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:20px 22px;margin-bottom:18px;font-family:${DT.fBody};font-size:15px;line-height:1.62;color:${DT.ink};">${body}${staleLine}</div>`;
}

// ── Email size caps ───────────────────────────────────────────────────────────
// Gmail clips messages over ~102KB of encoded HTML and hides the rest behind
// "View entire message" (2026-07-04 digest: 157KB — every section ordered after
// Post Opportunities was invisible in the inbox even though it was sent). Each
// cap trims a section's item count / text length in the EMAIL only; full detail
// stays in the Executive Brief, and overflow rows link there. Keep the resulting
// section sizes roughly in sync with EST_SECTION_KB in components/AdminEmailModals.jsx
// (the SETTINGS-tab size estimator).
const EMAIL_CAPS = {
  signalsKolPerHandle: 1,  // KOL posts per handle in Signals
  signalsKols: 5,
  signalsCompetitors: 4,
  signalsNarratives: 4,
  pressCoverage: 6,        // article rows in the Press Coverage section
  signalsText: 240,        // finding/detail text per Signals row
  opportunities: 6,
  suggestedReplies: 3,
  watchlistHandles: 10,    // handle rows in Watchlist Accounts
  watchlistActivityPerHandle: 2,
  followerPosts: 10,
  analysisCards: 4,        // per-handle / thread / post cards in the Happening-on sections
  analysisCardText: 300,
};
const REPLY_TARGET_MAX_AGE_MS = 26 * 60 * 60 * 1000;
const STRATEGY_PLAN_MAX_AGE_MS = 26 * 60 * 60 * 1000;

export function dateMs(value) {
  if (!value) return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  if (value?.toDate) return value.toDate().getTime();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  return NaN;
}

function ageMs(value, nowMs = Date.now()) {
  const ms = dateMs(value);
  return Number.isFinite(ms) ? Math.max(0, nowMs - ms) : Infinity;
}

export function isFreshWithin(value, maxAgeMs, nowMs = Date.now()) {
  return ageMs(value, nowMs) <= maxAgeMs;
}

function digestRecipeGeneratedAt(recipe) {
  return recipe?.generatedAt || recipe?.updatedAt || recipe?.completedAt || recipe?.createdAt || recipe?.inputGeneratedAt || null;
}

function isFreshReplyRecipe(recipe, nowMs = Date.now()) {
  return Boolean(recipe?.recipeId === 'reply-targets' && recipe?.ok && recipe?.analysis) &&
    isFreshWithin(digestRecipeGeneratedAt(recipe), REPLY_TARGET_MAX_AGE_MS, nowMs);
}

function staleReplyNotice(recipe) {
  const stamp = digestRecipeGeneratedAt(recipe);
  const label = stamp && Number.isFinite(dateMs(stamp))
    ? new Date(dateMs(stamp)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'unknown';
  return `<div style="background:${DT.card};border:1px dashed ${DT.dash};border-radius:14px;padding:16px 18px;font-family:${DT.fBody};font-size:13px;line-height:1.55;color:${DT.soft};">Suggested Replies is enabled, but the latest reply-targets run is stale (${escapeHtml(label)}). Run Generate &amp; Send or wait for the next successful analysis refresh.</div>`;
}

function isFreshStrategyPlan(plan, nowMs = Date.now()) {
  return Boolean(plan) && isFreshWithin(plan.generatedAt || plan.today?.date, STRATEGY_PLAN_MAX_AGE_MS, nowMs);
}

function staleStrategyNotice(plan) {
  const stamp = plan?.generatedAt || plan?.today?.date || null;
  const label = stamp && Number.isFinite(dateMs(stamp))
    ? new Date(dateMs(stamp)).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'unknown';
  return `<div style="background:${DT.card};border:1px dashed ${DT.dash};border-radius:14px;padding:16px 18px;font-family:${DT.fBody};font-size:13px;line-height:1.55;color:${DT.soft};">Strategy Builder output is stale (${escapeHtml(label)}). Suggested Posts and the 30-day plan are hidden until the next successful strategy refresh.</div>`;
}

// Table row linking to the Executive Brief when a cap dropped items.
const emailOverflowRow = (n, label, colspan = 1) => (n > 0
  ? `<tr><td colspan="${colspan}" style="${TDempty}"><a href="${appUrl('/dashboard?open=brief')}" style="color:${DT.accent};font-family:${DT.fMono};font-size:11px;letter-spacing:.06em;text-transform:uppercase;">+${n} more ${label} in the Executive Brief &rarr;</a></td></tr>`
  : '');

/** Strategic brief block — mirrors the established daily brief's strategy. */
// Returns the Strategic-brief items as SEPARATE named HTML parts so each can be
// toggled on/off individually under the Market Signals brief header. Each value
// is raw inner HTML (no dMini label — the label comes from the dSub wrapper);
// '' when that item has no data.
function buildStrategicParts(intel, postPlatforms = {}) {
  if (!intel) return {};
  // Suggested-post platform filter: unset key => X on, everything else off.
  const ppOn = (k) => (postPlatforms && postPlatforms[k] !== undefined) ? postPlatforms[k] !== false : (k === 'x');
  // Map a post's platformHint → a registry platform key (default 'x').
  const platformOf = (hint) => {
    const h = String(hint || '').toLowerCase();
    for (const plat of digestConfig.POST_PLATFORMS) {
      if (plat.key === 'x') continue;
      if ((plat.hints || []).some((x) => h.includes(x))) return plat.key;
    }
    return 'x';
  };

  // Weather is its own toggled section (buildWeatherSection) — not rendered here.
  const linkBit = (url) => (url ? ` <a href="${escapeHtml(url)}" style="color:${DT.accent};font-family:${DT.fMono};font-size:11px;">↗</a>` : '');
  // "Post Me →" — opens the dashboard Post Me card (deep link) so the admin can
  // review + post the draft. Emails can't POST directly, so this is a link.
  const postMeLink = `<div style="margin-top:10px;"><a href="${appUrl('/dashboard?open=post-me')}" style="display:inline-block;color:${DT.brand};font-family:${DT.fMono};font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">Post Me &rarr;</a></div>`;

  const oppAll = intel.opportunities || [];
  const oppItems = oppAll.slice(0, EMAIL_CAPS.opportunities);
  const oppRows = oppItems.length
    ? oppItems.map((o) => `<tr>
        <td style="${TD}">${escapeHtml(o.topic)}${o.windowHours ? ` <span style="color:${DT.light};font-family:${DT.fMono};font-size:11px;">${o.windowHours}h</span>` : ''}${linkBit(o.url)}<div style="margin-top:3px;color:${DT.soft};font-size:12px;">${escapeHtml(o.angle || '')}</div></td>
      </tr>`).join('') + emailOverflowRow(oppAll.length - oppItems.length, 'opportunities')
    : '';

  // Suggested Replies — reads only fresh reply-targets recipe output persisted by
  // pre-digest-refresh (marketingBrief.reportSnapshot.digestRecipes). Stale or
  // missing recipe output renders an explicit state instead of old replies.
  const anyReplyRecipe = (intel.digestRecipes || []).find((r) => r?.recipeId === 'reply-targets' && r?.ok && r?.analysis);
  const replyRecipe = isFreshReplyRecipe(anyReplyRecipe) ? anyReplyRecipe : null;
  let repliesHtml = '';
  if (!replyRecipe && anyReplyRecipe) {
    repliesHtml = staleReplyNotice(anyReplyRecipe);
  }
  if (replyRecipe) {
    const { data: rtData, prose: rtProse } = parseRecipeAnalysis(replyRecipe.analysis);
    const targets = (Array.isArray(rtData?.replyTargets) ? rtData.replyTargets.filter((t) => t?.suggestedReply) : [])
      .slice(0, EMAIL_CAPS.suggestedReplies);
    if (targets.length) {
      repliesHtml = targets.map((t) => `<div style="margin-bottom:14px;padding:14px 16px;background:${DT.brandTint};border:1px solid ${DT.line};border-radius:12px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="font-family:${DT.fMono};font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${DT.brand};">Reply${t.tier ? ` &middot; Tier ${t.tier}` : ''}${t.score != null ? ` &middot; ${t.score}/10` : ''}</span>
        </div>
        <div style="font-family:${DT.fBody};font-size:13px;font-weight:700;color:${DT.ink};margin-bottom:4px;">${escapeHtml(t.author || '')}${t.url ? linkBit(t.url) : ''}</div>
        ${t.text ? `<div style="font-family:${DT.fBody};font-size:12px;line-height:1.5;color:${DT.soft};margin-bottom:8px;font-style:italic;">&ldquo;${escapeHtml(String(t.text).slice(0, 200))}&rdquo;</div>` : ''}
        ${t.why ? `<div style="font-family:${DT.fBody};font-size:12px;line-height:1.5;color:${DT.soft};margin-bottom:8px;"><strong style="color:${DT.ink};">Why:</strong> ${escapeHtml(t.why)}</div>` : ''}
        <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};margin-bottom:3px;">Draft reply</div>
        <div style="font-family:${DT.fBody};font-size:13px;line-height:1.55;color:${DT.ink};">${escapeHtml(t.suggestedReply)}</div>
        ${t.url ? `<a href="${escapeHtml(t.url)}" style="display:inline-block;margin-top:8px;color:${DT.brand};font-family:${DT.fMono};font-size:10px;letter-spacing:.06em;text-transform:uppercase;">Read post &amp; reply &rarr;</a>` : ''}
      </div>`).join('');
      if (rtProse) repliesHtml += `<div style="font-family:${DT.fBody};font-size:12px;line-height:1.6;color:${DT.soft};margin-top:12px;padding-top:12px;border-top:1px solid ${DT.line};">${escapeHtml(rtProse)}</div>`;
      repliesHtml += postMeLink;
    }
  }
  if (!repliesHtml && replyRecipe) {
    // Prose fallback: the reply-targets recipe ran but didn't emit parseable
    // replyTargets JSON (model returned prose). Render the fresh reply guidance
    // rather than an empty card — mirrors the reddit/X sections' proseFallback.
    // Strips any leading/trailing ``` fences the model may have wrapped it in.
    const { data: rtData, prose: rtProse } = parseRecipeAnalysis(replyRecipe.analysis);
    const raw = String(rtProse || (rtData ? '' : replyRecipe.analysis) || '').trim();
    const cleaned = raw.replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();
    if (cleaned) {
      repliesHtml = `<div style="font-family:${DT.fBody};font-size:13px;line-height:1.6;color:${DT.ink};margin-bottom:8px;">${escapeHtml(cleaned).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</div>` + postMeLink;
    }
  }
  // No fallback to scout opportunity text here. Reply suggestions are only safe
  // for email when the dedicated reply-targets recipe ran recently; otherwise
  // the section intentionally renders an empty/stale state instead of reusing
  // old suggestedReply strings.

  // Signals was the section that blew past Gmail's clip (40 full-text KOL posts
  // ≈ 56KB on 2026-07-04): cap KOL posts per handle, cap competitors/narratives,
  // slice row text, and link the remainder to the Executive Brief.
  const kolAll = intel.kols || [];
  const kolCounts = new Map();
  const kols = kolAll.filter((k) => {
    const name = String(k.name || '').toLowerCase();
    const n = kolCounts.get(name) || 0;
    if (n >= EMAIL_CAPS.signalsKolPerHandle) return false;
    kolCounts.set(name, n + 1);
    return true;
  }).slice(0, EMAIL_CAPS.signalsKols);
  const competitorsAll = intel.competitors || [];
  const narrativesAll = intel.narratives || [];
  const competitors = competitorsAll.slice(0, EMAIL_CAPS.signalsCompetitors);
  const narratives = narrativesAll.slice(0, EMAIL_CAPS.signalsNarratives);
  const signalsDropped = (kolAll.length - kols.length)
    + (competitorsAll.length - competitors.length)
    + (narrativesAll.length - narratives.length);
  const signalRows = [
    ...kols.map((k) => ({ tag: `KOL${k.platform ? ` · ${k.platform}` : ''}`, label: k.name, value: k.detail, url: k.url })),
    ...competitors.map((c) => ({ tag: `Competitor${c.impact ? ` · ${c.impact}` : ''}`, label: c.name, value: c.finding, url: c.url })),
    ...narratives.map((n) => ({ tag: 'Narrative', label: n.trend, value: n.detail, url: n.url })),
  ];
  const signalsHtml = signalRows.length
    ? signalRows.map((s) => `<tr>
        <td style="${TD}width:120px;font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${DT.light};vertical-align:top;">${escapeHtml(s.tag)}</td>
        <td style="${TD}"><strong>${escapeHtml(s.label)}</strong>${linkBit(s.url)}<div style="margin-top:2px;color:${DT.soft};font-size:12px;">${escapeHtml(String(s.value || '').slice(0, EMAIL_CAPS.signalsText))}</div></td>
      </tr>`).join('') + emailOverflowRow(signalsDropped, 'signals', 2)
    : '';

  // Watchlist — every configured account, name-for-name, with its activity
  // this run (or a "quiet" note). Surfaces named accounts even when not
  // brand-specific, for narrative opportunities.
  const watchlistAll = intel.watchlist || [];
  const watchlistShown = watchlistAll.slice(0, EMAIL_CAPS.watchlistHandles);
  const watchlistHtml = watchlistShown.length
    ? watchlistShown.map((w) => `<tr>
        <td style="${TD}width:150px;font-family:${DT.fMono};font-size:12px;font-weight:700;color:${DT.ink};vertical-align:top;">${escapeHtml(w.handle)}</td>
        <td style="${TD}">${
          w.found
            ? w.activity.slice(0, EMAIL_CAPS.watchlistActivityPerHandle).map((a) => `<div style="margin-bottom:4px;color:${DT.soft};font-size:12px;">${escapeHtml((a.text || '').slice(0, 240))}${linkBit(a.url)}</div>`).join('')
            : `<span style="color:${DT.light};font-size:12px;">No activity surfaced this run.</span>`
        }</td>
      </tr>`).join('') + emailOverflowRow(watchlistAll.length - watchlistShown.length, 'accounts', 2)
    : '';

  const c = intel.content || {};
  const strategyPlanFresh = isFreshStrategyPlan(intel.strategyBuilder);
  const strategyStaleHtml = intel.strategyBuilder && !strategyPlanFresh
    ? staleStrategyNotice(intel.strategyBuilder)
    : '';
  const strategyPostBlocks = (strategyPlanFresh ? (intel.strategyBuilder?.today?.posts || []) : []).map((p, index) => ({
    label: p.platformHint ? `Today · ${String(p.platformHint).toUpperCase()}` : `Today · Post ${index + 1}`,
    text: p.content,
    foot: [p.signalUsed ? `Signal: ${p.signalUsed}` : '', p.rationale || ''].filter(Boolean).join(' · '),
    platform: platformOf(p.platformHint),
  }));
  // Content drafts per platform, derived from the registry (each platform's
  // first present content field). Add a platform in _digest-config and its
  // drafts flow here automatically.
  const contentBlocks = [];
  for (const plat of digestConfig.POST_PLATFORMS) {
    const field = (plat.fields || []).find((f) => c[f]);
    if (field) contentBlocks.push({ label: plat.label, text: c[field], platform: plat.key });
  }
  const postBlocks = [...strategyPostBlocks, ...contentBlocks].filter((b) => ppOn(b.platform));
  const postsHtml = postBlocks.length
    ? postBlocks.map((p) => `<div style="margin-bottom:10px;padding:12px 14px;background:${DT.card};border:1px solid ${DT.line};border-radius:10px;">
        <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin-bottom:6px;">${escapeHtml(p.label)}</div>
        <div style="font-family:${DT.fBody};font-size:13px;color:${DT.ink};line-height:1.5;">${escapeHtml(p.text)}</div>
        ${p.foot ? `<div style="margin-top:6px;font-family:${DT.fBody};font-size:11px;color:${DT.soft};line-height:1.45;">${escapeHtml(p.foot)}</div>` : ''}
      </div>`).join('') + postMeLink
    : '';
  const planPreview = (strategyPlanFresh ? (intel.strategyBuilder?.items || []) : []).slice(0, 7);
  const planTable = planPreview.length
    ? dDataTable([{ label: 'Date' }, { label: 'Post' }], planPreview.map((item) => `<tr>
        <td style="${TD}width:120px;font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${DT.light};vertical-align:top;">${escapeHtml(String(item.scheduledAt || '').slice(0, 10))}</td>
        <td style="${TD}"><strong>${escapeHtml(item.kind || 'post')}</strong><div style="margin-top:2px;color:${DT.soft};font-size:12px;">${escapeHtml(item.content || '')}</div></td>
      </tr>`).join(''))
    : '';

  // Press Coverage — its own section, not a row type inside Signals. Every item
  // is an article with a publication, a date and a working link (projectBrief
  // drops uncitable ones), so it reads as a source list rather than a finding.
  const coverageAll = intel.coverage || [];
  const coverageShown = coverageAll.slice(0, EMAIL_CAPS.pressCoverage);
  const coverageHtml = coverageShown.length
    ? coverageShown.map((p) => `<tr>
        <td style="${TD}width:120px;font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${DT.light};vertical-align:top;">${escapeHtml(p.publication || 'Press')}${p.publishedAt ? `<div style="margin-top:3px;letter-spacing:.04em;text-transform:none;">${escapeHtml(String(p.publishedAt).slice(0, 10))}</div>` : ''}</td>
        <td style="${TD}"><strong>${escapeHtml(p.headline)}</strong>${linkBit(p.url)}<div style="margin-top:2px;color:${DT.soft};font-size:12px;">${escapeHtml(String(p.summary || '').slice(0, EMAIL_CAPS.signalsText))}</div></td>
      </tr>`).join('') + emailOverflowRow(coverageAll.length - coverageShown.length, 'articles', 2)
    : '';

  return {
    humanBrief: intel.humanBrief
      ? `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:18px 20px;font-family:${DT.fBody};font-size:14px;line-height:1.6;color:${DT.ink};">${escapeHtml(intel.humanBrief)}</div>`
      : '',
    pressCoverage: coverageHtml ? dDataTable([{ label: 'Publication' }, { label: 'Article' }], coverageHtml) : '',
    opportunities: oppRows ? dDataTable([{ label: 'Conversation / angle' }], oppRows) : '',
    suggestedReplies: repliesHtml,
    signals: signalsHtml ? dDataTable([{ label: 'Type' }, { label: 'Finding' }], signalsHtml) : '',
    watchlistAccounts: watchlistHtml ? dDataTable([{ label: 'Account' }, { label: 'Activity this run' }], watchlistHtml) : '',
    suggestedPosts: strategyStaleHtml || postsHtml || '',
    planPreview: strategyStaleHtml || planTable,
  };
}

/** Split a recipe analysis string into leading JSON + trailing prose. Ported
 *  from the dashboard's parseRecipeAnalysis (DashboardPage.jsx) so the email
 *  renders the same watchlist-analysis shape server-side. */
function parseRecipeAnalysis(text) {
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

/** "Happening on X" watchlist brief — email port of renderWatchlistAnalysisBlock
 *  (DashboardPage.jsx). Renders the dashboard REPORT-tab block in the brief-kit
 *  look using email-safe inline styles + the digest's warm-cream tokens
 *  (no pseudo-elements / CSS grid). Returns '' when there's nothing to show. */
function buildWatchlistBriefSection(analysisText) {
  const { data, prose } = parseRecipeAnalysis(analysisText);
  if (!data && !prose) return '';

  const spotHandle = data?.spotlight?.handle ? String(data.spotlight.handle).replace(/^@+/, '') : '';
  const handleNames = Array.from(new Set(
    (Array.isArray(data?.handles) ? data.handles : [])
      .map((h) => String(h.handle || '').replace(/^@+/, '').trim())
      .filter(Boolean)
  ));
  // Bold tracked handle names wherever they appear in free-form text. Escape
  // first — handle names are alphanumeric/underscore, unchanged by escaping.
  const boldHandles = (raw) => {
    const safe = escapeHtml(String(raw || ''));
    if (!handleNames.length) return safe;
    const escaped = handleNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(@?(?:${escaped.join('|')})\\b)`, 'gi');
    return safe.replace(re, '<strong>$1</strong>');
  };

  const sec = (t) => `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:${DT.light};margin:0 0 6px;">${t}</div>`;
  const pull = (inner) => `<p style="font-family:${DT.fBody};font-weight:300;font-size:18px;line-height:1.3;padding:0;margin:0;color:${DT.ink};">${inner}</p>`;

  const overviewHtml = data?.overview
    ? `<div style="margin-bottom:16px;">${sec('Overview')}${pull(boldHandles(data.overview))}</div>` : '';
  const actionHtml = data?.priorityAction
    ? `<div style="margin-bottom:16px;">${sec('Suggested action')}${pull(escapeHtml(data.priorityAction))}</div>` : '';

  const handlesArr = (Array.isArray(data?.handles) ? data.handles : []).slice(0, EMAIL_CAPS.analysisCards);
  const handleCards = handlesArr.length
    ? `<div style="margin-bottom:16px;">${sec('Per handle')}<div style="font-size:0;line-height:0;">${handlesArr.map((h) => {
        const hh = escapeHtml(String(h.handle || '').replace(/^@+/, ''));
        return `<div style="display:inline-block;vertical-align:top;width:48%;min-width:200px;margin:0 2% 10px 0;background:rgba(255,255,255,0.55);border:1px solid ${DT.line};border-radius:12px;padding:13px;box-sizing:border-box;">
          <div style="font-family:${DT.fDisp};font-weight:900;font-size:18px;line-height:1;text-transform:uppercase;color:${DT.ink};">@${hh}</div>
          ${h.posting ? `<p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.ink};margin:8px 0 0;">${escapeHtml(h.posting)}</p>` : ''}
          ${h.talkedAbout ? `<div style="margin-top:10px;padding-top:10px;border-top:1px dashed ${DT.dash};">${sec('Talked about')}<p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.soft};margin:3px 0 0;">${escapeHtml(h.talkedAbout)}</p></div>` : ''}
        </div>`;
      }).join('')}</div></div>` : '';

  const spotlightHtml = data?.spotlight?.why
    ? `<div style="background:${DT.ink};border-radius:14px;padding:16px 18px;margin-top:6px;">
        <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.6);margin-bottom:8px;">Spotlight &middot; @${escapeHtml(spotHandle)}</div>
        <div style="font-family:${DT.fBody};font-weight:300;font-size:16px;line-height:1.3;color:#fff;">${escapeHtml(data.spotlight.why)}</div>
      </div>` : '';

  const proseFallback = (!data && prose)
    ? `<p style="font-family:${DT.fBody};font-size:13.5px;line-height:1.55;color:${DT.ink};margin:0;">${escapeHtml(prose).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</p>` : '';

  // Inner content only — composed as the "Happening on X" sub-block under the
  // Market Signals brief header by buildEmailHtml.
  return `${overviewHtml}${actionHtml}${handleCards}${spotlightHtml}${proseFallback}`;
}

/** "What's happening on Reddit" platform brief. Same persisted-analysis pattern
 *  as Happening on X, but shaped around Reddit threads/items instead of handles. */
function buildRedditBriefSection(analysisText) {
  const { data, prose } = parseRecipeAnalysis(analysisText);
  if (!data && !prose) return '';

  const sec = (t) => `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:${DT.light};margin:0 0 6px;">${t}</div>`;
  const pull = (inner) => `<p style="font-family:${DT.fBody};font-weight:300;font-size:18px;line-height:1.3;padding:0;margin:0;color:${DT.ink};">${inner}</p>`;
  const link = (url) => url ? `<a href="${escapeHtml(url)}" style="color:${DT.accent};font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;">Read thread &rarr;</a>` : '';

  const overviewHtml = data?.overview
    ? `<div style="margin-bottom:16px;">${sec('Overview')}${pull(escapeHtml(data.overview))}</div>` : '';
  const actionHtml = data?.priorityAction
    ? `<div style="margin-bottom:16px;">${sec('Suggested action')}${pull(escapeHtml(data.priorityAction))}</div>` : '';
  const threads = (Array.isArray(data?.threads) ? data.threads : (Array.isArray(data?.items) ? data.items : [])).slice(0, EMAIL_CAPS.analysisCards);
  const threadCards = threads.length
    ? `<div style="margin-bottom:16px;">${sec('Threads to review')}<div style="font-size:0;line-height:0;">${threads.map((t) => {
        const subreddit = t.subreddit ? String(t.subreddit).replace(/^r\//, '') : 'reddit';
        const body = String(t.summary || t.why || t.opportunity || t.actionableTakeaway || '').slice(0, EMAIL_CAPS.analysisCardText);
        return `<div style="display:inline-block;vertical-align:top;width:48%;min-width:200px;margin:0 2% 10px 0;background:rgba(255,255,255,0.55);border:1px solid ${DT.line};border-radius:12px;padding:13px;box-sizing:border-box;">
          <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin-bottom:6px;">r/${escapeHtml(subreddit)}</div>
          <div style="font-family:${DT.fDisp};font-weight:900;font-size:17px;line-height:1.05;text-transform:uppercase;color:${DT.ink};">${escapeHtml(t.title || 'Reddit thread')}</div>
          ${body ? `<p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.soft};margin:8px 0 0;">${escapeHtml(body)}</p>` : ''}
          ${t.url ? `<div style="margin-top:10px;">${link(t.url)}</div>` : ''}
        </div>`;
      }).join('')}</div></div>` : '';

  const spotlight = data?.spotlight;
  const spotlightHtml = spotlight?.why
    ? `<div style="background:${DT.ink};border-radius:14px;padding:16px 18px;margin-top:6px;">
        <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.6);margin-bottom:8px;">Spotlight${spotlight.subreddit ? ` &middot; r/${escapeHtml(String(spotlight.subreddit).replace(/^r\//, ''))}` : ''}</div>
        <div style="font-family:${DT.fBody};font-weight:300;font-size:16px;line-height:1.3;color:#fff;">${escapeHtml(spotlight.why)}</div>
        ${spotlight.url ? `<div style="margin-top:10px;">${link(spotlight.url)}</div>` : ''}
      </div>` : '';

  const proseFallback = (!data && prose)
    ? `<p style="font-family:${DT.fBody};font-size:13.5px;line-height:1.55;color:${DT.ink};margin:0;">${escapeHtml(prose).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</p>` : '';

  return `${overviewHtml}${actionHtml}${threadCards}${spotlightHtml}${proseFallback}`;
}

/** "Happening on Instagram" platform brief. Instagram mirror of buildRedditBriefSection
 *  — same persisted-analysis JSON shape, relabeled for IG accounts/posts. */
function buildInstagramBriefSection(analysisText) {
  const { data, prose } = parseRecipeAnalysis(analysisText);
  if (!data && !prose) return '';

  const sec = (t) => `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:${DT.light};margin:0 0 6px;">${t}</div>`;
  const pull = (inner) => `<p style="font-family:${DT.fBody};font-weight:300;font-size:18px;line-height:1.3;padding:0;margin:0;color:${DT.ink};">${inner}</p>`;
  const link = (url) => url ? `<a href="${escapeHtml(url)}" style="color:${DT.accent};font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;">View post &rarr;</a>` : '';

  const overviewHtml = data?.overview
    ? `<div style="margin-bottom:16px;">${sec('Overview')}${pull(escapeHtml(data.overview))}</div>` : '';
  const actionHtml = data?.priorityAction
    ? `<div style="margin-bottom:16px;">${sec('Suggested action')}${pull(escapeHtml(data.priorityAction))}</div>` : '';
  const threads = (Array.isArray(data?.threads) ? data.threads : (Array.isArray(data?.items) ? data.items : [])).slice(0, EMAIL_CAPS.analysisCards);
  const threadCards = threads.length
    ? `<div style="margin-bottom:16px;">${sec('Posts to review')}<div style="font-size:0;line-height:0;">${threads.map((t) => {
        const account = t.subreddit ? String(t.subreddit).replace(/^@/, '') : 'instagram';
        const body = String(t.summary || t.why || t.opportunity || t.actionableTakeaway || '').slice(0, EMAIL_CAPS.analysisCardText);
        return `<div style="display:inline-block;vertical-align:top;width:48%;min-width:200px;margin:0 2% 10px 0;background:rgba(255,255,255,0.55);border:1px solid ${DT.line};border-radius:12px;padding:13px;box-sizing:border-box;">
          <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin-bottom:6px;">@${escapeHtml(account)}</div>
          <div style="font-family:${DT.fDisp};font-weight:900;font-size:17px;line-height:1.05;text-transform:uppercase;color:${DT.ink};">${escapeHtml(t.title || 'Instagram post')}</div>
          ${body ? `<p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.soft};margin:8px 0 0;">${escapeHtml(body)}</p>` : ''}
          ${t.url ? `<div style="margin-top:10px;">${link(t.url)}</div>` : ''}
        </div>`;
      }).join('')}</div></div>` : '';

  const spotlight = data?.spotlight;
  const spotlightHtml = spotlight?.why
    ? `<div style="background:${DT.ink};border-radius:14px;padding:16px 18px;margin-top:6px;">
        <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,0.6);margin-bottom:8px;">Spotlight${spotlight.subreddit ? ` &middot; @${escapeHtml(String(spotlight.subreddit).replace(/^@/, ''))}` : ''}</div>
        <div style="font-family:${DT.fBody};font-weight:300;font-size:16px;line-height:1.3;color:#fff;">${escapeHtml(spotlight.why)}</div>
        ${spotlight.url ? `<div style="margin-top:10px;">${link(spotlight.url)}</div>` : ''}
      </div>` : '';

  const proseFallback = (!data && prose)
    ? `<p style="font-family:${DT.fBody};font-size:13.5px;line-height:1.55;color:${DT.ink};margin:0;">${escapeHtml(prose).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</p>` : '';

  return `${overviewHtml}${actionHtml}${threadCards}${spotlightHtml}${proseFallback}`;
}

/** Opportunity Signals brief — public buying-signal opportunities, each with a
 *  trigger quote, likely problem, and a non-pitch response angle. Same JSON-first
 *  persisted-analysis shape as the other platform briefs; capped to the top
 *  high-confidence items for the email (full list lives in the dashboard REPORT
 *  block). See docs/plans/OPPORTUNITY-SIGNALS-MARKET-SIGNALS-PLAN.md. */
function buildOpportunitySignalsBriefSection(analysisText) {
  const { data, prose } = parseRecipeAnalysis(analysisText);
  if (!data && !prose) return '';

  const sec = (t) => `<div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:${DT.light};margin:0 0 6px;">${t}</div>`;
  const link = (url) => url ? `<a href="${escapeHtml(url)}" style="color:${DT.accent};font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;">Source &rarr;</a>` : '';

  const opportunities = (Array.isArray(data?.opportunities) ? data.opportunities : []).slice(0, 3);
  const cards = opportunities.length
    ? `<div style="margin-bottom:16px;">${sec('Opportunities')}<div style="font-size:0;line-height:0;">${opportunities.map((o) => {
        const who = [o.person, o.company].filter(Boolean).join(' / ') || 'Unknown';
        return `<div style="display:inline-block;vertical-align:top;width:48%;min-width:200px;margin:0 2% 10px 0;background:rgba(255,255,255,0.55);border:1px solid ${DT.line};border-radius:12px;padding:13px;box-sizing:border-box;">
          <div style="font-family:${DT.fMono};font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:${DT.light};margin-bottom:6px;">${escapeHtml(o.platform || 'signal')}${o.confidence ? ` &middot; ${escapeHtml(o.confidence)} confidence` : ''}</div>
          <div style="font-family:${DT.fDisp};font-weight:900;font-size:17px;line-height:1.05;text-transform:uppercase;color:${DT.ink};">${escapeHtml(who)}</div>
          ${o.currentTrigger ? `<p style="font-family:${DT.fBody};font-size:13px;line-height:1.5;color:${DT.soft};margin:8px 0 0;">&ldquo;${escapeHtml(String(o.currentTrigger).slice(0, 240))}&rdquo;</p>` : ''}
          ${o.possibleResponse ? `<p style="font-family:${DT.fBody};font-size:12.5px;line-height:1.5;color:${DT.ink};margin:8px 0 0;"><strong>Angle:</strong> ${escapeHtml(String(o.possibleResponse).slice(0, 200))}</p>` : ''}
          ${o.url ? `<div style="margin-top:10px;">${link(o.url)}</div>` : ''}
        </div>`;
      }).join('')}</div></div>` : '';

  const proseFallback = (!data && prose)
    ? `<p style="font-family:${DT.fBody};font-size:13.5px;line-height:1.55;color:${DT.ink};margin:0;">${escapeHtml(prose).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>')}</p>` : '';

  return `${cards}${proseFallback}`;
}

/** Creative Brief attachment — inlines the run onboarding-brief summary + a hero
 *  image in the digest's warm-cream style. Returns '' when nothing has run. */
function buildCreativeBriefSection(creative) {
  if (!creative || !creative.summary) return '';
  const img = creative.image
    ? `<img src="${escapeHtml(creative.image)}" alt="" style="width:100%;max-width:520px;border-radius:12px;border:1px solid ${DT.line};margin:0 0 14px;display:block;">`
    : '';
  const generatedAt = creative.generatedAt
    ? `<div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${DT.light};margin:0 0 8px;">Latest creative module brief &middot; ${escapeHtml(new Date(creative.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}</div>`
    : '';
  const text = escapeHtml(creative.summary).replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
  // Inner content only — composed under the Creative brief header by buildEmailHtml.
  return `${img}${generatedAt}<p style="font-family:${DT.fBody};font-size:14px;line-height:1.62;color:${DT.ink};margin:0;">${text}</p>`;
}

export function buildEmailHtml(firebase, vercel, ga4, agenda, homepage, timestamp, summary, briefs, include = {}, creative = null, briefUrl = null, contactUrl = '', videoItems = [], order = [], postPlatforms = {}, freshnessToken = '', videoStatus = {}, videoPublishCtx = {}) {
  // Fallback target when no hosted brief is resolved (briefLinkMode 'off' /
  // 'latest' with nothing published / 'fresh' run failed): the dashboard modal.
  const executiveBriefUrl = appUrl('/dashboard?open=brief');
  const briefLinkUrl = briefUrl || executiveBriefUrl;
  // CTA row: primary "Open Executive Brief" + secondary "Contact Your Human"
  // (mirrors the brief's "Meet with a Human" CTA). Contact defaults to the
  // brief's Calendly when unconfigured, so the button shows whenever toggled on.
  const showBrief = include.execBriefLink !== false;
  const showContact = include.contactHuman !== false;
  const contactHref = escapeHtml(String(contactUrl || '').trim() || 'https://calendly.com/bballi/30min');
  const briefBtn = showBrief
    ? `<a class="cta-btn" href="${escapeHtml(briefLinkUrl)}" style="display:inline-block;text-align:center;background:${DT.ink};color:${DT.card};font-family:${DT.fMono};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-radius:999px;padding:13px 18px;border:1px solid ${DT.ink};margin:0 8px 8px 0;">Open Executive Brief</a>`
    : '';
  const contactBtn = showContact
    ? `<a class="cta-btn" href="${contactHref}" style="display:inline-block;text-align:center;background:${DT.card};color:${DT.ink};font-family:${DT.fMono};font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border-radius:999px;padding:13px 18px;border:1px solid ${DT.ink};margin:0 8px 8px 0;">Contact Your Human</a>`
    : '';
  const ctaRow = (showBrief || showContact)
    ? `<div style="margin:18px 0 28px;">${briefBtn}${contactBtn}</div>`
    : '';
  const briefList = Array.isArray(briefs) ? briefs : [];
  // Strategic-brief items are now individually toggled. Aggregate each part
  // across all briefs so a single dSub renders that item from every client.
  const strategicParts = briefList.map((b) => buildStrategicParts(b.intel, postPlatforms));
  const sPart = (k) => strategicParts.map((p) => p[k]).filter(Boolean).join('');
  const watchlistSections = include.watchlist === false ? '' : briefList
    .map((b) => buildWatchlistBriefSection(b.intel?.watchlistAnalysis))
    .filter((s) => s && s.trim())
    .join('');
  const redditAnalysisSections = include.redditAnalysis === false ? '' : briefList
    .map((b) => buildRedditBriefSection(b.intel?.redditAnalysis))
    .filter((s) => s && s.trim())
    .join('');
  const instagramAnalysisSections = include.instagramAnalysis === false ? '' : briefList
    .map((b) => buildInstagramBriefSection(b.intel?.instagramAnalysis))
    .filter((s) => s && s.trim())
    .join('');
  // "Market Talk on X" reuses buildInstagramBriefSection: same analyzer JSON schema
  // (overview/spotlight/threads) and that renderer already labels each item with an
  // @handle, which is the right shape for X posts. No separate builder needed.
  const xMarketTalkSections = include.xMarketTalk === false ? '' : briefList
    .map((b) => buildInstagramBriefSection(b.intel?.xMarketTalkAnalysis))
    .filter((s) => s && s.trim())
    .join('');
  // Empty-state copy for Market Talk on X, derived from the persisted run
  // status. "Run Generate & Send" is only correct when the search never ran —
  // saying it after the X API returned 402 blames the admin for a billing
  // state, which is exactly what happened on 2026-08-13.
  const xMarketTalkEmptyCopy = () => {
    const st = briefList.map((b) => b.intel?.xMarketTalkStatus).find(Boolean);
    if (!st) return 'Market Talk on X is enabled, but the X brand search has not run for this client yet. Run Generate & Send — that is what performs the search (paid X API). The daily cron never runs it.';
    if (st.billing) return `The X API refused the brand search with 402 Payment Required${st.at ? ` (last tried ${String(st.at).slice(0, 16).replace('T', ' ')} UTC)` : ''}. This is an account balance issue, not a configuration one — top up X API credits, then run Generate & Send again.`;
    if (st.reason === 'x-disabled') return 'Market Talk on X is enabled in the email, but X is switched off as a source in the Market Signals card. Turn X on there first.';
    if (st.reason === 'no-x-handle') return 'Market Talk on X needs a brand X handle. Set one in the Market Signals card, then run Generate & Send.';
    if (st.reason === 'no-x-results') return `The X brand search ran${st.at ? ` (${String(st.at).slice(0, 16).replace('T', ' ')} UTC)` : ''} and returned no posts matching this brand. That is a real finding, not an error — nobody is talking about the brand on X inside the search window.`;
    return `The X brand search did not complete: ${st.detail || st.reason || 'unknown reason'}. Run Generate & Send to retry.`;
  };
  const opportunitySignalsSections = include.opportunitySignals === false ? '' : briefList
    .map((b) => buildOpportunitySignalsBriefSection(b.intel?.opportunitySignalsAnalysis))
    .filter((s) => s && s.trim())
    .join('');
  const dateStr = new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Demo (zeroed) groups render at 0 with "connect this" copy instead of the
  // real "nothing happened in 24h" copy, so the section reads as an available
  // slot rather than a dead result. `demo` is set on the zeroed fixture by the
  // route (see DEMO_METRIC_GROUPS in _digest-config.js).
  const emptyCopy = (source, demoMsg, realMsg) => (source && source.demo ? demoMsg : realMsg);

  const newUsersRows = firebase.newUsersList.length
    ? firebase.newUsersList
        .map(
          (u) => `<tr>
          <td style="${TD}">${escapeHtml(u.email)}</td>
          <td style="${TDsub}">${u.website ? escapeHtml(u.website) : '—'}</td>
          <td style="${TDsub}font-family:${DT.fMono};text-align:right;white-space:nowrap;">${new Date(u.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(firebase, 'Not connected yet — your new sign-ups will be listed here.', 'No new sign-ups in the last 24 hours')}</td></tr>`;

  const recentRunsRows = firebase.recentRunsList.length
    ? firebase.recentRunsList
        .map(
          (r) => `<tr>
          <td style="${TD}">${escapeHtml(r.website || r.id)}</td>
          <td style="${TD}">${dStatusBadge(r.status)}</td>
          <td style="${TDsub}font-family:${DT.fMono};text-align:right;white-space:nowrap;">${new Date(r.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(firebase, 'Not connected yet — dashboards created for you will be listed here.', 'No new dashboards created')}</td></tr>`;

  const deploymentsRows = vercel.deployments?.length
    ? vercel.deployments
        .map(
          (d) => `<tr>
          <td style="${TD}">${dStatusBadge(d.state)}</td>
          <td style="${TDsub}max-width:300px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(d.commit || '—')}</td>
          <td style="${TDsub}font-family:${DT.fMono};text-align:right;white-space:nowrap;">${new Date(d.created).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</td>
        </tr>`
        )
        .join('')
    : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(vercel, 'Not connected yet — connect your hosting to see each deploy here.', 'No deployments in the last 24 hours')}</td></tr>`;

  const statusBreakdown = Object.entries(firebase.statusCounts)
    .map(([status, count]) => dChip(escapeHtml(status), count))
    .join('');

  const errorRows = vercel.errorLogs?.length
    ? vercel.errorLogs.map((e) => `<tr>
            <td style="${TD}font-family:${DT.fMono};font-size:12px;">${escapeHtml(e.path)}</td>
            <td style="${TDsub}max-width:300px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(e.message)}</td>
            <td style="${TDnum}">${e.statusCode || '—'}</td>
          </tr>`).join('')
    : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(vercel, 'Not connected yet — connect your hosting to catch runtime errors here.', 'No runtime errors in the last 24 hours')}</td></tr>`;
  const errorInner = dDataTable([{ label: 'Path' }, { label: 'Message' }, { label: 'Status', right: true }], errorRows);

  // ── Inner pieces for the brief-grouped sections (each a dSub under a header) ──
  const platformOverviewCells = dStatCells([
    { num: firebase.newUsers, label: 'New sign-ups' },
    { num: firebase.totalUsers, label: 'Total users' },
    { num: firebase.recentRuns, label: 'Dashboards' },
    { num: vercel.totalDeployments || 0, label: 'Deployments' },
  ], 4);
  const ga4TrafficInner = ga4.overview
    ? `${dStatCells([
        { num: ga4.overview.sessions, label: 'Sessions' },
        { num: ga4.overview.pageViews, label: 'Page views' },
        { num: ga4.overview.totalUsers, label: 'Visitors' },
        { num: ga4.overview.newUsers, label: 'New' },
        { num: `${ga4.overview.bounceRate}%`, label: 'Bounce' },
      ], 5)}<div style="font-family:${DT.fMono};font-size:11px;color:${DT.soft};letter-spacing:.02em;">Avg session <strong style="color:${DT.ink};">${Math.floor(ga4.overview.avgSessionDuration / 60)}m ${ga4.overview.avgSessionDuration % 60}s</strong> &nbsp;&middot;&nbsp; Engaged <strong style="color:${DT.ink};">${ga4.overview.engagedSessions}</strong></div>${ga4.demo ? `<div style="font-family:${DT.fBody};font-size:12px;color:${DT.light};margin-top:10px;">Not connected yet — connect Google Analytics and these fill with your real traffic each day.</div>` : ''}`
    : `<p style="font-family:${DT.fBody};font-size:13px;color:${ga4.error ? DT.accent : DT.light};margin:0;">${ga4.error ? `GA4 unavailable: ${escapeHtml(ga4.error)}` : 'No traffic recorded in the last 24 hours.'}</p>`;
  const topPagesTable = dDataTable(
    [{ label: 'Page' }, { label: 'Views', right: true }, { label: 'Users', right: true }],
    ga4.topPages?.length ? ga4.topPages.map((p) => `<tr>
      <td style="${TD}max-width:300px;word-break:break-word;overflow-wrap:anywhere;">${escapeHtml(p.path)}</td>
      <td style="${TDnum}">${p.views}</td>
      <td style="${TDnum}color:${DT.soft};font-weight:400;">${p.users}</td>
    </tr>`).join('') : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(ga4, 'Not connected yet — your most-viewed pages will rank here.', 'No page data in the last 24 hours')}</td></tr>`
  );
  const sourcesTable = dDataTable(
    [{ label: 'Source / Medium' }, { label: 'Sessions', right: true }, { label: 'Users', right: true }],
    ga4.trafficSources?.length ? ga4.trafficSources.map((s) => `<tr>
      <td style="${TD}">${escapeHtml(s.source)} <span style="color:${DT.light};">/ ${escapeHtml(s.medium)}</span></td>
      <td style="${TDnum}">${s.sessions}</td>
      <td style="${TDnum}color:${DT.soft};font-weight:400;">${s.users}</td>
    </tr>`).join('') : `<tr><td colspan="3" style="${TDempty}">${emptyCopy(ga4, 'Not connected yet — where your visitors come from will break down here.', 'No traffic sources in the last 24 hours')}</td></tr>`
  );
  const keyEventsInner = Object.keys(ga4.events || {}).length
    ? `<div>${Object.entries(ga4.events).map(([name, count]) => dChip(escapeHtml(name.replace(/_/g, ' ')), count)).join('')}</div>`
    : `<span style="font-family:${DT.fBody};font-size:13px;color:${DT.light};">${emptyCopy(ga4, 'Not connected yet — the actions you choose to track will count here.', 'No key events in the last 24 hours')}</span>`;
  const signupsTable = dDataTable([{ label: 'Email' }, { label: 'Website' }, { label: 'Time', right: true }], newUsersRows);
  const dashboardsTable = dDataTable([{ label: 'Website' }, { label: 'Status' }, { label: 'Time', right: true }], recentRunsRows);
  const pipelineInner = `<div style="margin-bottom:10px;">${statusBreakdown || `<span style="color:${DT.light};font-family:${DT.fBody};font-size:13px;">${emptyCopy(firebase, 'Not connected yet — run status will break down here.', 'No pipeline data')}</span>`}</div><div style="font-family:${DT.fMono};font-size:11px;color:${DT.soft};letter-spacing:.02em;">Total runs <strong style="color:${DT.ink};">${firebase.totalRuns}</strong> &nbsp;&middot;&nbsp; Clients <strong style="color:${DT.ink};">${firebase.totalClients}</strong></div>`;
  const deploymentsInner = `${vercel.errors ? `<p style="font-family:${DT.fBody};color:${DT.accent};font-size:12px;margin:0 0 10px;">Note: ${escapeHtml(vercel.errors)}</p>` : ''}${dDataTable([{ label: 'Status' }, { label: 'Commit' }, { label: 'Time', right: true }], deploymentsRows)}`;

  // Per-section renderers, keyed by include key. Each returns its email block
  // (a dSub for items under a brief header; a standalone section for top items).
  // The email renders each group's keys in the admin's saved `order` (shuffled
  // up/down within the group), gated by include[key].
  // Every toggleable element is its OWN section with the established header
  // (kicker + Doto title), like Weather / Happening on X. Empty body => no
  // section (skips items with nothing to show — preview and sent skip alike).
  const section = (kicker, title, body) => (body && String(body).trim()) ? dSection(kicker, title, body) : '';
  const noDataBlock = (message) => `<div style="background:${DT.card};border:1px dashed ${DT.dash};border-radius:14px;padding:16px 18px;font-family:${DT.fBody};font-size:13px;line-height:1.55;color:${DT.soft};">${escapeHtml(message)}</div>`;
  const RENDER = {
    // Top of email
    agenda: () => buildAgendaSection(agenda),
    weather: () => buildWeatherSection(briefs),
    // Executive Summary / TODAY
    execSummary: () => section('Executive Summary', 'Today', buildSummaryBody(summary)),
    // Post Content
    videoPosts: () => section('Post Content', 'Video Remix', buildVideoPostRow(videoItems?.remix, 'Remix', videoPublishCtx?.x) || noDataBlock(videoStatus?.remix || 'Video Remix is enabled, but no fresh completed video was ready when this email rendered.')),
    videoPromo: () => section('Post Content', 'Video Promo', buildVideoPostRow(videoItems?.promo, 'Promo') || noDataBlock(videoStatus?.promo || 'Video Promo is enabled, but no fresh completed video was ready when this email rendered.')),
    // Market Signals
    humanBrief: () => section('Market Signals', 'Brief', sPart('humanBrief')),
    opportunities: () => section('Market Signals', 'Post Opportunities', sPart('opportunities')),
    suggestedReplies: () => section('Market Signals', 'Suggested Replies', sPart('suggestedReplies') || noDataBlock('Suggested Replies is enabled, but no drafted replies were found in the current Market Signals data yet. Run Generate & Send after Market Insights has fresh opportunities or reply targets.')),
    signals: () => section('Market Signals', 'Signals', sPart('signals')),
    pressCoverage: () => section('Market Signals', 'Press Coverage', sPart('pressCoverage') || noDataBlock('Press Coverage is enabled, but no articles were captured in the latest Scout run. Coverage only appears when a search finds a real article inside the freshness window — widen freshnessDays if launch-week pieces are being excluded.')),
    watchlistAccounts: () => section('Market Signals', 'Watchlist Accounts', sPart('watchlistAccounts')),
    suggestedPosts: () => section('Market Signals', 'Suggested Posts', sPart('suggestedPosts')),
    planPreview: () => section('Market Signals', '30-Day Plan', sPart('planPreview')),
    watchlist: () => section('Market Signals', 'Happening on X', watchlistSections),
    redditAnalysis: () => section('Market Signals', 'Happening on Reddit', redditAnalysisSections || noDataBlock('Happening on Reddit is enabled, but no Reddit analysis has been saved for this client yet. Run Generate & Send with Reddit enabled in Market Insights so the Reddit analyzer can write this section.')),
    xMarketTalk: () => section('Market Signals', 'Market Talk on X', xMarketTalkSections || noDataBlock(xMarketTalkEmptyCopy())),
    instagramAnalysis: () => section('Market Signals', 'Happening on Instagram', instagramAnalysisSections || noDataBlock('Happening on Instagram is enabled, but no Instagram analysis has been saved for this client yet. Run Generate & Send with Instagram enabled in Market Insights so the Instagram analyzer can write this section.')),
    opportunitySignals: () => section('Market Signals', 'Opportunity Signals', opportunitySignalsSections || noDataBlock('Opportunity Signals is enabled, but no opportunities have been found yet. Refresh Market Signals with Opportunity Signals enabled so the scan can write this section.')),
    followerPosts: () => section('Market Signals', 'Follower Posts', buildFollowerPostsSection(briefs)),
    // Creative
    creativeBrief: () => section('Creative', 'Creative Brief', buildCreativeBriefSection(creative)),
    // Web Performance
    ga4Traffic: () => section('Google Analytics', 'Traffic', ga4TrafficInner),
    topPages: () => section('Analytics', 'Top Pages', topPagesTable),
    trafficSources: () => section('Analytics', 'Sources', sourcesTable),
    keyEvents: () => section('Analytics', 'Key Events', keyEventsInner),
    homepage: () => section('Engagement', 'Homepage', buildHomepageAnalyticsSection(homepage)),
    // Platform
    platformOverview: () => section('Platform', 'Overview', platformOverviewCells),
    signups: () => section('Firebase', 'New Sign-ups', signupsTable),
    dashboards: () => section('Firebase', 'Dashboards', dashboardsTable),
    pipeline: () => section('Firebase', 'Pipeline Status', pipelineInner),
    // Deployments
    deployments: () => section('Vercel', 'Deployments', deploymentsInner),
    runtimeErrors: () => section('Vercel', 'Runtime Errors', errorInner),
  };
  const ord = Array.isArray(order) && order.length ? order : Object.keys(RENDER);
  const orderIdx = (k) => { const i = ord.indexOf(k); return i === -1 ? 999 : i; };
  // Render a group's keys (each its own section) in saved order, gated by include[key].
  const renderGroup = (keys) => [...keys]
    .sort((a, b) => orderIdx(a) - orderIdx(b))
    .filter((k) => include[k] !== false && RENDER[k])
    .map((k) => RENDER[k]())
    .join('');

  const topSections = renderGroup(['agenda', 'weather']);
  const todaySection = renderGroup(['execSummary']);
  const postContentSection = renderGroup(['videoPosts', 'videoPromo']);
  // ⚠️ Hardcoded group membership — a key in INCLUDE_KEYS + RENDER still renders
  // NOTHING until it is listed here. This is the third hardcoded list a new
  // digest section has to be added to (INCLUDE_KEYS, the AdminEmailModals
  // toggle rows, and this group).
  const marketSignalsSection = renderGroup(['humanBrief', 'opportunities', 'suggestedReplies', 'signals', 'pressCoverage', 'watchlistAccounts', 'suggestedPosts', 'planPreview', 'watchlist', 'redditAnalysis', 'instagramAnalysis', 'xMarketTalk', 'opportunitySignals', 'followerPosts']);
  const creativeSection = renderGroup(['creativeBrief']);
  const webPerfSection = renderGroup(['ga4Traffic', 'topPages', 'trafficSources', 'keyEvents', 'homepage']);
  const platformSection = renderGroup(['platformOverview', 'signups', 'dashboards', 'pipeline']);
  const opsSection = renderGroup(['deployments', 'runtimeErrors']);
  const freshnessTokenText = String(freshnessToken || '').trim();
  const freshnessSection = freshnessTokenText
    ? dSection('Verification', 'Freshness Token', `<div style="background:${DT.card};border:1px solid ${DT.line};border-radius:14px;padding:16px 18px;font-family:${DT.fMono};font-size:12px;line-height:1.5;color:${DT.ink};word-break:break-word;">${escapeHtml(freshnessTokenText)}</div>`)
    : '';

  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>HITLOOP Daily Digest</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
body{margin:0;padding:0;background:${DT.bg};}
a{text-decoration:none;}
@media only screen and (max-width:600px){
  .container{padding:24px 16px !important;}
  .hero-title{font-size:42px !important;}
  .sec-title{font-size:26px !important;}
  .cta-btn{display:block !important;width:100% !important;margin:0 0 10px 0 !important;box-sizing:border-box !important;}
  .vp-col-media,.vp-col-text{display:block !important;width:100% !important;padding-left:0 !important;}
  .vp-col-media{margin-bottom:10px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${DT.bg};-webkit-font-smoothing:antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${DT.bg};">
    <tr><td align="center" style="padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;width:100%;table-layout:fixed;">
        <tr><td class="container" style="padding:40px 32px;">

          <!-- Hero -->
          <div style="padding-bottom:6px;">
            ${dKicker('HitLoop.agency &middot; Daily Digest')}
            <div class="hero-title" style="font-family:${DT.fDisp};font-weight:900;font-size:72px;font-size:clamp(34px,11.2vw,84px);line-height:.9;letter-spacing:-.04em;text-transform:uppercase;color:${DT.ink};margin:6px 0 16px;">Stand Up</div>
            <div style="font-family:${DT.fMono};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};">${dateStr}</div>
          </div>

          <!-- Top CTA row (Brief + Contact Your Human) -->
          ${ctaRow}

          <!-- Top of email (agenda / weather, in saved order) -->
          ${topSections}

          <!-- Executive Summary (TODAY), under weather -->
          ${todaySection}

          <!-- Post Content (Video Remix + Video Promo) — own section -->
          ${postContentSection}

          <!-- ── One headed section per brief (STAND UP) ── -->
          ${marketSignalsSection}
          ${creativeSection}
          ${webPerfSection}
          ${platformSection}
          ${opsSection}
          ${freshnessSection}

          <!-- Bottom CTA row (Brief + Contact Your Human) -->
          ${ctaRow ? `<div style="border-top:1px solid ${DT.line};padding-top:28px;margin-top:32px;">${ctaRow}</div>` : ''}

          <!-- Footer -->
          <div style="border-top:1.5px solid ${DT.line};padding-top:22px;margin-top:32px;">
            <div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;color:${DT.light};margin-bottom:10px;">Generated ${new Date(timestamp).toLocaleTimeString('en-US')}</div>
            ${freshnessTokenText ? `<div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.04em;color:${DT.light};margin-bottom:10px;">Freshness token ${escapeHtml(freshnessTokenText)}</div>` : ''}
            <div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.06em;">
              <a href="${escapeHtml(briefLinkUrl)}" style="color:${DT.accent};">Executive Brief</a> &nbsp;&middot;&nbsp;
              ${showContact ? `<a href="${contactHref}" style="color:${DT.accent};">Contact Your Human</a> &nbsp;&middot;&nbsp;` : ''}
              <a href="https://vercel.com/baiees-projects/port-2026" style="color:${DT.accent};">Vercel</a> &nbsp;&middot;&nbsp;
              <a href="https://console.firebase.google.com/project/human-in-the-loop-a1a19" style="color:${DT.accent};">Firebase</a> &nbsp;&middot;&nbsp;
              <a href="https://analytics.google.com" style="color:${DT.accent};">GA4</a>
            </div>
          </div>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  // Strip template-literal indentation — pure whitespace to email clients, but
  // ~10KB on a full email, and every KB counts against Gmail's ~102KB clip.
  return emailHtml.replace(/\n[ \t]+/g, '\n');
}

// ── Placeholder data (template preview) ───────────────────────────────────────
// Renders the full email layout with representative sample data and NO live API
// calls (GA4 / Vercel / Calendar / Firebase / LLM). Lets an admin review and
// edit the layout + section structure without generating a real digest.
export function buildPlaceholderData(timestamp) {
  const DAY = 24 * 60 * 60 * 1000;
  const iso = (off = 0) => new Date(timestamp + off).toISOString();
  const mkDay = (off, isToday, events) => {
    const d = new Date(timestamp + off * DAY);
    return {
      weekday: d.toLocaleDateString('en-US', { weekday: 'short' }),
      dateLabel: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      isToday,
      events,
    };
  };
  return {
    firebase: {
      totalUsers: 128,
      newUsers: 3,
      newUsersList: [
        { email: 'sample.user@example.com', website: 'example.com', createdAt: iso() },
        { email: 'placeholder@example.com', website: null, createdAt: iso(-3600000) },
      ],
      totalClients: 14,
      totalRuns: 320,
      recentRuns: 2,
      recentRunsList: [
        { id: 'sample-run-1', status: 'succeeded', website: 'example.com', createdAt: iso(-1800000) },
        { id: 'sample-run-2', status: 'queued', website: 'placeholder.io', createdAt: iso(-5400000) },
      ],
      statusCounts: { succeeded: 280, failed: 12, queued: 4 },
    },
    vercel: {
      deployments: [{ state: 'READY', url: 'sample.vercel.app', commit: 'feat: sample deployment (placeholder)', created: iso(-2700000) }],
      errorLogs: [],
      totalDeployments: 1,
    },
    ga4: {
      overview: { sessions: 240, totalUsers: 180, newUsers: 90, pageViews: 760, avgSessionDuration: 95, bounceRate: 42, engagedSessions: 150 },
      topPages: [
        { path: '/ (placeholder)', views: 120, users: 80 },
        { path: '/work (placeholder)', views: 64, users: 41 },
      ],
      trafficSources: [
        { source: 'google', medium: 'organic', sessions: 140, users: 110 },
        { source: 'direct', medium: '(none)', sessions: 60, users: 48 },
      ],
      events: { sign_up: 3, dashboard_created: 2, tile_opened: 18 },
      error: null,
    },
    agenda: {
      events: [{ summary: 'Sample standup', location: '', allDay: false, timeLabel: '9:00 AM' }],
      days: [
        mkDay(0, true, [{ summary: 'Sample standup', timeLabel: '9:00 AM', location: '', allDay: false }, { summary: 'Sample client call', timeLabel: '1:30 PM', location: 'Zoom', allDay: false }]),
        mkDay(1, false, [{ summary: 'Sample review', timeLabel: '2:00 PM', location: '', allDay: false }]),
        mkDay(2, false, []),
      ],
      tomorrowSummary: 'Sample — 1 event. First up — “Sample review” at 2:00 PM.',
      error: null,
    },
    homepage: {
      totalEvents: 42,
      byEventName: [{ name: 'homepage_cta_click', count: 12 }, { name: 'homepage_scroll_depth', count: 18 }],
      byInteractionType: [{ name: 'cta click', count: 12 }, { name: 'scroll', count: 18 }],
      topTargets: [{ name: 'Get Started (homepage_cta_click)', count: 9 }, { name: 'View Work (homepage_button_click)', count: 5 }],
      outboundLinks: [{ name: 'https://example.com (placeholder)', count: 4 }],
      scrollDepths: [{ name: '50%', count: 20 }, { name: '75%', count: 14 }],
      webVitals: [{ name: 'LCP', count: 30, average: 2100, needsImprovement: 2, poor: 0 }],
      error: null,
    },
    summary: {
      paragraph: 'This is placeholder executive-summary text. When you run the digest, an AI-written recap of the day’s sign-ups, traffic, deployments, and strategic brief will appear here in this slot.',
      lead: 'Claim the “Creative Systems Architect” positioning before competitors cement it — ship a short-form piece today.',
      callouts: [
        { category: 'Platform', headline: '52 users · 1 new signup', line: 'Three dashboards created in the last 24h; momentum is steady.' },
        { category: 'Calendar', headline: 'Asa · 9 AM class', line: 'Creative movement class this morning — light operating day otherwise.' },
        { category: 'Traffic', headline: '29 sessions · 59% bounce', line: 'Modest day; /dashboard is the strongest landing with high CTA engagement.' },
        { category: 'Strategy', headline: 'Stake the narrative', line: 'Use @0xCharlota’s “feel not ship” framing as the tension your system resolves.' },
      ],
    },
    creative: {
      clientName: 'Sample Client',
      summary: 'Placeholder Creative Brief — when the Creative Brief toggle is on and the client has a run brief, its cover summary is attached here, with a hero mockup above it. This is the same onboarding deliverable shown on the Creative Brief card.',
      generatedAt: iso(),
      image: null,
    },
    // One placeholder brief carrying only a watchlist-analysis snapshot, so the
    // "Happening on X" block renders in the template preview. The strategic-brief
    // block stays empty (no opportunities/KOLs/etc.) on purpose.
    briefs: [{
      clientName: 'Sample Client',
      intel: {
        weather: {
          place: 'Austin, TX',
          today: { name: 'Today', short: 'Sunny', temp: 92, unit: 'F', wind: '8 mph' },
          threeDayLine: 'Sun 94° · Mon 90° · Tue 88°',
        },
        opportunities: [
          { topic: 'Anthropic “stop prompting agents” thread', angle: 'Live now — reply within hours to claim the systems-thinking positioning before competitors do.', windowHours: 3, suggestedReply: 'Exactly — you shouldn’t prompt your brand, you build the system that runs it. That’s the whole loop we ship at HITLOOP.', url: 'https://x.com/anthropic/status/1' },
          { topic: '@0xCharlota Figma Make thread', angle: 'Genuine systems-thinking reply to her Figma thread — no pitch, just infrastructure talk.', windowHours: 96, suggestedReply: '“engineered, not designed” is the right frame. The missing piece is the contract between brief → output → next cycle.', url: 'https://x.com/0xCharlota/status/2' },
        ],
        watchlist: [
          { handle: 'sample_handle', found: true, activity: [{ text: 'Just shipped a brand manual template built in Framer — feel, not ship.', url: 'https://x.com/sample_handle/status/1' }] },
          { handle: 'another_voice', found: true, activity: [{ text: 'Hot take: model selection is becoming a checkbox, not a differentiator.', url: 'https://x.com/another_voice/status/2' }] },
        ],
        watchlistAnalysis: JSON.stringify({
          overview: 'Placeholder watchlist read — @sample_handle is shipping launch teasers while @another_voice drives the category conversation. Real overview text fills in when you run Pull timelines in the dashboard.',
          priorityAction: 'Placeholder action — reply to @sample_handle’s launch thread within the hour to ride the engagement window.',
          handles: [
            { handle: 'sample_handle', posting: 'Posting launch teasers and behind-the-scenes clips; high reply volume.', talkedAbout: 'Mentioned as the one to watch in the category this week.' },
            { handle: 'another_voice', posting: 'Sharing market commentary and contrarian takes.', talkedAbout: 'Quoted across several threads debating the new direction.' },
          ],
          spotlight: { handle: 'sample_handle', why: 'Placeholder spotlight — biggest engagement spike of the tracked set; their launch thread is the conversation to enter.' },
        }),
        redditAnalysis: JSON.stringify({
          overview: 'Placeholder Reddit read — indexed recommendation threads are clustering around trust, setup friction, and vendor comparisons. Real text fills in after the Reddit analyzer runs over Market Insights redditSignals.',
          priorityAction: 'Placeholder action — join the highest-intent recommendation thread with a useful non-pitch answer and link only if the thread asks for examples.',
          threads: [
            { title: 'Looking for tools that remove manual content planning', subreddit: 'SaaS', summary: 'Buyers are asking for workflow proof, not generic AI claims.', url: 'https://www.reddit.com/r/SaaS/comments/sample' },
            { title: 'How are teams keeping brand voice consistent?', subreddit: 'marketing', summary: 'The conversation is about process reliability and review loops.', url: 'https://www.reddit.com/r/marketing/comments/sample' },
          ],
          spotlight: { subreddit: 'SaaS', why: 'Best participation fit in the sample set because the thread is problem-led and close to purchase research.', url: 'https://www.reddit.com/r/SaaS/comments/sample' },
        }),
      },
    }],
  };
}
