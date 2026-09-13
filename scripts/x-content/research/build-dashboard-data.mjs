#!/usr/bin/env node
// Builds docs/audits/x-dashboard-data.json from the two normalized X corpora.
// Pure Node ESM, no dependencies. Deterministic given the same input files
// (only `generatedAt` varies run to run).
//
// Run: node scripts/x-content/research/build-dashboard-data.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../');

const SEB_PATH = path.join(REPO_ROOT, 'docs/audits/seb-design-x-corpus.json');
const BAI_PATH = path.join(REPO_ROOT, 'docs/audits/bai-ee-x-corpus.json');
const OUT_PATH = path.join(REPO_ROOT, 'docs/audits/x-dashboard-data.json');

const WINDOW_START = '2026-07-07';
const WINDOW_END = '2026-09-10';

const FOLLOWERS = { seb: 1549, baiee: 1725 };
const HANDLES = { seb: 'seb__design', baiee: 'bai_ee' };

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function loadCorpus(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/** Every calendar date string (YYYY-MM-DD) from start to end, inclusive. */
function dateRange(start, end) {
  const dates = [];
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cur.getTime() <= last.getTime()) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/** Median of a numeric array. Returns null for an empty array. */
function median(nums) {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Mean of a numeric array. Returns null for an empty array (never coerces to 0). */
function mean(nums) {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

function textShort(text, maxLen = 120) {
  const collapsed = (text || '').replace(/\r\n|\r|\n/g, ' / ');
  return collapsed.slice(0, maxLen);
}

function slimPost(p) {
  return {
    id: p.id,
    date: p.dateLocal,
    utc: p.utc,
    type: p.type,
    media: p.media,
    likes: p.likes,
    views: p.views,
    engagementRate: p.engagementRate,
    topics: p.topics,
    textShort: textShort(p.text),
    url: p.url,
  };
}

// ---------------------------------------------------------------------------
// per-account computation
// ---------------------------------------------------------------------------

function buildAccount(key, posts, caveats) {
  const handle = HANDLES[key];
  const totalPosts = posts.length;
  const retweetPosts = posts.filter((p) => p.type === 'retweet');
  const authoredPosts = posts.filter((p) => p.type !== 'retweet');
  const retweets = retweetPosts.length;
  const authoredCount = authoredPosts.length;

  const activeDaySet = new Set(posts.map((p) => p.dateLocal));
  const viewedValues = posts.map((p) => p.views).filter((v) => v != null);
  const medianViews = median(viewedValues);
  const avgLikes = round2(mean(posts.map((p) => p.likes)));

  const missingIsExactlyRetweets =
    retweetPosts.every((p) => p.views == null) && authoredPosts.every((p) => p.views != null);

  if (viewedValues.length === 0) {
    caveats.push(`${key}: no posts have views data — medianViews is null.`);
  } else if (viewedValues.length < totalPosts && missingIsExactlyRetweets) {
    caveats.push(
      `${key}: views known for ${viewedValues.length}/${totalPosts} posts — the gap is exactly the ${retweets} retweets (retweets structurally carry no view count on this source; every authored post IS sampled). medianViews/avgViews reflect the full authored population, not a biased subsample.`
    );
  } else if (viewedValues.length < totalPosts) {
    caveats.push(
      `${key}: views known for only ${viewedValues.length}/${totalPosts} posts, and NOT a random gap — the sample is top-100-by-likes plus random controls (see corpus note). This means medianViews/avgViews and any daily/rolling "views" series are biased toward high-performing posts and will UNDERSTATE true totals unevenly by day (days that happen to contain a top-liked post look disproportionately strong). Do not chart seb's daily/rolling views next to baiee's as if they were equally reliable.`
    );
  }

  const meta = {
    handle,
    followers: FOLLOWERS[key],
    totalPosts,
    authoredPosts: authoredCount,
    retweets,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    activeDays: activeDaySet.size,
    medianViews,
    avgLikes,
  };

  // ---- daily -------------------------------------------------------------
  const dates = dateRange(WINDOW_START, WINDOW_END);
  const byDate = new Map();
  for (const d of dates) {
    byDate.set(d, {
      date: d,
      posts: 0,
      authored: 0,
      retweets: 0,
      likes: 0,
      reposts: 0,
      replies: 0,
      views: 0,
      viewsSampled: 0,
    });
  }
  for (const p of posts) {
    const bucket = byDate.get(p.dateLocal);
    if (!bucket) {
      // Post falls outside the fixed dashboard window — skip it from the
      // daily/rolling series but it is still counted in meta totals above.
      continue;
    }
    bucket.posts += 1;
    if (p.type === 'retweet') bucket.retweets += 1;
    else bucket.authored += 1;
    bucket.likes += p.likes;
    bucket.reposts += p.reposts;
    bucket.replies += p.replies;
    if (p.views != null) {
      bucket.views += p.views;
      bucket.viewsSampled += 1;
    }
  }

  let cumLikes = 0;
  let cumPosts = 0;
  const daily = dates.map((d) => {
    const b = byDate.get(d);
    cumLikes += b.likes;
    cumPosts += b.posts;
    return { ...b, cumLikes, cumPosts };
  });

  const outOfWindow = posts.length - dates.reduce((sum, d) => sum + byDate.get(d).posts, 0);
  if (outOfWindow > 0) {
    caveats.push(
      `${key}: ${outOfWindow} post(s) fall outside the ${WINDOW_START}..${WINDOW_END} dashboard window and are excluded from daily/rolling series (still counted in meta totals).`
    );
  }

  // ---- rolling (7-day trailing) ------------------------------------------
  const rolling = daily.map((_, i) => {
    const start = Math.max(0, i - 6);
    const windowSlice = daily.slice(start, i + 1);
    const avgLikes7 = round2(mean(windowSlice.map((d) => d.likes)));
    const avgPosts7 = round2(mean(windowSlice.map((d) => d.posts)));
    const viewsSum = windowSlice.reduce((a, d) => a + d.views, 0);
    const sampledSum = windowSlice.reduce((a, d) => a + d.viewsSampled, 0);
    const avgViews7 = sampledSum === 0 ? null : round2(viewsSum / sampledSum);
    return { date: daily[i].date, avgLikes7, avgPosts7, avgViews7 };
  });

  // ---- posts / topPosts ---------------------------------------------------
  const slimPosts = posts.map(slimPost);
  const topPosts = [...posts]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 12)
    .map(slimPost);

  // ---- typeBreakdown -------------------------------------------------------
  const byType = new Map();
  for (const p of posts) {
    if (!byType.has(p.type)) byType.set(p.type, []);
    byType.get(p.type).push(p);
  }
  const typeBreakdown = {};
  for (const [type, list] of byType.entries()) {
    const viewsForType = list.map((p) => p.views).filter((v) => v != null);
    const erForType = list.map((p) => p.engagementRate).filter((v) => v != null);
    // Pooled ER = total engagement / total views. Preferred over avgER (a mean
    // of per-post ratios), which a handful of low-view posts can inflate badly —
    // 1 like on an 18-view post reads as 5.6% and outweighs a 40k-view post.
    const withViews = list.filter((p) => p.views != null && p.views > 0);
    const pooledEng = withViews.reduce((a, p) => a + p.likes + p.reposts + p.replies, 0);
    const pooledViews = withViews.reduce((a, p) => a + p.views, 0);
    typeBreakdown[type] = {
      n: list.length,
      nSampled: withViews.length,
      avgLikes: round2(mean(list.map((p) => p.likes))),
      avgViews: viewsForType.length === 0 ? null : round2(mean(viewsForType)),
      avgER: erForType.length === 0 ? null : round2(mean(erForType)),
      pooledER: pooledViews === 0 ? null : round2((pooledEng / pooledViews) * 100),
    };
  }

  const allWithViews = posts.filter((p) => p.views != null && p.views > 0);
  const overallPooledER = allWithViews.length === 0 ? null : round2(
    (allWithViews.reduce((a, p) => a + p.likes + p.reposts + p.replies, 0)
      / allWithViews.reduce((a, p) => a + p.views, 0)) * 100,
  );

  // ---- composition: type x media, and what an occupied hour contains ---------
  const hourOf = (p) => Number(p.timeLocal.slice(0, 2));
  const MEDIA = ['video', 'image', 'gif', 'none'];
  const typeMedia = {};
  for (const [type, list] of byType.entries()) {
    typeMedia[type] = { total: list.length };
    for (const m of MEDIA) {
      const cell = list.filter((q) => q.media === m);
      if (!cell.length) { typeMedia[type][m] = null; continue; }
      const withV = cell.filter((q) => q.views != null);
      typeMedia[type][m] = {
        n: cell.length,
        avgLikes: round2(mean(cell.map((q) => q.likes))),
        avgViews: withV.length ? Math.round(mean(withV.map((q) => q.views))) : null,
      };
    }
  }

  // Group posts into date+hour cells to see what a clustered hour is made of.
  const cellMap = new Map();
  for (const q of posts) {
    const k = `${q.dateLocal}|${hourOf(q)}`;
    if (!cellMap.has(k)) cellMap.set(k, []);
    cellMap.get(k).push(q);
  }
  const cellsAll = [...cellMap.values()];
  const solo = cellsAll.filter((c) => c.length === 1);
  const multi = cellsAll.filter((c) => c.length >= 2);
  const mixShare = (list) => {
    const flat = list.flat();
    const t = {};
    for (const q of flat) t[q.type] = (t[q.type] || 0) + 1;
    return Object.fromEntries(Object.entries(t)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, round2((v / flat.length) * 100)]));
  };
  const seq = {};
  for (const c of multi) {
    const ordered = c.slice().sort((a, b) => (a.timeLocal < b.timeLocal ? -1 : 1));
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const k = `${ordered[i].type} \u2192 ${ordered[i + 1].type}`;
      seq[k] = (seq[k] || 0) + 1;
    }
  }
  const sameType = multi.filter((c) => new Set(c.map((q) => q.type)).size === 1).length;

  const composition = {
    typeMedia,
    hours: {
      occupied: cellsAll.length,
      solo: solo.length,
      multi: multi.length,
      postsPerOccupiedHour: round2(posts.length / cellsAll.length),
      occupiedHoursPerDay: round2(cellsAll.length / activeDaySet.size),
      shareOfPostsInMultiHour: round2((multi.flat().length / posts.length) * 100),
      busiestHour: cellsAll.reduce((m, c) => Math.max(m, c.length), 0),
      mixedClusterShare: multi.length ? round2(((multi.length - sameType) / multi.length) * 100) : null,
      soloMix: mixShare(solo),
      multiMix: mixShare(multi),
      topSequences: Object.entries(seq).sort((a, b) => b[1] - a[1]).slice(0, 6)
        .map(([pair, n]) => ({ pair, n })),
    },
  };

  return { meta, daily, rolling, posts: slimPosts, typeBreakdown, topPosts, overallPooledER, composition };
}

// ---------------------------------------------------------------------------
// annotations (must trace to real posts — no invented events)
// ---------------------------------------------------------------------------

function findOne(posts, needle, label) {
  const hits = posts.filter((p) => p.text && p.text.toLowerCase().includes(needle.toLowerCase()));
  if (hits.length !== 1) {
    throw new Error(
      `Annotation lookup "${label}" expected exactly 1 match for "${needle}", found ${hits.length}. Corpus may have changed — re-verify manually.`
    );
  }
  return hits[0];
}

function buildAnnotations(sebPosts, baiPosts) {
  const annotations = [];

  const holy1000 = findOne(sebPosts, 'holy number 1000', 'seb 1000 followers');
  annotations.push({
    date: holy1000.dateLocal,
    account: 'seb',
    label: '1,000 followers',
    detail: `"${holy1000.text.split('\n')[0]}" — ${holy1000.likes} likes, ${holy1000.views ?? 'n/a'} views.`,
    postId: holy1000.id,
    url: holy1000.url,
  });

  const soClose1k = findOne(sebPosts, 'so close to 1k', 'seb so close to 1k');
  annotations.push({
    date: soClose1k.dateLocal,
    account: 'seb',
    label: 'Approaching 1k',
    detail: `"${soClose1k.text.split('\n')[0]}" — ${soClose1k.likes} likes, ${soClose1k.views ?? 'n/a'} views, posted the day before the 1,000-follower milestone post.`,
    postId: soClose1k.id,
    url: soClose1k.url,
  });

  const baiByViews = [...baiPosts].filter((p) => p.views != null).sort((a, b) => b.views - a.views);
  if (baiByViews.length < 2) {
    throw new Error('Expected at least 2 bai_ee posts with views to build breakout annotations.');
  }
  const [top1, top2] = baiByViews;
  annotations.push({
    date: top1.dateLocal,
    account: 'baiee',
    label: 'Breakout \u00b7 4,712 views',
    detail: `"${textShort(top1.text, 80)}" — ${top1.views} views, ${top1.likes} likes (highest-viewed post in the window).`,
    postId: top1.id,
    url: top1.url,
  });
  annotations.push({
    date: top2.dateLocal,
    account: 'baiee',
    label: 'Breakout \u00b7 1,870 views',
    detail: `"${textShort(top2.text, 80)}" — ${top2.views} views, ${top2.likes} likes (2nd-highest-viewed post in the window).`,
    postId: top2.id,
    url: top2.url,
  });

  return annotations;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const caveats = [];
  const sebPosts = loadCorpus(SEB_PATH);
  const baiPosts = loadCorpus(BAI_PATH);

  const seb = buildAccount('seb', sebPosts, caveats);
  const baiee = buildAccount('baiee', baiPosts, caveats);
  const annotations = buildAnnotations(sebPosts, baiPosts);

  const output = {
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    generatedAt: new Date().toISOString(),
    seb,
    baiee,
    annotations,
  };

  writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');

  // ---- stderr summary ------------------------------------------------------
  const expectedDays = dateRange(WINDOW_START, WINDOW_END).length;
  process.stderr.write(`Wrote ${OUT_PATH}\n`);
  process.stderr.write(
    `seb: ${seb.meta.totalPosts} posts (${seb.meta.authoredPosts} authored / ${seb.meta.retweets} RT), daily=${seb.daily.length}, rolling=${seb.rolling.length}, posts=${seb.posts.length}, topPosts=${seb.topPosts.length}\n`
  );
  process.stderr.write(
    `baiee: ${baiee.meta.totalPosts} posts (${baiee.meta.authoredPosts} authored / ${baiee.meta.retweets} RT), daily=${baiee.daily.length}, rolling=${baiee.rolling.length}, posts=${baiee.posts.length}, topPosts=${baiee.topPosts.length}\n`
  );
  process.stderr.write(`Expected daily length (${WINDOW_START}..${WINDOW_END} inclusive): ${expectedDays}\n`);
  process.stderr.write(`Median views — seb: ${seb.meta.medianViews}, baiee: ${baiee.meta.medianViews}\n`);
  process.stderr.write(`Annotations: ${annotations.length}\n`);
  if (caveats.length) {
    process.stderr.write(`\nCaveats / null fields:\n`);
    for (const c of caveats) process.stderr.write(` - ${c}\n`);
  } else {
    process.stderr.write(`\nNo caveats.\n`);
  }
}

main();
