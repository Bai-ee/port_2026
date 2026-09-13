#!/usr/bin/env node
// Render the human-readable post database from the normalized corpus.
import fs from 'node:fs';
import path from 'node:path';

const REPO = '/Users/bballi/Documents/Repos/Bballi_Portfolio';
const OUT_DIR = path.join(REPO, 'docs', 'audits');
const rows = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'seb-design-x-corpus.json'), 'utf8'));
const stats = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'seb-stats.json'), 'utf8'));
const profile = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'seb-profile.json'), 'utf8'));
const L = profile.legacy || {};

const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n+/g, ' ⏎ ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));

const own = rows.filter((r) => r.type !== 'retweet');
const withViews = rows.filter((r) => r.views != null);

function table(list, { showViews = true } = {}) {
  const head = showViews
    ? '| # | Date (CEST) | Time | Day | Type | Media | Topics | Post copy | Views | Likes | RT | Replies | ER% | Link |'
    : '| # | Date (CEST) | Time | Day | Type | Media | Topics | Post copy | Likes | RT | Replies | Link |';
  const rule = showViews
    ? '|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|'
    : '|---|---|---|---|---|---|---|---|---:|---:|---:|---|';
  const body = list.map((r, i) => {
    const copy = esc(clip(r.text, 220)) + (r.quotedAuthor ? ` **↪ QT @${r.quotedAuthor}:** _${esc(clip(r.quotedText || '', 90))}_` : '');
    return showViews
      ? `| ${i + 1} | ${r.dateLocal} | ${r.timeLocal} | ${r.weekday} | ${r.type} | ${r.media} | ${r.topics.join(', ')} | ${copy} | ${num(r.views)} | ${num(r.likes)} | ${num(r.reposts)} | ${num(r.replies)} | ${r.engagementRate ?? '—'} | [↗](${r.url}) |`
      : `| ${i + 1} | ${r.dateLocal} | ${r.timeLocal} | ${r.weekday} | ${r.type} | ${r.media} | ${r.topics.join(', ')} | ${copy} | ${num(r.likes)} | ${num(r.reposts)} | ${num(r.replies)} | [↗](${r.url}) |`;
  });
  return [head, rule, ...body].join('\n');
}

const typeStats = {};
for (const r of rows) {
  typeStats[r.type] = typeStats[r.type] || { n: 0, likes: 0, replies: 0, reposts: 0, views: 0, vn: 0 };
  const s = typeStats[r.type];
  s.n += 1; s.likes += r.likes; s.replies += r.replies; s.reposts += r.reposts;
  if (r.views != null) { s.views += r.views; s.vn += 1; }
}

const topicRows = Object.entries(stats.topicStats).sort((a, b) => b[1].avgLikes - a[1].avgLikes);
const topViews = withViews.slice().sort((a, b) => b.views - a.views);
const top60 = own.slice().sort((a, b) => b.likes - a.likes).slice(0, 60);
const bottom25 = own.slice().sort((a, b) => a.likes - b.likes).slice(0, 25);

const hourRows = stats.hourHist.filter((h) => h.n > 0);
const peakHours = hourRows.slice().sort((a, b) => b.avgLikes - a.avgLikes).slice(0, 6);

const md = `# @seb__design — X post database (${stats.firstPost.slice(0, 10)} → ${stats.lastPost.slice(0, 10)})

> Research dataset built to reverse-engineer a working small-account X growth pattern in the design/creative-services niche. Companion strategy doc: [\`docs/plans/X-STRATEGY-SEB-MODEL.md\`](../plans/X-STRATEGY-SEB-MODEL.md).
> Machine-readable siblings: [\`seb-design-x-corpus.json\`](./seb-design-x-corpus.json) · [\`seb-design-x-corpus.csv\`](./seb-design-x-corpus.csv)

## 0. Provenance & honesty notes

| Field | Value |
|---|---|
| Account | **@seb__design** — "seb-astian", id \`1914023754730274816\` |
| Bio | ${esc(L.description || '')} |
| Account created | ${L.created_at} |
| Followers / Following | **${num(L.followers_count)}** / ${num(L.friends_count)} |
| Lifetime posts | ${num(L.statuses_count)} |
| Likes given | ${num(L.favourites_count)} |
| Blue verified | ${profile.is_blue_verified ? 'yes' : 'no'} |
| CTA in bio | ${esc((L.entities?.url?.urls?.[0]?.expanded_url) || 'none')} |
| Corpus pulled | ${stats.pulledAt} |
| Posts captured | **${num(stats.posts)}** across **${stats.spanDays} days** (${stats.daysCovered} active days) |
| View counts resolved | ${num(withViews.length)} posts |

**Collection method.** Timeline pulled through the \`bird\` CLI (X web GraphQL, cookie auth — no API spend), cursor-chained to X's timeline depth limit. View counts backfilled through ScrapeCreators \`/v1/twitter/tweet\` (1 credit/post). Per repo policy ([\`X-API-AND-PROFILE-OPERATIONS.md\`](../source-of-truth/X-API-AND-PROFILE-OPERATIONS.md) §2c) **no paid X API call was made** — reads go through the cheap path only. Total spend: **153 ScrapeCreators credits ≈ \\$0.29**.

**Four limits you should know before trusting a number:**
1. **Window is 65 days, not 90.** X's profile timeline stops paginating around 800 posts; his volume is high enough that this capped us at ${stats.firstPost.slice(0, 10)}. Everything here is Jul–Sep 2026.
2. **Replies are under-sampled.** The profile timeline surfaces only ${typeStats.reply?.n ?? 0} replies. His ${num(L.favourites_count)} likes given and reply-heavy style imply the real number is far higher. Treat reply volume in this doc as a floor, not a measurement.
3. **Views exist for ${withViews.length} of ${rows.length} posts** — the top ~100 by likes plus a random control sample. View-based averages are therefore biased upward and are only safe for *comparing within* the sampled set.
4. **Likes/views are as-of pull date.** Recent posts have had less time to accumulate.

---

## 1. Cadence — what and how often

**${stats.postsPerActiveDay} posts per active day**, every day, no off days in the window.

| Type | Posts | Share | Avg likes | Avg replies | Avg reposts | Avg views (sampled) |
|---|---:|---:|---:|---:|---:|---:|
${Object.entries(typeStats).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `| \`${k}\` | ${v.n} | ${((v.n / rows.length) * 100).toFixed(1)}% | ${(v.likes / v.n).toFixed(1)} | ${(v.replies / v.n).toFixed(1)} | ${(v.reposts / v.n).toFixed(1)} | ${v.vn ? num(Math.round(v.views / v.vn)) : '—'} |`).join('\n')}

### Weekly volume (own posts, retweets excluded)

| Week of | Own posts | Total likes | Avg likes/post |
|---|---:|---:|---:|
${(() => {
  const wk = {};
  for (const r of own) {
    const d = new Date(r.utc);
    const k = new Date(d - ((d.getUTCDay() || 7) - 1) * 86400000).toISOString().slice(0, 10);
    wk[k] = wk[k] || { n: 0, likes: 0 };
    wk[k].n += 1; wk[k].likes += r.likes;
  }
  return Object.entries(wk).sort().map(([k, v]) => `| ${k} | ${v.n} | ${num(v.likes)} | ${(v.likes / v.n).toFixed(1)} |`).join('\n');
})()}

---

## 2. When he posts — hour and weekday

All times **CEST (UTC+2)** — inferred from his posting envelope and German-language artifacts in his content.

| Hour | Posts | Avg likes |
|---|---:|---:|
${hourRows.map((h) => `| ${String(h.hour).padStart(2, '0')}:00 | ${h.n} | ${h.avgLikes} |`).join('\n')}

**Peak-performance hours (by avg likes, min 20 posts):** ${peakHours.filter((h) => h.n >= 20).map((h) => `\`${String(h.hour).padStart(2, '0')}:00\` (${h.avgLikes})`).join(' · ')}

| Weekday | Posts | Total likes | Avg likes |
|---|---:|---:|---:|
${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => { const v = stats.dayHist[d]; return v ? `| ${d} | ${v.n} | ${num(v.likes)} | ${(v.likes / v.n).toFixed(1)} |` : ''; }).filter(Boolean).join('\n')}

---

## 3. What he posts about

Topics are multi-label; a post can carry several. Matched against the caption **and** the quoted post, because his quote captions average 46 characters — the subject lives in what he is quoting.

| Topic | Posts | Avg likes | Avg replies | Avg reposts |
|---|---:|---:|---:|---:|
${topicRows.map(([k, v]) => `| \`${k}\` | ${v.n} | ${v.avgLikes} | ${v.avgReplies} | ${v.avgReposts} |`).join('\n')}

### Format signals

| Signal | Value |
|---|---|
| Media mix (own posts) | ${Object.entries(stats.mediaStats).map(([k, v]) => `${k}: ${v.n} posts @ ${v.avgLikes} avg likes`).join(' · ')} |
| Hashtags | **0 posts out of ${own.length}** — he never uses them |
| Inline links in the main post | **6 of ${own.length} (1.0%)** — avg 20.5 likes vs **36.5** without |
| Starts lowercase | 451 of ${own.length} (74.8%) — avg 41.3 likes vs 23.8 for uppercase starts |
| Emoji | 158 of ${own.length} (26.2%) |
| Original post length | median **117 chars** (p25 73 · p75 212 · p95 567) |
| Quote caption length | median **46 chars** |
| Multi-post threads detected | 27 conversations |

---

## 4. Top 25 posts by views (sampled set)

${table(topViews.slice(0, 25))}

---

## 5. Top 60 posts by likes

${table(top60)}

---

## 6. Bottom 25 by likes — what does not work

${table(bottom25)}

---

## 7. Full database

Full ${num(rows.length)}-row dataset with every field is in the machine-readable siblings:

- [\`seb-design-x-corpus.csv\`](./seb-design-x-corpus.csv) — spreadsheet-ready, one row per post
- [\`seb-design-x-corpus.json\`](./seb-design-x-corpus.json) — normalized objects

Columns: \`id, url, utc, dateLocal, timeLocal, weekday, type, media, topics, chars, lines, likes, reposts, replies, views, engagement, engagementRate, quotedAuthor, text\`.

### Accounts he quote-tweets most

${(() => {
  const c = {};
  for (const r of rows) if (r.quotedAuthor) c[r.quotedAuthor] = (c[r.quotedAuthor] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([k, v]) => `- **@${k}** — ${v} quote${v > 1 ? 's' : ''}`).join('\n');
})()}
`;

fs.writeFileSync(path.join(OUT_DIR, 'seb-design-x-post-database.md'), md);
console.log('wrote seb-design-x-post-database.md');
console.log('rows', rows.length, 'withViews', withViews.length);
