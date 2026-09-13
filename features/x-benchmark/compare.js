// Compare one account's stat block against a benchmark account's, and return a
// ranked list of gaps.
//
// This is the layer that used to exist only as prose inside
// docs/audits/x-dashboard.html: "he posts 11.85×/day and you post 3.8", "his
// output is 23% retweets and yours is 66%", "your best type is the one you
// post least". Making it a function is what lets a second client have the same
// analysis without a human re-deriving it.
//
// Pure: no fs, no network, no clock. Input is two blocks from summarize.js.
//
// ⚠️ Impacts are only comparable WITHIN a unit. A `perPost` impact of 0.4 and a
// `perDay` impact of 0.4 are different claims — one is about what a post earns,
// the other about how many posts exist. Every gap carries its unit; a consumer
// that ranks across units is comparing unlike things.

import { MIN_CLASS_N } from './summarize.js';

/** Type-mix differences smaller than this (in percentage points of authored
 * output) are noise at these corpus sizes and are not reported. */
export const MIN_SHARE_DELTA_PP = 3;

/** A gap must move expected per-post engagement by at least this much to be
 * worth a line in the report. */
export const MIN_IMPACT = 0.02;

/** Below this many authored posts, an account's own measurements are too thin
 * to drive a recommendation and the whole report is flagged. */
export const MIN_CORPUS_N = 30;

/** Topic labels are produced by a per-account tagger, so two corpora can carry
 * entirely different vocabularies (the first two real corpora shared 1 label
 * out of 28). Comparing them then reports every benchmark topic as "0% of your
 * output", which is a property of the tagger and not a finding. Topic gaps are
 * suppressed unless at least this share of the benchmark's topic labels also
 * exist in the account's own vocabulary. */
export const MIN_TOPIC_VOCAB_OVERLAP = 0.3;

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

function round4(n) {
  return n == null ? null : Math.round(n * 10000) / 10000;
}

function confidenceFor(ownN, benchN) {
  const low = Math.min(ownN ?? 0, benchN ?? 0);
  if (low >= 25) return 'high';
  if (low >= MIN_CLASS_N) return 'medium';
  return 'low';
}

/**
 * The lift to credit a post type with, and where that number came from.
 *
 * Prefers the account's OWN measured performance — the benchmark's audience
 * rewards the benchmark's posts, and there is no reason to assume it transfers.
 * Only when the account has too few posts of a type to have measured anything
 * does it borrow the benchmark's figure, and it says so, because "you should
 * post more self-quotes" resting on the benchmark's self-quote performance is a
 * weaker claim than one resting on your own.
 */
function resolveLift(type, own, benchmark) {
  const ownCell = own.byType?.[type];
  const benchCell = benchmark.byType?.[type];
  if (ownCell && (ownCell.n ?? 0) >= MIN_CLASS_N && num(ownCell.lift) != null) {
    return { lift: ownCell.lift, source: 'own', n: ownCell.n };
  }
  if (benchCell && num(benchCell.lift) != null) {
    return { lift: benchCell.lift, source: 'benchmark', n: benchCell.n ?? 0 };
  }
  return { lift: null, source: 'none', n: ownCell?.n ?? 0 };
}

function shareOf(block, type) {
  return num(block.byType?.[type]?.share) ?? 0;
}

/**
 * What to actually do about a type-mix difference.
 *
 * A raw share delta is not a recommendation. The benchmark posts a lot of
 * original-text; the account's own original-text earns 0.16× its average. Both
 * facts are true, and "post more original-text" does not follow from them — the
 * type works for that audience and has not worked for this one. Equally, the
 * account's best type being one the benchmark posts LESS of is not a reason to
 * cut it.
 *
 * So direction is a function of both the delta and the measured lift:
 *
 *   benchmark does more · you perform well   → increase   (actionable)
 *   benchmark does more · you perform badly  → investigate (execution, not mix)
 *   benchmark does less · you perform well   → hold        (your edge, don't copy)
 *   benchmark does less · you perform badly  → decrease    (actionable)
 *
 * Only the actionable directions carry a modelled impact. `investigate` and
 * `hold` are reported at impact 0 so that blind mix-matching can never be the
 * top-ranked recommendation.
 */
function mixDirection(deltaPP, lift, expectedNow) {
  const performsWell = lift >= expectedNow;
  if (deltaPP > 0) return performsWell ? 'increase' : 'investigate';
  return performsWell ? 'hold' : 'decrease';
}

/**
 * Compare an account to a benchmark.
 *
 * @param {object} input
 * @param {object} input.own - summarizeCorpus() block for the client's account
 * @param {object} input.benchmark - summarizeCorpus() block for the model account
 * @returns {object} { ownHandle, benchmarkHandle, warnings, gaps, projection }
 */
export function compareToBenchmark(input = {}) {
  const own = isObj(input.own) ? input.own : {};
  const benchmark = isObj(input.benchmark) ? input.benchmark : {};

  const warnings = [];
  const gaps = [];

  const ownAuthored = num(own.authoredPosts) ?? 0;
  const benchAuthored = num(benchmark.authoredPosts) ?? 0;

  if (!ownAuthored || !benchAuthored) {
    return {
      ownHandle: own.handle ?? null,
      benchmarkHandle: benchmark.handle ?? null,
      warnings: ['One or both corpora contain no authored posts — nothing to compare.'],
      gaps: [],
      projection: null,
    };
  }

  if (ownAuthored < MIN_CORPUS_N) {
    warnings.push(
      `Own corpus has only ${ownAuthored} authored posts (min ${MIN_CORPUS_N} for confident per-type figures) — most per-type lifts are borrowed from the benchmark.`,
    );
  }
  if (num(own.base?.viewsCoverage) != null && own.base.viewsCoverage < 0.9) {
    warnings.push(
      `Own view coverage is ${Math.round(own.base.viewsCoverage * 100)}% — engagement-rate figures in this block are a biased subsample; all lifts use likes.`,
    );
  }
  if (num(benchmark.base?.viewsCoverage) != null && benchmark.base.viewsCoverage < 0.9) {
    warnings.push(
      `Benchmark view coverage is ${Math.round(benchmark.base.viewsCoverage * 100)}% — its engagement-rate figures are a biased subsample; all lifts use likes.`,
    );
  }
  warnings.push(
    'Hour-of-day figures are each account\'s own local clock and are not aligned across accounts — only the shape (hours occupied, posts per hour) is compared.',
  );

  // ---- volume ------------------------------------------------------------
  const ownPerDay = num(own.cadence?.authoredPerActiveDay);
  const benchPerDay = num(benchmark.cadence?.authoredPerActiveDay);
  if (ownPerDay && benchPerDay) {
    const ratio = benchPerDay / ownPerDay;
    if (Math.abs(ratio - 1) >= MIN_IMPACT) {
      gaps.push({
        id: 'volume',
        dimension: 'cadence',
        unit: 'perDay',
        headline: ratio > 1
          ? `Publishes ${round2(ratio)}× more authored posts per active day`
          : `Publishes ${round2(1 / ratio)}× fewer authored posts per active day`,
        own: ownPerDay,
        benchmark: benchPerDay,
        delta: round2(benchPerDay - ownPerDay),
        impact: round4(ratio - 1),
        confidence: confidenceFor(own.cadence?.activeDays, benchmark.cadence?.activeDays),
        evidence: { ownActiveDays: own.cadence?.activeDays ?? null, benchmarkActiveDays: benchmark.cadence?.activeDays ?? null },
      });
    }
  }

  // ---- authored share / stranger eligibility -----------------------------
  // Where the volume gap comes from. Retweets and replies occupy a posting
  // slot but cannot reach a non-follower, so an account that is mostly those
  // is spending its output on an audience it already has.
  const ownAuthShare = num(own.authoredShare);
  const benchAuthShare = num(benchmark.authoredShare);
  if (ownAuthShare != null && benchAuthShare != null
    && benchAuthShare - ownAuthShare >= MIN_SHARE_DELTA_PP) {
    // Expressed in the same unit as the volume gap, because it is the cheap
    // half of it: reallocating existing retweet slots to authored posts raises
    // authored output per day without publishing any more often than today.
    const ownTotalPerDay = num(own.cadence?.postsPerActiveDay);
    const reallocatedPerDay = ownTotalPerDay != null ? ownTotalPerDay * (benchAuthShare / 100) : null;
    const reallocRatio = reallocatedPerDay != null && ownPerDay ? reallocatedPerDay / ownPerDay : null;
    gaps.push({
      id: 'authored-share',
      dimension: 'composition',
      unit: 'perDay',
      headline: reallocRatio
        ? `${round2(benchAuthShare)}% of the benchmark's output is authored against ${round2(ownAuthShare)}% — reallocating existing slots alone is ${round2(reallocRatio)}× your authored output, at today's posting frequency`
        : `${round2(benchAuthShare)}% of the benchmark's output is authored, against ${round2(ownAuthShare)}%`,
      own: ownAuthShare,
      benchmark: benchAuthShare,
      delta: round2(benchAuthShare - ownAuthShare),
      impact: reallocRatio != null ? round4(reallocRatio - 1) : 0,
      confidence: confidenceFor(own.posts, benchmark.posts),
      evidence: {
        ownRetweets: own.retweets ?? null,
        benchmarkRetweets: benchmark.retweets ?? null,
        ownStrangerEligibleShare: own.strangerEligibleShare ?? null,
        benchmarkStrangerEligibleShare: benchmark.strangerEligibleShare ?? null,
      },
    });
  }

  // ---- cadence shape -----------------------------------------------------
  // Reported as a finding, not a lever. The measured result was that the
  // benchmark is DENSER per occupied hour, which is what killed the earlier
  // "spread your posts out" inference — Author Diversity decays same-author
  // posts inside a ranked session, not inside a clock hour.
  const ownPerHour = num(own.cadence?.postsPerOccupiedHour);
  const benchPerHour = num(benchmark.cadence?.postsPerOccupiedHour);
  if (ownPerHour && benchPerHour) {
    gaps.push({
      id: 'hour-density',
      dimension: 'cadence',
      unit: 'shape',
      headline: benchPerHour >= ownPerHour
        ? `Benchmark is denser per occupied hour (${benchPerHour} vs ${ownPerHour}) — spacing is not the lever, volume is`
        : `Benchmark is sparser per occupied hour (${benchPerHour} vs ${ownPerHour})`,
      own: ownPerHour,
      benchmark: benchPerHour,
      delta: round2(benchPerHour - ownPerHour),
      impact: 0,
      confidence: confidenceFor(own.cadence?.occupiedHours, benchmark.cadence?.occupiedHours),
      evidence: {
        ownOccupiedHoursPerDay: own.cadence?.occupiedHoursPerDay ?? null,
        benchmarkOccupiedHoursPerDay: benchmark.cadence?.occupiedHoursPerDay ?? null,
        ownBusiestHour: own.cadence?.busiestHour ?? null,
        benchmarkBusiestHour: benchmark.cadence?.busiestHour ?? null,
      },
    });
  }

  // ---- type mix ----------------------------------------------------------
  // Expected per-post engagement under each account's mix, using one shared
  // lift map so the two sums are directly comparable.
  const types = [...new Set([...Object.keys(own.byType ?? {}), ...Object.keys(benchmark.byType ?? {})])];
  const liftMap = new Map();
  for (const type of types) liftMap.set(type, resolveLift(type, own, benchmark));

  let expectedNow = 0;
  for (const type of types) {
    const { lift } = liftMap.get(type);
    if (lift == null) continue;
    expectedNow += (shareOf(own, type) / 100) * lift;
  }

  // Target mix = the account's current shares, with ONLY the actionable types
  // moved to the benchmark's share, then renormalized to 100%. Types marked
  // `hold` or `investigate` stay where they are, which is the whole point:
  // the projection reflects the moves the comparison actually supports, not a
  // blind copy of the benchmark's shape.
  const targetShares = new Map();
  for (const type of types) {
    const ownShare = shareOf(own, type);
    const benchShare = shareOf(benchmark, type);
    const { lift } = liftMap.get(type);
    const deltaPP = benchShare - ownShare;
    const actionable = lift != null
      && Math.abs(deltaPP) >= MIN_SHARE_DELTA_PP
      && ['increase', 'decrease'].includes(mixDirection(deltaPP, lift, expectedNow));
    targetShares.set(type, actionable ? benchShare : ownShare);
  }
  const targetTotal = [...targetShares.values()].reduce((a, b) => a + b, 0);
  let expectedTarget = 0;
  if (targetTotal > 0) {
    for (const type of types) {
      const { lift } = liftMap.get(type);
      if (lift == null) continue;
      expectedTarget += ((targetShares.get(type) / targetTotal)) * lift;
    }
  }
  const mixMultiplier = expectedNow > 0 && targetTotal > 0 ? expectedTarget / expectedNow : null;

  for (const type of types) {
    const ownShare = shareOf(own, type);
    const benchShare = shareOf(benchmark, type);
    const deltaPP = benchShare - ownShare;
    if (Math.abs(deltaPP) < MIN_SHARE_DELTA_PP) continue;

    const { lift, source, n: liftN } = liftMap.get(type);
    if (lift == null) continue;

    const direction = mixDirection(deltaPP, lift, expectedNow);
    const actionable = direction === 'increase' || direction === 'decrease';
    // What moving this type alone to the benchmark's share would do to
    // expected per-post engagement, holding everything else fixed. Zero for
    // non-actionable directions — see mixDirection().
    const impact = actionable && expectedNow > 0
      ? Math.abs(((deltaPP / 100) * (lift - expectedNow)) / expectedNow)
      : 0;
    if (actionable && impact < MIN_IMPACT) continue;

    const ownCell = own.byType?.[type] ?? {};
    const benchCell = benchmark.byType?.[type] ?? {};
    const headline = {
      increase: `Under-posts ${type} — ${round2(ownShare)}% of authored output against ${round2(benchShare)}%, and yours earns ${lift}× your own average`,
      decrease: `Over-posts ${type} — ${round2(ownShare)}% against ${round2(benchShare)}%, and yours earns only ${lift}× your own average`,
      investigate: `Benchmark leans on ${type} (${round2(benchShare)}% against your ${round2(ownShare)}%) but yours earns ${lift}× your average — an execution question, not a mix one`,
      hold: `You post more ${type} than the benchmark (${round2(ownShare)}% against ${round2(benchShare)}%) and it is one of your stronger types at ${lift}× — keep it`,
    }[direction];

    gaps.push({
      id: `type-mix:${type}`,
      dimension: 'type-mix',
      unit: 'perPost',
      direction,
      headline,
      own: ownShare,
      benchmark: benchShare,
      delta: round2(deltaPP),
      lift,
      liftSource: source,
      impact: round4(impact),
      confidence: source === 'own' ? confidenceFor(ownCell.n, benchCell.n) : 'low',
      evidence: {
        ownN: ownCell.n ?? 0,
        benchmarkN: benchCell.n ?? 0,
        liftFromN: liftN,
        ownAvgLikes: ownCell.avgLikes ?? null,
        ownPooledER: ownCell.pooledER ?? null,
      },
    });
  }

  // ---- media within type -------------------------------------------------
  // Only inside a type, because type and media are confounded. The benchmark
  // finding this encodes: video out-reaches image inside the same post type.
  for (const type of types) {
    const benchCell = benchmark.mediaWithinType?.[type];
    const ownCell = own.mediaWithinType?.[type];
    if (!isObj(benchCell)) continue;
    const best = Object.entries(benchCell)
      .filter(([kind, v]) => kind !== 'none' && (v.n ?? 0) >= MIN_CLASS_N && num(v.liftWithinType) != null)
      .sort((a, b) => b[1].liftWithinType - a[1].liftWithinType)[0];
    if (!best) continue;
    const [kind, benchMedia] = best;
    if (benchMedia.liftWithinType < 1 + MIN_IMPACT) continue;

    const ownMedia = isObj(ownCell) ? ownCell[kind] : null;
    const ownN = ownMedia?.n ?? 0;
    const ownTypeN = own.byType?.[type]?.n ?? 0;
    const ownShare = ownTypeN ? (ownN / ownTypeN) * 100 : 0;
    const benchTypeN = benchmark.byType?.[type]?.n ?? 0;
    const benchShare = benchTypeN ? ((benchMedia.n ?? 0) / benchTypeN) * 100 : 0;
    if (benchShare - ownShare < MIN_SHARE_DELTA_PP) continue;

    gaps.push({
      id: `media:${type}:${kind}`,
      dimension: 'media',
      unit: 'perPost',
      headline: `Uses ${kind} on ${round2(ownShare)}% of ${type} posts against ${round2(benchShare)}%, where it earns ${benchMedia.liftWithinType}× that type's average`,
      own: round2(ownShare),
      benchmark: round2(benchShare),
      delta: round2(benchShare - ownShare),
      lift: benchMedia.liftWithinType,
      liftSource: 'benchmark',
      impact: round4(((benchShare - ownShare) / 100) * (benchMedia.liftWithinType - 1)),
      confidence: confidenceFor(ownN, benchMedia.n),
      evidence: { ownN, benchmarkN: benchMedia.n ?? 0, ownTypeN, benchmarkTypeN: benchTypeN },
    });
  }

  // ---- copy length -------------------------------------------------------
  // Against the band the benchmark's OWN best posts of that type occupy.
  for (const type of types) {
    const band = benchmark.lengthByType?.[type]?.topQuartile;
    const ownLen = own.lengthByType?.[type];
    if (!isObj(band) || !isObj(ownLen)) continue;
    if ((band.n ?? 0) < MIN_CLASS_N || num(ownLen.median) == null) continue;
    if (num(band.p10) == null || num(band.p90) == null) continue;
    if (ownLen.median >= band.p10 && ownLen.median <= band.p90) continue;

    const over = ownLen.median > band.p90;
    gaps.push({
      id: `length:${type}`,
      dimension: 'copy',
      unit: 'shape',
      headline: `${type} copy runs ${over ? 'longer' : 'shorter'} than the band the benchmark's best ${type}s occupy (${ownLen.median} chars against ${band.p10}–${band.p90}, median ${band.median})`,
      own: ownLen.median,
      benchmark: band.median,
      delta: round2(ownLen.median - band.median),
      impact: 0,
      confidence: confidenceFor(ownLen.n, band.n),
      evidence: { ownN: ownLen.n, benchmarkTopQuartileN: band.n, band: { p10: band.p10, p90: band.p90 } },
    });
  }

  // ---- topics ------------------------------------------------------------
  // The benchmark's high-lift topics that the account barely touches. A vein,
  // not an instruction: whether the account can credibly occupy it is a human
  // call, which is why these are reported as `shape` with zero modelled impact.
  const ownVocab = new Set(Object.keys(own.byTopic ?? {}));
  const benchVocab = Object.keys(benchmark.byTopic ?? {});
  const sharedLabels = benchVocab.filter((t) => ownVocab.has(t)).length;
  const vocabOverlap = benchVocab.length ? sharedLabels / benchVocab.length : 0;
  const topicsComparable = vocabOverlap >= MIN_TOPIC_VOCAB_OVERLAP;
  if (!topicsComparable && benchVocab.length) {
    warnings.push(
      `Topic comparison suppressed: the two corpora share ${sharedLabels} of ${benchVocab.length} topic labels (${Math.round(vocabOverlap * 100)}%). Topic labels come from a per-account tagger, so a benchmark topic showing 0% of your output would describe the tagger, not the account.`,
    );
  }

  const benchTopics = topicsComparable
    ? Object.entries(benchmark.byTopic ?? {})
      .filter(([, v]) => (v.n ?? 0) >= MIN_CLASS_N && num(v.lift) != null && v.lift > 1)
      .sort((a, b) => b[1].lift - a[1].lift)
      .slice(0, 5)
    : [];
  for (const [topic, benchCell] of benchTopics) {
    const ownCell = own.byTopic?.[topic];
    const ownShare = num(ownCell?.share) ?? 0;
    if (benchCell.share - ownShare < MIN_SHARE_DELTA_PP) continue;
    gaps.push({
      id: `topic:${topic}`,
      dimension: 'topic',
      unit: 'shape',
      headline: `Benchmark's "${topic}" posts earn ${benchCell.lift}× its average across ${benchCell.n} posts; it is ${round2(ownShare)}% of your authored output against ${round2(benchCell.share)}%`,
      own: ownShare,
      benchmark: benchCell.share,
      delta: round2(benchCell.share - ownShare),
      lift: benchCell.lift,
      liftSource: 'benchmark',
      impact: 0,
      confidence: confidenceFor(ownCell?.n ?? 0, benchCell.n),
      evidence: { ownN: ownCell?.n ?? 0, benchmarkN: benchCell.n },
    });
  }

  gaps.sort((a, b) => Math.abs(b.impact ?? 0) - Math.abs(a.impact ?? 0));

  const volumeRatio = ownPerDay && benchPerDay ? benchPerDay / ownPerDay : null;
  const projection = {
    // Expected per-post engagement after making only the ACTIONABLE mix moves
    // (see mixDirection), measured in multiples of the account's current
    // average and computed from its own per-type performance wherever that
    // exists. A value of 1 means the comparison supports no mix change.
    mixMultiplier: round2(mixMultiplier),
    // Pure output ratio. NOT a reach multiplier.
    volumeRatio: round2(volumeRatio),
    combined: round2(mixMultiplier != null && volumeRatio != null ? mixMultiplier * volumeRatio : null),
    caveat:
      'combined = mixMultiplier × volumeRatio assumes per-post performance holds as volume rises. It usually does not: more posts per day compete for the same followers and the marginal post tends to earn less. Treat it as a ceiling, not a forecast.',
    liftBasis: own.base?.liftBasis ?? 'avgLikes',
  };

  return {
    ownHandle: own.handle ?? null,
    benchmarkHandle: benchmark.handle ?? null,
    warnings,
    gaps,
    projection,
  };
}
