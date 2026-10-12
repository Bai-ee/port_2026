// Telegram command center — briefing formatters (track B). Pure: data in,
// Telegram-HTML strings out (parse_mode HTML). No I/O, no clock (now injected).
//
// Email parity: reply suggestions come ONLY from a fresh reply-targets recipe
// (same 26h rule as the email); "Happening on X" comes from the watchlist
// analysis. Email sections deliberately skipped here: KOL rows, web/GA stats,
// agenda/weather, signups, video promo, and the platform-signal arrays (the
// analyzer excerpts in "More detail" stand in for them).

import { isFreshWithin } from '../email-digest/render.js';
import { readySummary } from './suggestions.js';

export const TELEGRAM_MAX = 4096;
export const DASHBOARD_URL = 'https://hitloop.agency/dashboard';
const REPLY_TARGET_MAX_AGE_MS = 26 * 60 * 60 * 1000;
const SECTION_ITEM_CAP = 8;

// ---- text helpers -----------------------------------------------------------

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const esc = escapeHtml;

const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
function excerpt(s, max = 140) {
  const t = flat(s);
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
const bold = (s) => `<b>${esc(s)}</b>`;

function safeUrl(u) {
  const s = String(u ?? '').trim();
  return /^https?:\/\/[^\s<>"]+$/i.test(s) ? s : '';
}
function link(url, label = 'link') {
  const u = safeUrl(url);
  return u ? `<a href="${esc(u).replace(/"/g, '&quot;')}">${esc(label)}</a>` : '';
}

/** Cut html to <= max chars without splitting an entity/tag, then close open tags. */
export function capHtml(html, max = TELEGRAM_MAX) {
  const s = String(html ?? '');
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 70);
  const nl = cut.lastIndexOf('\n');
  if (nl > cut.length * 0.5) cut = cut.slice(0, nl);
  cut = cut.replace(/&[#a-z0-9]*$/i, '');
  if (cut.lastIndexOf('<') > cut.lastIndexOf('>')) cut = cut.slice(0, cut.lastIndexOf('<'));
  const stack = [];
  for (const m of cut.matchAll(/<(\/?)([a-z]+)[^>]*>/gi)) {
    const name = m[2].toLowerCase();
    if (m[1]) { const i = stack.lastIndexOf(name); if (i >= 0) stack.splice(i); } else stack.push(name);
  }
  return `${cut}…${stack.reverse().map((t) => `</${t}>`).join('')}`;
}

/** Header + item lines; items beyond the budget collapse into "+N more". */
function section(header, lines, { max = TELEGRAM_MAX, more = 'in HITLOOP' } = {}) {
  const budget = max - 80;
  let out = header;
  let shown = 0;
  for (const line of lines) {
    if (out.length + line.length + 1 > budget) break;
    out += `\n${line}`;
    shown += 1;
  }
  if (shown < lines.length) out += `\n<i>+${lines.length - shown} more ${more}</i>`;
  return capHtml(out, max);
}

// ---- time helpers -------------------------------------------------------------

const nowMsOf = (now) => {
  const v = typeof now === 'function' ? now() : now;
  if (v instanceof Date) return v.getTime();
  return Number.isFinite(v) ? v : Date.now();
};

/** "Tue, Oct 14, 3:30 PM CDT" in tz. DST-safe (Intl). '' for invalid input. */
export function localTime(iso, tz = 'America/Chicago') {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date(ms));
  } catch {
    return localTime(ms, 'America/Chicago');
  }
}
function clockTime(iso, tz) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
  } catch {
    return '';
  }
}
function dayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
function ageText(hours) {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** {text, stale, ageHours}. Reading never refreshes anything; say so when stale. */
export function freshnessLabel(iso, now, { staleAfterHours = 36, label = 'Brief' } = {}) {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso || '');
  if (!Number.isFinite(ms)) return { text: `No ${label.toLowerCase()} yet — reading never starts a refresh`, stale: true, ageHours: null };
  const ageHours = Math.max(0, (nowMsOf(now) - ms) / 3_600_000);
  if (ageHours > staleAfterHours) {
    return { text: `⚠ stale: last refreshed ${ageText(ageHours)} ago — reading never starts a refresh`, stale: true, ageHours };
  }
  return { text: `${label} updated ${ageText(ageHours)} ago`, stale: false, ageHours };
}

// ---- recipe parsing (local copy of render.js parseRecipeAnalysis; not exported there) ----

export function parseRecipeAnalysis(text) {
  if (!text || typeof text !== 'string') return { data: null, prose: '' };
  const start = text.indexOf('{');
  if (start === -1) return { data: null, prose: text.trim() };
  let depth = 0, end = -1, inStr = false, escp = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (escp) { escp = false; continue; }
    if (c === '\\' && inStr) { escp = true; continue; }
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
const cleanProse = (s) => String(s ?? '').replace(/^```[a-z]*\s*/i, '').replace(/```\s*$/, '').trim();

// ---- status labels ------------------------------------------------------------

const STATUS_LABEL = {
  draft: 'Draft', awaiting_approval: 'Awaiting approval', approved: 'Approved', scheduled: 'Scheduled',
  queued: 'Scheduled', posting: 'Posting now', failed: 'Failed', needs_review: 'Needs review',
  expired: 'Expired', rejected: 'Rejected', manual: 'Posting manually',
};
export function statusLabel(p) {
  if (!p) return '';
  if (p.proposed) return 'Proposed (not approved)';
  if (p.status === 'posted') {
    if (p.deliveryMode === 'manual' || p.deliveryVerified === false) return 'Posted (you reported)';
    return p.twitterId ? 'Posted (verified)' : 'Posted';
  }
  return STATUS_LABEL[p.status] || String(p.status || '');
}

const arr = (v) => (Array.isArray(v) ? v : []);
const text = (v) => (typeof v === 'string' ? v.trim() : '');

// ---- What's happening? ----------------------------------------------------------

function deltaText(delta) {
  if (typeof delta === 'string') return flat(delta);
  if (delta && typeof delta === 'object') return flat(delta.summary || delta.text || delta.headline || '');
  return '';
}

function queueCounts(queue = {}) {
  const n = (k) => arr(queue[k]).length;
  return {
    needsReview: n('needsReview'), awaitingApproval: n('awaitingApproval'), drafts: n('drafts'), failed: n('failed'), manual: n('manual'),
  };
}

function buildOverview(b, nowMs, tz) {
  const intel = b?.intel;
  const fresh = freshnessLabel(b?.freshness?.briefAt || intel?.generatedAt, nowMs);
  const head = text(intel?.headline);
  const lines = [head ? bold(head) : '<b>Nothing in the latest brief.</b>'];
  const bullets = [];
  const d = deltaText(intel?.delta);
  if (d) bullets.push(excerpt(d, 160));
  const n0 = arr(intel?.narratives).find((n) => text(n?.trend));
  if (n0) bullets.push(`Market: ${excerpt(n0.trend, 120)}`);
  const o0 = arr(intel?.opportunities).find((o) => text(o?.topic));
  if (o0) bullets.push(`Opportunity: ${excerpt(o0.topic, 120)}`);
  const c = queueCounts(b?.queue);
  const waiting = c.needsReview + c.awaitingApproval + c.drafts;
  if (waiting) bullets.push(`${waiting} post${waiting === 1 ? '' : 's'} waiting on you`);
  for (const bl of bullets.slice(0, 3)) lines.push(`• ${esc(bl)}`);
  const ready = arr(b?.suggestions).filter((x) => x && (x.state === undefined || x.state === 'open'));
  if (ready.length) lines.push(`• ${esc(readySummary(ready))}`);
  lines.push('');
  lines.push(`<i>${esc(fresh.text)}</i>`);
  if (b?.freshness?.scanAt) {
    lines.push(`<i>${esc(freshnessLabel(b.freshness.scanAt, nowMs, { label: 'Scan' }).text)}</i>`);
  }
  return capHtml(lines.join('\n'));
}

function buildInsights(b) {
  const intel = b?.intel || {};
  const lines = [];
  const hb = text(intel.humanBrief);
  if (hb) lines.push(esc(excerpt(hb, 500)), '');
  const narratives = arr(intel.narratives).filter((n) => text(n?.trend) || text(n?.detail));
  const competitors = arr(intel.competitors).filter((c) => text(c?.name) || text(c?.finding));
  const opps = arr(intel.opportunities).filter((o) => text(o?.topic) || text(o?.angle));
  if (narratives.length) {
    lines.push(bold('Market insights'));
    for (const n of narratives.slice(0, SECTION_ITEM_CAP)) {
      lines.push(`• ${esc(excerpt(n.trend, 120))}${n.detail ? ` — ${esc(excerpt(n.detail, 200))}` : ''}${n.relevance ? ` <i>(${esc(excerpt(n.relevance, 80))})</i>` : ''} ${link(n.url, 'source')}`.trim());
    }
  }
  if (competitors.length) {
    lines.push('', bold('Competitors'));
    for (const c of competitors.slice(0, SECTION_ITEM_CAP)) {
      lines.push(`• ${bold(excerpt(c.name, 80))}${c.finding ? ` — ${esc(excerpt(c.finding, 200))}` : ''}${c.impact ? ` <i>[${esc(excerpt(c.impact, 40))}]</i>` : ''} ${link(c.url, 'source')}`.trim());
    }
  }
  if (opps.length) {
    lines.push('', bold('Opportunities'));
    for (const o of opps.slice(0, SECTION_ITEM_CAP)) {
      const meta = [o.priority ? `${o.priority} priority` : '', Number.isFinite(o.windowHours) ? `${o.windowHours}h window` : ''].filter(Boolean).join(', ');
      lines.push(`• ${bold(excerpt(o.topic, 120))}${o.angle ? ` — ${esc(excerpt(o.angle, 200))}` : ''}${meta ? ` <i>(${esc(meta)})</i>` : ''} ${link(o.url, 'source')}`.trim());
    }
  }
  if (!narratives.length && !competitors.length && !opps.length && !hb) {
    return '<b>Market insights</b>\nNothing in the latest brief.';
  }
  return section(lines[0], lines.slice(1));
}

function replyRecipeOf(intel) {
  return arr(intel?.digestRecipes).find((r) => r?.recipeId === 'reply-targets') || null;
}
const recipeStamp = (r) => r?.generatedAt || r?.updatedAt || r?.completedAt || r?.createdAt || r?.inputGeneratedAt || null;

function buildConversations(b, nowMs, tz) {
  const intel = b?.intel || {};
  const lines = [bold('Conversations to join')];

  // 1. Current scan candidates (raw, live conversations).
  const qt = b?.quoteTargets || {};
  const scanMs = Date.parse(qt.generatedAt || '');
  const cands = arr(qt.candidates).filter((c) => c && (text(c.text) || text(c.url)));
  const ordered = [...cands].sort((x, y) => (Number(!!y.windowOpen) - Number(!!x.windowOpen)) || ((y.score ?? 0) - (x.score ?? 0)));
  lines.push('', bold('Current (from the latest scan)'));
  if (!ordered.length) {
    lines.push('No conversations in the latest scan.');
  } else {
    lines.push(`<i>${esc(freshnessLabel(qt.generatedAt, nowMs, { label: 'Scan' }).text)}</i>`);
    for (const c of ordered.slice(0, SECTION_ITEM_CAP)) {
      const age = Number.isFinite(c.ageHours) ? c.ageHours + (Number.isFinite(scanMs) ? Math.max(0, nowMs - scanMs) / 3_600_000 : 0) : null;
      const tag = `current${age != null ? ` (${ageText(age)} old, ${c.windowOpen ? 'window open' : 'window closed'})` : c.windowOpen ? ' (window open)' : ''}`;
      lines.push(`• ${bold(excerpt(c.author, 60) || 'unknown')} <i>${esc(tag)}</i>${c.text ? `\n  “${esc(excerpt(c.text, 200))}”` : ''}${arr(c.reasons)[0] ? `\n  Why: ${esc(excerpt(arr(c.reasons)[0], 120))}` : ''} ${link(c.url, 'open')}`.trimEnd());
    }
  }

  // 2. Suggested replies — only a FRESH reply-targets recipe, exactly as the email does.
  const recipe = replyRecipeOf(intel);
  lines.push('', bold('Suggested replies (from the last brief)'));
  if (!recipe) {
    lines.push('No suggested replies in the latest brief.');
  } else if (!(recipe.ok && recipe.analysis && isFreshWithin(recipeStamp(recipe), REPLY_TARGET_MAX_AGE_MS, nowMs))) {
    lines.push(`Latest reply-targets run is stale (${esc(localTime(recipeStamp(recipe), tz) || 'unknown')}) — not shown.`);
  } else {
    const { data, prose } = parseRecipeAnalysis(recipe.analysis);
    const targets = arr(data?.replyTargets).filter((t) => t?.suggestedReply).slice(0, 5);
    if (targets.length) {
      for (const t of targets) {
        lines.push(`• ${bold(excerpt(t.author, 60) || 'unknown')} ${link(t.url, 'open')}${t.text ? `\n  “${esc(excerpt(t.text, 160))}”` : ''}${t.why ? `\n  Why: ${esc(excerpt(t.why, 140))}` : ''}\n  Draft: ${esc(excerpt(t.suggestedReply, 280))}`);
      }
    } else {
      const raw = cleanProse(prose || (data ? '' : recipe.analysis));
      lines.push(raw ? esc(excerpt(raw, 600)) : 'No suggested replies in the latest brief.');
    }
  }

  // 3. Happening on X (watchlist analysis) — from the last brief.
  lines.push('', bold('Happening on X (from the last brief)'));
  const { data: wd, prose: wp } = parseRecipeAnalysis(text(intel.watchlistAnalysis));
  if (!wd && !wp) {
    lines.push('Nothing in the latest brief.');
  } else if (wd) {
    if (wd.overview) lines.push(esc(excerpt(wd.overview, 300)));
    if (wd.priorityAction) lines.push(`Action: ${esc(excerpt(wd.priorityAction, 200))}`);
    for (const h of arr(wd.handles).slice(0, 4)) {
      const hh = String(h?.handle || '').replace(/^@+/, '');
      if (!hh) continue;
      lines.push(`• ${bold(`@${hh}`)}${h.posting ? ` — ${esc(excerpt(h.posting, 200))}` : ''}${h.talkedAbout ? `\n  Talked about: ${esc(excerpt(h.talkedAbout, 160))}` : ''}`);
    }
    if (wd.spotlight?.why) lines.push(`Spotlight${wd.spotlight.handle ? ` @${esc(String(wd.spotlight.handle).replace(/^@+/, ''))}` : ''}: ${esc(excerpt(wd.spotlight.why, 240))}`);
  } else {
    lines.push(esc(excerpt(cleanProse(wp), 500)));
  }
  return section(lines[0], lines.slice(1), { more: 'in HITLOOP' });
}

function postLine(p, tz) {
  const when = localTime(p.scheduledAt, tz);
  return `• ${esc(statusLabel(p))}${when ? ` — ${esc(when)}` : ''}: ${esc(excerpt(p.content || p.title, 90))}`;
}

function buildReview(b, tz) {
  const q = b?.queue || {};
  const c = queueCounts(q);
  const parts = [
    c.needsReview && `${c.needsReview} need review`,
    c.awaitingApproval && `${c.awaitingApproval} awaiting approval`,
    c.drafts && `${c.drafts} draft${c.drafts === 1 ? '' : 's'}`,
    c.failed && `${c.failed} failed/expired`,
    c.manual && `${c.manual} posting manually`,
  ].filter(Boolean);
  const lines = [bold('Needs review')];
  if (!parts.length) { lines.push('Nothing waiting for review.'); return capHtml(lines.join('\n')); }
  lines.push(esc(parts.join(' · ')));
  const top = [...arr(q.needsReview), ...arr(q.awaitingApproval), ...arr(q.failed), ...arr(q.manual), ...arr(q.drafts)].slice(0, 6);
  return section(lines.join('\n'), top.map((p) => postLine(p, tz)));
}

function analysisLines(label, raw) {
  const { data, prose } = parseRecipeAnalysis(text(raw));
  if (!data && !prose) return [];
  const out = [bold(label)];
  if (data) {
    if (data.overview) out.push(esc(excerpt(data.overview, 260)));
    if (data.priorityAction) out.push(`Action: ${esc(excerpt(data.priorityAction, 180))}`);
    for (const o of arr(data.opportunities).slice(0, 3)) {
      const who = [o.person, o.company].filter(Boolean).join(' / ');
      out.push(`• ${who ? `${bold(excerpt(who, 60))} ` : ''}${o.currentTrigger ? `“${esc(excerpt(o.currentTrigger, 160))}” ` : ''}${o.possibleResponse ? `Angle: ${esc(excerpt(o.possibleResponse, 140))} ` : ''}${link(o.url, 'source')}`.trim());
    }
  } else {
    out.push(esc(excerpt(cleanProse(prose), 300)));
  }
  return out;
}

function buildDetail(b) {
  const intel = b?.intel || {};
  const blocks = [
    analysisLines('Reddit', intel.redditAnalysis),
    analysisLines('Instagram', intel.instagramAnalysis),
    analysisLines('Market talk on X', intel.xMarketTalkAnalysis),
    analysisLines('Opportunity signals', intel.opportunitySignalsAnalysis),
  ].filter((x) => x.length);
  const mentions = arr(intel.brandMentions).filter((m) => text(m?.content)).slice(0, 4);
  const lines = [bold('More detail')];
  if (!blocks.length && !mentions.length) lines.push('Nothing more in the latest brief.');
  blocks.forEach((bl) => lines.push('', ...bl));
  if (mentions.length) {
    lines.push('', bold('Brand mentions'));
    for (const m of mentions) lines.push(`• ${m.author ? `${bold(excerpt(m.author, 40))} ` : ''}${m.source ? `<i>${esc(m.source)}</i> ` : ''}“${esc(excerpt(m.content, 160))}”${m.sentiment ? ` (${esc(m.sentiment)})` : ''} ${link(m.url, 'source')}`.trim());
  }
  lines.push('', `Full report: ${link(DASHBOARD_URL, 'open HITLOOP dashboard')}`);
  return section(lines[0], lines.slice(1));
}

export function formatWhatsHappening(briefing, { now, tz = 'America/Chicago' } = {}) {
  const nowMs = nowMsOf(now);
  const b = briefing || {};
  return {
    overview: buildOverview(b, nowMs, tz),
    insights: buildInsights(b),
    conversations: buildConversations(b, nowMs, tz),
    review: buildReview(b, tz),
    detail: buildDetail(b),
  };
}

// ---- Calendar views ----------------------------------------------------------------

function targetOf(calendar) {
  const a = calendar?.config?.authored;
  return a?.targetPerDay ?? a?.capPerDay ?? null;
}
const isLive = (p) => !p.proposed && p.status !== 'failed' && p.status !== 'expired' && p.status !== 'rejected';

function dayCountsText(day) {
  const posts = arr(day?.posts);
  const n = (f) => posts.filter(f).length;
  return [
    n((p) => p.status === 'posted' && !p.proposed) && `${n((p) => p.status === 'posted' && !p.proposed)} posted`,
    n((p) => (p.status === 'scheduled' || p.status === 'queued' || p.status === 'posting') && !p.proposed) && `${n((p) => (p.status === 'scheduled' || p.status === 'queued' || p.status === 'posting') && !p.proposed)} scheduled`,
    n((p) => p.status === 'manual') && `${n((p) => p.status === 'manual')} posting manually`,
    n((p) => (p.status === 'approved') && !p.proposed) && `${n((p) => p.status === 'approved' && !p.proposed)} approved`,
    n((p) => p.proposed) && `${n((p) => p.proposed)} proposed`,
    n((p) => !p.proposed && (p.status === 'draft' || p.status === 'awaiting_approval')) && `${n((p) => !p.proposed && (p.status === 'draft' || p.status === 'awaiting_approval'))} to review`,
    n((p) => p.status === 'failed' || p.status === 'needs_review') && `${n((p) => p.status === 'failed' || p.status === 'needs_review')} need attention`,
  ].filter(Boolean).join(', ');
}

export function formatToday(calendar, { now, tz = 'America/Chicago', handle, suggestions } = {}) {
  const day = arr(calendar?.week).find((d) => d.date === calendar?.today) || arr(calendar?.week)[0];
  const head = `${bold(`Today — ${day ? dayLabel(day.date) : ''}`)}${handle ? ` · @${esc(String(handle).replace(/^@+/, ''))}` : ''}`;
  if (!day) return `${head}\nNo calendar data.`;
  const posts = arr(day.posts).slice().sort((a, b) => (Date.parse(a.scheduledAt || a.proposedAt || '') || 0) - (Date.parse(b.scheduledAt || b.proposedAt || '') || 0));
  const lines = posts.map((p) => {
    const when = clockTime(p.scheduledAt || p.proposedAt, tz);
    return `• ${when ? `${esc(when)} — ` : ''}${bold(statusLabel(p))}: ${esc(excerpt(p.content || p.title, 100))}`;
  });
  const target = targetOf(calendar);
  const live = posts.filter(isLive).length;
  const foot = [];
  if (!posts.length) foot.push('Nothing planned today.');
  if (target != null && live < target) foot.push(`Gap: ${live} of ${target} planned — ${target - live} short.`);
  else if (target != null) foot.push(`${live} of ${target} planned.`);
  if (posts.some((p) => p.proposed)) foot.push('<i>Proposed times are suggestions; nothing is scheduled until you approve.</i>');
  const open = arr(suggestions).filter((x) => x && (x.state === undefined || x.state === 'open'));
  const sugg = open.length ? ['', bold('Unsaved suggestions'), ...open.slice(0, 6).map((x) => `• ${esc(x.trackLabel || x.track || 'general')}: ${esc(excerpt(x.text, 90))}`)] : [];
  return section(head, [...lines, ...foot, ...sugg]);
}

export function formatWeek(calendar, { now, tz = 'America/Chicago' } = {}) {
  const days = arr(calendar?.week);
  const target = targetOf(calendar);
  const lines = days.map((d) => {
    const live = arr(d.posts).filter(isLive).length;
    const counts = dayCountsText(d);
    const gap = target != null && live < target ? ` · ${target - live} short` : '';
    return `• ${bold(dayLabel(d.date))}${d.date === calendar?.today ? ' (today)' : ''}: ${esc(counts || 'nothing planned')}${gap}`;
  });
  if (!lines.length) return `${bold('This week')}\nNo calendar data.`;
  return section(bold('This week'), lines);
}

export function formatNextActions(briefing, calendar, { now, tz = 'America/Chicago' } = {}) {
  const nowMs = nowMsOf(now);
  const c = queueCounts(briefing?.queue);
  const lines = [];
  if (c.needsReview) lines.push(`• ${c.needsReview} post${c.needsReview === 1 ? '' : 's'} held for review`);
  if (c.failed) lines.push(`• ${c.failed} failed/expired — reschedule or reject`);
  if (c.awaitingApproval) lines.push(`• ${c.awaitingApproval} awaiting your approval`);
  if (c.manual) lines.push(`• ${c.manual} posting manually — mark posted when done`);
  if (c.drafts) lines.push(`• ${c.drafts} draft${c.drafts === 1 ? '' : 's'} to approve or revise`);
  const open = arr(briefing?.quoteTargets?.candidates).filter((x) => x?.windowOpen).length;
  if (open) lines.push(`• ${open} open conversation${open === 1 ? '' : 's'} in the latest scan`);
  const day = arr(calendar?.week).find((d) => d.date === calendar?.today);
  const target = targetOf(calendar);
  if (day && target != null) {
    const live = arr(day.posts).filter(isLive).length;
    if (live < target) lines.push(`• Today is ${target - live} post${target - live === 1 ? '' : 's'} short of the ${target}/day plan`);
  }
  const fresh = freshnessLabel(briefing?.freshness?.briefAt || briefing?.intel?.generatedAt, nowMs);
  if (fresh.stale) lines.push(`• ${fresh.text}`);
  if (!lines.length) return `${bold('Next actions')}\nNothing needs you right now.`;
  return section(bold('Next actions'), lines);
}
