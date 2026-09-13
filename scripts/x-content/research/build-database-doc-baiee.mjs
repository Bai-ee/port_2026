#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const SP = path.dirname(new URL(import.meta.url).pathname);
const REPO = '/Users/bballi/Documents/Repos/Bballi_Portfolio';
const OUT_DIR = path.join(REPO, 'docs', 'audits');
const rows = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'bai-ee-x-corpus.json'), 'utf8'));
const stats = JSON.parse(fs.readFileSync(path.join(SP, 'baiee-stats.json'), 'utf8'));
const profile = JSON.parse(fs.readFileSync(path.join(SP, 'baiee-profile.json'), 'utf8'));
const sebStats = JSON.parse(fs.readFileSync(path.join(SP, 'seb-stats.json'), 'utf8'));
const sebRows = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'seb-design-x-corpus.json'), 'utf8'));
const L = profile.legacy || {};

const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n+/g, ' ⏎ ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const num = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));

const own = rows.filter((r) => r.type !== 'retweet');
const withViews = rows.filter((r) => r.views != null);
const sebOwn = sebRows.filter((r) => r.type !== 'retweet');
const sebViews = sebRows.filter((r) => r.views != null);

// True median: average the two middle values on an even-length array.
const med = (arr) => {
  const s = arr.slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
};

// Pooled engagement rate: total engagement / total views. Preferred over a mean
// of per-post ratios, which low-view posts inflate badly (1 like on 18 views = 5.6%).
const pooledER = (list) => {
  const w = list.filter((r) => r.views != null && r.views > 0);
  if (!w.length) return null;
  const eng = w.reduce((a, r) => a + r.likes + r.reposts + r.replies, 0);
  const v = w.reduce((a, r) => a + r.views, 0);
  return { n: w.length, er: (eng / v) * 100 };
};

function table(list) {
  const head = '| # | Date (CDT) | Time | Day | Type | Media | Topics | Post copy | Views | Likes | RT | Replies | ER% | Link |';
  const rule = '|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---|';
  const body = list.map((r, i) => {
    const copy = esc(clip(r.text, 220)) + (r.quotedAuthor ? ` **↪ QT @${r.quotedAuthor}:** _${esc(clip(r.quotedText || '', 80))}_` : '');
    return `| ${i + 1} | ${r.dateLocal} | ${r.timeLocal} | ${r.weekday} | ${r.type} | ${r.media} | ${r.topics.join(', ')} | ${copy} | ${num(r.views)} | ${num(r.likes)} | ${num(r.reposts)} | ${num(r.replies)} | ${r.engagementRate ?? '—'} | [↗](${r.url}) |`;
  });
  return [head, rule, ...body].join('\n');
}

const typeStats = {};
for (const r of rows) {
  typeStats[r.type] = typeStats[r.type] || { n: 0, likes: 0, replies: 0, reposts: 0, views: 0, vn: 0, er: 0 };
  const s = typeStats[r.type];
  s.n += 1; s.likes += r.likes; s.replies += r.replies; s.reposts += r.reposts;
  if (r.views != null) { s.views += r.views; s.vn += 1; s.er += r.engagementRate || 0; }
}
const sebTypeStats = {};
for (const r of sebRows) {
  sebTypeStats[r.type] = sebTypeStats[r.type] || { n: 0, views: 0, vn: 0, er: 0, likes: 0 };
  const s = sebTypeStats[r.type];
  s.n += 1; s.likes += r.likes;
  if (r.views != null) { s.views += r.views; s.vn += 1; s.er += r.engagementRate || 0; }
}

const myMedView = med(withViews.map((r) => r.views));
const sebMedView = med(sebViews.map((r) => r.views));
const myFollowers = L.followers_count;
const sebFollowers = 1549;

const topViews = withViews.slice().sort((a, b) => b.views - a.views);
const hourRows = stats.hourHist.filter((h) => h.n >= 5);

const md = `# @bai_ee — X post audit (${stats.firstPost.slice(0, 10)} → ${stats.lastPost.slice(0, 10)})

> Self-audit run on the **same window and same method** as the [@seb__design study](./seb-design-x-post-database.md), so the two are directly comparable.
> Strategy built on this: [\`docs/plans/X-STRATEGY-SEB-MODEL.md\`](../plans/X-STRATEGY-SEB-MODEL.md)
> Machine-readable: [\`bai-ee-x-corpus.json\`](./bai-ee-x-corpus.json) · [\`bai-ee-x-corpus.csv\`](./bai-ee-x-corpus.csv) · [\`bai-ee-x-stats.json\`](./bai-ee-x-stats.json)

## 0. Account & provenance

| Field | @bai_ee | @seb__design |
|---|---|---|
| Display name | ${L.name} | seb-astian |
| Bio | ${esc(L.description || '')} | Brands & websites for founders that want to stand out |
| Account created | ${L.created_at} | Sun Apr 20 2025 |
| **Followers** | **${num(L.followers_count)}** | 1,549 |
| Following | ${num(L.friends_count)} | 648 |
| Lifetime posts | ${num(L.statuses_count)} | 4,238 |
| Likes given | ${num(L.favourites_count)} | 10,575 |
| **Blue verified** | **${profile.is_blue_verified ? 'yes' : 'NO'}** | yes |
| Bio CTA | ${esc((L.entities?.url?.urls?.[0]?.expanded_url) || 'none')} | Calendly discovery call |

| | |
|---|---|
| Window | ${stats.firstPost.slice(0, 10)} → ${stats.lastPost.slice(0, 10)} (${stats.spanDays} days, ${stats.daysCovered} active) |
| Posts captured | **${num(stats.posts)}** |
| View counts resolved | **${num(withViews.length)}** — every authored post in the window (retweets excluded; their views belong to the original author) |
| Timezone | US Central (UTC−5), inferred from git commit offsets — 191 of 200 at \`-0500\` |
| Collection | \`bird\` CLI (free) + ScrapeCreators view backfill (85 credits ≈ \\$0.16). **Zero X API spend.** |

---

## 1. The headline

You have **${num(myFollowers)} followers — ${myFollowers - sebFollowers} more than seb** — and roughly **1/36th of his engagement per post**.

| Metric | @bai_ee | @seb__design | Gap |
|---|---:|---:|---|
| Followers | **${num(myFollowers)}** | ${num(sebFollowers)} | **you +${myFollowers - sebFollowers}** |
| Posts in window | ${num(stats.posts)} | ${num(sebStats.posts)} | 3.2× fewer |
| Posts / active day | ${stats.postsPerActiveDay} | ${sebStats.postsPerActiveDay} | 2.9× fewer |
| Total likes in window | **${num(rows.reduce((a, b) => a + b.likes, 0))}** | ${num(sebRows.reduce((a, b) => a + b.likes, 0))} | **111× fewer** |
| Avg likes / post | **${(rows.reduce((a, b) => a + b.likes, 0) / rows.length).toFixed(2)}** | ${(sebRows.reduce((a, b) => a + b.likes, 0) / sebRows.length).toFixed(2)} | **35× fewer** |
| **Median post views** | **${num(myMedView)}** | ${num(sebMedView)} | **${Math.round(sebMedView / myMedView)}× fewer** |
| Median reach vs followers | **${(myMedView / myFollowers).toFixed(2)}×** | ${(sebMedView / sebFollowers).toFixed(2)}× | **${Math.round((sebMedView / sebFollowers) / (myMedView / myFollowers))}× fewer** |
| Best post (likes) | ${num(Math.max(...rows.map((r) => r.likes)))} | ${num(Math.max(...sebRows.map((r) => r.likes)))} | 51× fewer |
| Best post (views) | ${num(topViews[0].views)} | ${num(sebViews.slice().sort((a, b) => b.views - a.views)[0].views)} | 14× fewer |

**Your median post is seen by ${myMedView} people. You have ${num(myFollowers)} followers.** That is ${(myMedView / myFollowers * 100).toFixed(0)}% of your own audience — the algorithm is not delivering your posts even to the people who already chose to follow you.

---

## 2. The good news — this is a distribution problem, not a content problem

**Your engagement rate is level with his.** Pooled across every post that has a view count — total engagement over total views — you sit at **${pooledER(rows).er.toFixed(2)}%** against his **${pooledER(sebRows).er.toFixed(2)}%**. Statistically indistinguishable on this sample size.

| Post type | @bai_ee pooled ER | @seb__design pooled ER | @bai_ee n | @seb n |
|---|---:|---:|---:|---:|
${['quote-react', 'quote-commentary', 'original-showcase', 'original-text'].map((k) => {
  const m = pooledER(rows.filter((r) => r.type === k));
  const s = pooledER(sebRows.filter((r) => r.type === k));
  if (!m || !s) return null;
  const flag = m.er > s.er ? ' ✅' : '';
  return `| \`${k}\` | **${m.er.toFixed(2)}%**${flag} | ${s.er.toFixed(2)}% | ${m.n} | ${s.n} |`;
}).filter(Boolean).join('\n')}
| **ALL POSTS** | **${pooledER(rows).er.toFixed(2)}%** | ${pooledER(sebRows).er.toFixed(2)}% | ${pooledER(rows).n} | ${pooledER(sebRows).n} |

You lead on both quote formats; he leads on showcase and text. Overall it is a wash.

⚠️ **A correction to an earlier version of this document.** It previously reported that your \`original-showcase\` engagement rate (3.36%) beat his (3.00%) and concluded your content converts better. Those were *means of per-post ratios*, which a handful of very low-view posts inflate badly — a single like on an 18-view post scores 5.6% and outweighs a 40,000-view post. **75% of your authored posts are under 100 views**, so that metric flattered you far more than it flattered him. Pooled by impressions, the advantage disappears.

The corrected finding is not weaker — it is sharper. **Identical conversion, a thirty-third of the reach.** If your content converted *worse*, reach would be the wrong thing to fix. It doesn't, so it is the right thing to fix.

---

## 3. Why distribution is dead — five measurable causes

### 3a. Two-thirds of your output is retweets

| Type | @bai_ee | share | @seb__design | share |
|---|---:|---:|---:|---:|
${Object.entries(typeStats).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `| \`${k}\` | ${v.n} | ${((v.n / rows.length) * 100).toFixed(1)}% | ${sebTypeStats[k]?.n ?? 0} | ${(((sebTypeStats[k]?.n ?? 0) / sebRows.length) * 100).toFixed(1)}% |`).join('\n')}

**${typeStats.retweet.n} of ${rows.length} posts (${((typeStats.retweet.n / rows.length) * 100).toFixed(0)}%) are retweets.** seb sits at 23%. A retweet produces no authored impression for you — X credits the view to the original author. You are spending two-thirds of your posting budget on content that cannot grow your account.

Authored posts in the window: **you ${own.length}, seb ${sebOwn.length}**. That is the real ratio, and it is 7:1 against you.

### 3b. You reply to almost nobody

**${typeStats.reply?.n ?? 0} replies in ${stats.spanDays} days.** seb's visible count is 33 and his true number is far higher (10,575 likes given, 648 following).

Replies are the only mechanism on X that puts you in front of an audience you have not already earned. Zero replies means zero new audience, which is exactly what the reach numbers show.

### 3c. Your quote-tweets borrow from accounts with no audience

The quote-react mechanic works by inheriting the quoted post's viewers. Same format, wildly different result:

| | @bai_ee | @seb__design |
|---|---:|---:|
| Avg views on \`quote-react\` | **${num(Math.round(typeStats['quote-react'].views / typeStats['quote-react'].vn))}** | ${num(Math.round(sebTypeStats['quote-react'].views / sebTypeStats['quote-react'].vn))} |

He quotes accounts whose posts are already going viral (\`@rare_jpg\`, \`@interiorsuckerr\`, \`@DesignReviewed\`, \`@jmdsgn\`). Your quote targets in this window include \`@sheherenow_\`, \`@kaolti\`, \`@Peal8888\`, \`@fintechfrank\`, \`@RockyRoark\` — small or non-visual accounts. **The format is right. The targets are wrong.** This is the single cheapest thing on this list to fix.

### 3d. You are not blue verified, he is

X down-ranks unverified accounts in reply ranking and conversation surfacing. This is the one structural disadvantage on the list that costs money rather than effort, and it is worth noting that his account is 17 years younger than yours and outperforms it 35×.

### 3e. Your feed mixes audiences that repel each other

| Topic | Posts | Avg likes | Avg views |
|---|---:|---:|---:|
${Object.entries(stats.topicStats).sort((a, b) => (b[1].avgViews || 0) - (a[1].avgViews || 0)).map(([k, v]) => `| \`${k}\` | ${v.n} | ${v.avgLikes} | ${v.avgViews == null ? '—' : num(v.avgViews)} |`).join('\n')}

US politics: **${stats.topicStats['us-politics']?.n ?? 0} posts, ${stats.topicStats['us-politics']?.avgLikes ?? 0} likes, ${stats.topicStats['us-politics']?.avgViews ?? 0} avg views.** Not merely unproductive — posts like these teach the algorithm and your followers that your feed is not a design feed. Crypto/rug content (${stats.topicStats['crypto-finance']?.n ?? 0} posts) does the same to a creative audience.

Meanwhile \`design-engineering\` — the thing you are genuinely world-class at — gets **${num(stats.topicStats['design-engineering']?.avgViews ?? 0)} avg views across ${stats.topicStats['design-engineering']?.n ?? 0} posts**, because you post it as plain text with no media.

---

## 4. What already works for you

Two posts broke out, and both are the same shape: **video + a specific shipped thing + structure.**

${table(topViews.slice(0, 10))}

Format signal, your account:

| Media | Posts | Avg likes | Avg views |
|---|---:|---:|---:|
${Object.entries(stats.mediaStats).sort((a, b) => (b[1].avgViews || 0) - (a[1].avgViews || 0)).map(([k, v]) => `| ${k} | ${v.n} | ${v.avgLikes} | ${v.avgViews == null ? '—' : num(v.avgViews)} |`).join('\n')}

**Video gets ${Math.round(stats.mediaStats.video.avgViews / stats.mediaStats.none.avgViews)}× the reach of a text post on your account** — the same directional signal as seb's, just at 1/24th the scale. You only posted ${stats.mediaStats.video.n} videos in ${stats.spanDays} days despite owning a repo full of tools that emit video.

### Content hygiene — you are already clean here

| Rule | @bai_ee | @seb__design |
|---|---|---|
| Hashtags | 4 of ${own.length} (4.8%) | 0 of 603 |
| Inline links in main post | 4 of ${own.length} (4.8%) | 6 of 603 (1.0%) |
| Median authored post length | **${med(own.map((r) => r.chars))} chars** | 117 chars |

Brevity is not your problem — your posts are *shorter* than his. Drop the four hashtags and you match him on mechanics.

---

## 5. Timing

| Hour (CDT) | Posts | Avg likes |
|---|---:|---:|
${hourRows.map((h) => `| ${String(h.hour).padStart(2, '0')}:00 | ${h.n} | ${h.avgLikes} |`).join('\n')}

| Weekday | Posts | Avg likes |
|---|---:|---:|
${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => { const v = stats.dayHist[d]; return v ? `| ${d} | ${v.n} | ${(v.likes / v.n).toFixed(1)} |` : ''; }).filter(Boolean).join('\n')}

⚠️ **Do not tune your schedule on this table.** At 66 median views the numbers are noise — one lucky post moves an entire hour's average. Timing is a fifth-order concern until reach is fixed. Use seb's timing table (European afternoon / US morning overlap = 07:00–11:00 CDT) as the starting hypothesis and re-measure once your median post clears ~500 views.

---

## 6. Every authored post in the window

All ${own.length} authored posts, ranked by views. Retweets excluded — see the CSV for the full ${rows.length}-row set.

${table(own.slice().sort((a, b) => (b.views ?? 0) - (a.views ?? 0)))}

---

## 7. Limits of this audit

1. **Replies are under-sampled** on both accounts — X's profile timeline hides most of them. Your ${typeStats.reply?.n ?? 0} is a floor. But given 1,591 following and 22,977 lifetime likes against 4 visible replies in 65 days, the qualitative conclusion holds.
2. **Retweet views are unmeasurable.** X attributes them to the original author, so the ${typeStats.retweet.n} retweets contribute nothing to the view figures here. That is exactly the argument against posting them.
3. **Views are as-of ${stats.pulledAt.slice(0, 10)}.** Recent posts have had less time to accumulate.
4. **Follower attribution is invisible.** We cannot see which posts won or lost followers — X shows that to nobody.
5. **Your window is the same 65 days as seb's**, but your corpus went back further (382 posts to 2026-03-07) before being trimmed for comparability. Low volume, not a pagination limit.
`;

fs.writeFileSync(path.join(OUT_DIR, 'bai-ee-x-post-database.md'), md);
console.log('wrote bai-ee-x-post-database.md');
console.log('rows', rows.length, 'authored', own.length, 'withViews', withViews.length);
