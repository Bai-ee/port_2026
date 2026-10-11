import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml, capHtml, freshnessLabel, localTime, formatWhatsHappening, formatToday, formatWeek, formatNextActions, statusLabel,
} from '../briefing.js';

const NOW = Date.parse('2026-10-14T18:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

function fixtureIntel(over = {}) {
  return {
    headline: 'Headline ALPHA',
    humanBrief: 'Human brief BRAVO text',
    delta: 'Delta CHARLIE changed',
    generatedAt: hoursAgo(5),
    opportunities: [{ topic: 'Opp DELTA', angle: 'Angle ECHO', priority: 'high', windowHours: 12, suggestedReply: 'SCOUT-REPLY-MUST-NOT-APPEAR', url: 'https://example.com/opp' }],
    competitors: [{ name: 'Comp FOXTROT', finding: 'Finding GOLF', impact: 'medium', url: 'https://example.com/comp' }],
    narratives: [{ trend: 'Trend HOTEL', detail: 'Detail INDIA', relevance: 'Rel JULIET', url: 'https://example.com/nar' }],
    brandMentions: [{ source: 'reddit', author: 'kilo', content: 'Mention LIMA', sentiment: 'positive', url: 'https://example.com/m' }],
    redditAnalysis: JSON.stringify({ overview: 'Reddit overview MIKE', priorityAction: 'Reddit action NOVEMBER' }),
    instagramAnalysis: JSON.stringify({ overview: 'IG overview OSCAR' }),
    xMarketTalkAnalysis: 'plain prose PAPA',
    opportunitySignalsAnalysis: JSON.stringify({ opportunities: [{ person: 'Quebec', company: 'Romeo', currentTrigger: 'Trigger SIERRA', possibleResponse: 'Resp TANGO', url: 'https://example.com/os' }] }),
    watchlistAnalysis: JSON.stringify({ overview: 'Watch overview UNIFORM', priorityAction: 'Watch action VICTOR', handles: [{ handle: '@whiskey', posting: 'Posting XRAY', talkedAbout: 'Talked YANKEE' }], spotlight: { handle: 'zulu', why: 'Why ZEBRA' } }),
    digestRecipes: [{
      ok: true, recipeId: 'reply-targets', generatedAt: hoursAgo(3),
      analysis: JSON.stringify({ replyTargets: [{ author: '@alice', url: 'https://x.com/alice/status/1', text: 'Original AAA', why: 'Because BBB', suggestedReply: 'Draft reply CCC' }] }),
    }],
    ...over,
  };
}
const q = (over = {}) => ({ needsReview: [], awaitingApproval: [], drafts: [], failed: [], manual: [], ...over });
function fixtureBriefing(over = {}) {
  return {
    intel: fixtureIntel(),
    quoteTargets: {
      generatedAt: hoursAgo(2),
      candidates: [
        { id: 'c2', url: 'https://x.com/b/status/2', author: '@closed', text: 'Closed convo', ageHours: 30, windowOpen: false, score: 99 },
        { id: 'c1', url: 'https://x.com/a/status/1', author: '@open', text: 'Open convo', ageHours: 3, windowOpen: true, score: 10, reasons: ['Reason DDD'] },
      ],
    },
    queue: q({ needsReview: [{ id: 'p1', status: 'needs_review', content: 'Held post', scheduledAt: '2026-10-15T15:00:00Z' }] }),
    freshness: { briefAt: hoursAgo(5), scanAt: hoursAgo(2) },
    ...over,
  };
}

test('escapeHtml escapes hostile text', () => {
  assert.equal(escapeHtml('<script>&"'), '&lt;script&gt;&amp;"');
});

test('freshnessLabel: fresh, stale, missing', () => {
  assert.equal(freshnessLabel(hoursAgo(5), NOW).text, 'Brief updated 5h ago');
  assert.equal(freshnessLabel(hoursAgo(5), NOW).stale, false);
  const s = freshnessLabel(hoursAgo(72), NOW);
  assert.equal(s.stale, true);
  assert.equal(s.text, '⚠ stale: last refreshed 3d ago — reading never starts a refresh');
  assert.equal(freshnessLabel(null, NOW).stale, true);
  assert.equal(freshnessLabel(hoursAgo(0.25), NOW).text, 'Brief updated 15m ago');
});

test('localTime is DST-safe', () => {
  assert.match(localTime('2026-03-08T07:30:00Z', 'America/Chicago'), /1:30 AM CST/);
  assert.match(localTime('2026-03-08T08:30:00Z', 'America/Chicago'), /3:30 AM CDT/);
  assert.match(localTime('2026-11-01T07:30:00Z', 'America/Chicago'), /1:30 AM CST/);
  assert.equal(localTime('garbage', 'America/Chicago'), '');
  assert.match(localTime('2026-10-14T18:00:00Z', 'Asia/Tokyo'), /3:00 AM/);
});

test('parity: every non-empty brief field appears in the output', () => {
  const out = formatWhatsHappening(fixtureBriefing(), { now: NOW, tz: 'America/Chicago' });
  const all = Object.values(out).join('\n');
  for (const needle of [
    'Headline ALPHA', 'Human brief BRAVO', 'Delta CHARLIE', 'Opp DELTA', 'Angle ECHO', 'https://example.com/opp',
    'Comp FOXTROT', 'Finding GOLF', 'https://example.com/comp', 'Trend HOTEL', 'Detail INDIA', 'Rel JULIET', 'https://example.com/nar',
    'Mention LIMA', 'Reddit overview MIKE', 'Reddit action NOVEMBER', 'IG overview OSCAR', 'plain prose PAPA',
    'Trigger SIERRA', 'Resp TANGO', 'https://example.com/os', 'Watch overview UNIFORM', 'Watch action VICTOR', '@whiskey', 'Posting XRAY',
    'Talked YANKEE', 'Why ZEBRA', 'Original AAA', 'Because BBB', 'Draft reply CCC', 'https://x.com/alice/status/1',
    'Open convo', 'Reason DDD', 'https://x.com/a/status/1', 'Held post', 'hitloop.agency/dashboard',
  ]) assert.ok(all.includes(needle), `missing: ${needle}`);
  assert.ok(!all.includes('SCOUT-REPLY-MUST-NOT-APPEAR'), 'scout suggestedReply must not be used (email parity)');
  for (const v of Object.values(out)) assert.ok(v.length <= 4096);
});

test('overview: headline, <=3 bullets, freshness', () => {
  const { overview } = formatWhatsHappening(fixtureBriefing(), { now: NOW });
  assert.match(overview, /<b>Headline ALPHA<\/b>/);
  assert.ok((overview.match(/^• /gm) || []).length <= 3);
  assert.match(overview, /Brief updated 5h ago/);
  assert.match(overview, /Scan updated 2h ago/);
});

test('scan candidates: window-open first, labelled current with age', () => {
  const { conversations } = formatWhatsHappening(fixtureBriefing(), { now: NOW });
  assert.ok(conversations.indexOf('@open') < conversations.indexOf('@closed'));
  assert.match(conversations, /current \(5h old, window open\)/);
  assert.match(conversations, /window closed/);
  assert.match(conversations, /Suggested replies \(from the last brief\)/);
  assert.match(conversations, /Happening on X \(from the last brief\)/);
});

test('stale vs fresh labels; stale reply recipe is not shown', () => {
  const stale = fixtureBriefing({
    intel: fixtureIntel({ generatedAt: hoursAgo(72), digestRecipes: [{ ok: true, recipeId: 'reply-targets', generatedAt: hoursAgo(40), analysis: JSON.stringify({ replyTargets: [{ author: '@old', suggestedReply: 'STALE DRAFT' }] }) }] }),
    freshness: { briefAt: hoursAgo(72), scanAt: hoursAgo(50) },
  });
  const out = formatWhatsHappening(stale, { now: NOW });
  assert.match(out.overview, /⚠ stale: last refreshed 3d ago — reading never starts a refresh/);
  assert.ok(!out.conversations.includes('STALE DRAFT'));
  assert.match(out.conversations, /stale/);
});

test('empty / missing intel: honest text, nothing invented', () => {
  for (const b of [null, {}, { intel: null, quoteTargets: { candidates: [] }, queue: q(), freshness: {} }]) {
    const out = formatWhatsHappening(b, { now: NOW });
    assert.match(out.overview, /Nothing in the latest brief/);
    assert.match(out.overview, /No brief yet/);
    assert.match(out.insights, /Nothing in the latest brief/);
    assert.match(out.conversations, /No conversations in the latest scan/);
    assert.match(out.conversations, /No suggested replies/);
    assert.match(out.review, /Nothing waiting for review/);
    assert.match(out.detail, /Nothing more in the latest brief/);
    assert.ok(!/<a href/.test(out.insights + out.conversations));
  }
});

test('hostile text is escaped everywhere', () => {
  const evil = '<script>alert(1)</script> & "x"';
  const b = fixtureBriefing({
    intel: fixtureIntel({
      headline: evil,
      narratives: [{ trend: evil, detail: evil, url: 'javascript:alert(1)' }],
      opportunities: [{ topic: evil, angle: evil, url: 'https://e.com/?a=1&b=2' }],
    }),
    quoteTargets: { generatedAt: hoursAgo(1), candidates: [{ id: 'z', author: evil, text: evil, url: 'https://x.com/z', ageHours: 1, windowOpen: true }] },
    queue: q({ needsReview: [{ id: 'p', status: 'needs_review', content: evil }] }),
  });
  const all = Object.values(formatWhatsHappening(b, { now: NOW })).join('\n');
  assert.ok(!all.includes('<script>'));
  assert.ok(all.includes('&lt;script&gt;'));
  assert.ok(!all.includes('javascript:'));
  assert.ok(all.includes('href="https://e.com/?a=1&amp;b=2"'));
});

test('length caps: huge input stays <=4096 with balanced tags', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ topic: `Topic ${i} ${'x'.repeat(300)}`, angle: 'y'.repeat(900), url: `https://e.com/${i}` }));
  const b = fixtureBriefing({ intel: fixtureIntel({ opportunities: many, narratives: many.map((o) => ({ trend: o.topic, detail: o.angle, url: o.url })), humanBrief: 'h'.repeat(9000) }) });
  const out = formatWhatsHappening(b, { now: NOW });
  for (const v of Object.values(out)) {
    assert.ok(v.length <= 4096);
    const open = (v.match(/<(b|i|a)[ >]/g) || []).length;
    const close = (v.match(/<\/(b|i|a)>/g) || []).length;
    assert.equal(open, close);
  }
  const cut = capHtml(`<b>${'a&amp;'.repeat(2000)}</b>`, 4096);
  assert.ok(cut.length <= 4096 && cut.endsWith('</b>') && !/&[a-z]*$/.test(cut.replace(/<\/b>$/, '').replace(/…$/, '')));
});

const day = (date, posts = []) => ({ date, posts });
const cal = (week, today = week[0].date) => ({ today, week, tz: 'America/Chicago', config: { authored: { targetPerDay: 3, capPerDay: 4, minSpacingMin: 60 } }, unplaced: [] });

test('formatToday labels proposed / approved / scheduled / manual / posted / self-reported', () => {
  const c = cal([day('2026-10-14', [
    { id: '1', status: 'draft', proposed: true, proposedAt: '2026-10-14T15:00:00Z', content: 'Proposed one' },
    { id: '2', status: 'approved', scheduledAt: '2026-10-14T16:00:00Z', content: 'Approved one' },
    { id: '3', status: 'scheduled', scheduledAt: '2026-10-14T17:00:00Z', content: 'Scheduled one' },
    { id: '4', status: 'manual', scheduledAt: '2026-10-14T18:00:00Z', content: 'Manual one' },
    { id: '5', status: 'posted', deliveryMode: 'manual', deliveryVerified: false, postedAt: '2026-10-14T13:00:00Z', content: 'Self reported' },
    { id: '6', status: 'posted', twitterId: '99', postedAt: '2026-10-14T14:00:00Z', content: 'Verified one' },
  ])]);
  const out = formatToday(c, { now: NOW, tz: 'America/Chicago', handle: '@bai_ee' });
  for (const l of ['Proposed (not approved)', 'Approved', 'Scheduled', 'Posting manually', 'Posted (you reported)', 'Posted (verified)', '@bai_ee']) assert.ok(out.includes(l), l);
  assert.match(out, /10:00 AM/); // 15:00Z in CDT
  assert.match(out, /5 of 3 planned|of 3 planned/);
  assert.equal(statusLabel({ status: 'posted', twitterId: '1' }), 'Posted (verified)');
});

test('formatToday reports gaps vs target and handles empty day', () => {
  const out = formatToday(cal([day('2026-10-14', [{ id: '1', status: 'scheduled', scheduledAt: '2026-10-14T17:00:00Z', content: 'One' }])]), { now: NOW });
  assert.match(out, /Gap: 1 of 3 planned — 2 short/);
  assert.match(formatToday(cal([day('2026-10-14')]), { now: NOW }), /Nothing planned today/);
});

test('formatWeek spans a month boundary', () => {
  const dates = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
  const out = formatWeek(cal(dates.map((d, i) => day(d, i === 3 ? [{ id: 'n', status: 'scheduled', scheduledAt: '2026-11-01T20:00:00Z', content: 'x' }] : []))), { now: NOW });
  assert.match(out, /Oct 29/); assert.match(out, /Nov 4/); assert.match(out, /Nov 1.*1 scheduled/);
  assert.match(out, /\(today\)/);
});

test('formatNextActions lists real work and says so when idle', () => {
  const b = fixtureBriefing();
  const out = formatNextActions(b, cal([day('2026-10-14')]), { now: NOW });
  assert.match(out, /1 post held for review/);
  assert.match(out, /1 open conversation/);
  assert.match(out, /short of the 3\/day plan/);
  const idle = formatNextActions({ intel: fixtureIntel(), quoteTargets: { candidates: [] }, queue: q(), freshness: { briefAt: hoursAgo(1) } }, cal([day('2026-10-14', [1, 2, 3].map((n) => ({ id: String(n), status: 'scheduled', content: 'x' })))]), { now: NOW });
  assert.match(idle, /Nothing needs you right now/);
});
