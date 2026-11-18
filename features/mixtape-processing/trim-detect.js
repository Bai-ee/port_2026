/**
 * Mixtape trim detection. Pure: takes per-window dB levels, returns what to keep.
 * No I/O and no node builtins, so it runs anywhere and tests with synthetic arrays.
 */

export const DETECTOR_VERSION = 2;

export const DEFAULT_PARAMS = {
  windowMs: 100, // window size of input dB array
  dbClamp: -120, // clamp window dB below this
  floorSustainS: 3, // floor = min of sliding 3 s median of window dB
  contentAboveFloorDb: 10, // content windows = dB > floor+10; contentDb = median of those
  contentMinusDb: 30, // threshold = max(contentDb-30, floorDb+10)
  floorPlusDb: 10,
  gapFloorPlusDb: 6, // a gap is cut-eligible only while dB < floor+6 (hysteresis)
  gapKeepS: 4, // inactive gaps shorter than this are bridged (kept)
  gapCutS: 6, // interior gap must be >= 6 s below floor+6 to be cut
  headTailMinRunS: 30, // first/last kept run must be >= 30 s ("came on and stayed on")
  islandMinRunS: 10, // interior islands must be >= 10 s
  fadeExtendFloorPlusDb: 4, // extend each kept boundary outward until dB < floor+4
  fadeExtendMaxS: 15,
  padHeadTailS: 1.0,
  padInteriorS: 0.5,
  fadeMs: 50,
  endFadeOutS: 5, // render: fade out the last kept segment over this many seconds (0 disables)
  endFadeCurve: 'tri', // ffmpeg afade curve for the end fade
  lowHeadroomDb: 25, // contentDb-floorDb < 25 -> LOW_HEADROOM: head/tail trim only, no interior cuts
  noiseMinS: 3,
  noiseEdgeExcludeS: 0.5,
  noiseMaxAboveFloorDb: 3,
  manyCutsN: 4,
  cutCeilingDb: -50, // absolute: nothing at or above this is ever cut, and a floor above it means no trim
  stationaryStdDb: 0.3, // stationary window: std of dB over the centred span is below this ...
  stationaryDiffDb: 0.15, // ... and mean |dB step| is below this
  stationarySpanS: 5, // centred span used to judge a window stationary
  stationaryMinS: 10, // a stationary run this long and above cutCeilingDb is non-program buzz
};

// Interior floor (hiss between first and last audio) replaces the global floor only when the tape
// has a much quieter lead-in/out (leader, digital silence) AND the interior hiss really is quiet.
const INTERIOR_FLOOR_MIN_HEADROOM_DB = 35;
const STATIONARY_REFINE_DB = 1; // buzz boundary: first window within this of the run median

/**
 * Loud stationary buzz (a flat, dead-steady level above cutCeilingDb) is non-program: dB flat to
 * hundredths over many seconds, unlike music. Returns a per-window mask plus the runs.
 * Quiet stationary stretches (digital silence, steady hiss) are left to the normal floor logic.
 */
function findBuzz(db, p) {
  const n = db.length;
  const mask = new Uint8Array(n);
  const runs = [];
  // Flag windows on a 5 s centred span (cheap, local), then refine each run outward to >= stationaryMinS.
  const half = Math.max(1, Math.round((p.stationarySpanS * 1000) / p.windowMs / 2));
  const minWin = Math.round((p.stationaryMinS * 1000) / p.windowMs);
  if (n < 2 * half) return { mask, runs };
  const s1 = new Float64Array(n + 1);
  const s2 = new Float64Array(n + 1);
  const sd = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    s1[i + 1] = s1[i] + db[i];
    s2[i + 1] = s2[i] + db[i] * db[i];
    sd[i + 1] = sd[i] + (i > 0 ? Math.abs(db[i] - db[i - 1]) : 0);
  }
  const flag = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n, i + half);
    const cnt = hi - lo;
    if (cnt < half) continue;
    const mean = (s1[hi] - s1[lo]) / cnt;
    const variance = Math.max(0, (s2[hi] - s2[lo]) / cnt - mean * mean);
    const meanStep = (sd[hi] - sd[lo + 1]) / (cnt - 1);
    if (Math.sqrt(variance) < p.stationaryStdDb && meanStep < p.stationaryDiffDb) flag[i] = 1;
  }
  let prevEnd = 0;
  for (let i = 0; i < n; ) {
    if (!flag[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && flag[j]) j++;
    if (j - i >= minWin / 2) {
      const med = median(db.subarray(i, j));
      if (med >= p.cutCeilingDb) {
        let a = i;
        let b = j;
        while (a > prevEnd && Math.abs(db[a - 1] - med) < STATIONARY_REFINE_DB) a--;
        while (b < n && Math.abs(db[b] - med) < STATIONARY_REFINE_DB) b++;
        if (b - a >= minWin) {
          runs.push({ a, b });
          mask.fill(1, a, b);
          prevEnd = b;
          i = b;
          continue;
        }
      }
    }
    i = j;
  }
  return { mask, runs };
}

const FLOOR_LOOKAHEAD_S = 30; // outward region used to find the local floor at a fade boundary
const LEADER_BELOW_HISS_DB = 6; // cut windows this far under the hiss level are leader, not hiss

const round3 = (x) => Math.round(x * 1000) / 1000;
const round2 = (x) => Math.round(x * 100) / 100;

function median(values) {
  const a = Float64Array.from(values).sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function percentile(values, q) {
  const a = Float64Array.from(values).sort();
  return a[Math.floor(q * (a.length - 1))];
}

/** Lowest sliding-window median over db[from, to). Short regions use their whole median. */
function minSlidingMedian(db, from, to, win) {
  if (to <= from) return null;
  if (to - from <= win) return median(db.subarray(from, to));
  let best = Infinity;
  for (let i = from; i + win <= to; i++) {
    const m = median(db.subarray(i, i + win));
    if (m < best) best = m;
  }
  return best;
}

/**
 * @param {Float32Array|number[]} windowsDb  per-window RMS dBFS (max of L/R), windowMs apart
 * @param {object} [params]  merged over DEFAULT_PARAMS
 * @param {{ leaderEndS?: number }} [hints]
 * @returns {{
 *   detectorVersion, params, durationS,
 *   floorDb (effective), rawFloorDb (global), contentDb, thresholdDb,
 *   keep: Array<{ startS, endS }>,
 *   cuts: Array<{ startS, endS, kind: 'head'|'tail'|'gap', reason }>,
 *   droppedIslands: Array<{ startS, endS, reason }>,
 *   noiseSample: { startS, endS } | null,
 *   flags: string[]  // also NO_SUSTAINED_RUN, NO_HISS_FLOOR, STATIONARY_NOISE
 * }}
 */
export function detectTrim(windowsDb, params = {}, hints = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const n = windowsDb.length;
  const db = Float64Array.from(windowsDb, (v) =>
    Number.isFinite(v) ? Math.max(v, p.dbClamp) : p.dbClamp,
  );
  const sec = (i) => round3((i * p.windowMs) / 1000);
  const win = (s) => Math.round((s * 1000) / p.windowMs);
  const durationS = sec(n);

  const result = {
    detectorVersion: DETECTOR_VERSION,
    params: p,
    durationS,
    floorDb: null,
    rawFloorDb: null,
    contentDb: null,
    thresholdDb: null,
    keep: [],
    cuts: [],
    droppedIslands: [],
    noiseSample: null,
    flags: [],
  };
  if (n === 0) {
    result.flags.push('ALL_SILENT');
    return result;
  }

  // 0. Loud stationary buzz is non-program. Floor / headroom decisions ignore it.
  let { mask: buzz, runs: buzzRuns } = findBuzz(db, p);
  let nb = db;
  if (buzzRuns.length) {
    nb = db.filter((_, i) => !buzz[i]);
    if (!nb.length) {
      buzz = new Uint8Array(n);
      buzzRuns = [];
      nb = db;
    }
  }
  if (buzzRuns.length) result.flags.push('STATIONARY_NOISE');

  // 1. Floor, content level, threshold.
  const floorWin = Math.max(1, win(p.floorSustainS));
  const rawFloorDb = minSlidingMedian(nb, 0, nb.length, floorWin);
  result.rawFloorDb = round2(rawFloorDb);
  result.floorDb = result.rawFloorDb;
  const digitalFloor = rawFloorDb < -90;

  // Floor guard: a floor above the cut ceiling means nothing here is quiet enough to be silence.
  const ceilDb = p.cutCeilingDb;
  const buzzStats = (aS, bS) => {
    const vals = [];
    const a = win(aS);
    const b = win(bS);
    for (let i = a; i < b; i++) if (buzz[i]) vals.push(db[i]);
    if (!vals.length) return {};
    const med = median(vals);
    const sd = Math.sqrt(vals.reduce((t, v) => t + (v - med) * (v - med), 0) / vals.length);
    return { medianDb: round2(med), stdDb: round2(sd) };
  };
  // Cuts are the complement of keep. A cut that is mostly buzz says so and carries its level stats.
  const pushCutsFromKeep = (keep) => {
    const cutReason = (aS, bS, fallback) => {
      const a = win(aS);
      const b = win(bS);
      let cnt = 0;
      for (let i = a; i < b; i++) cnt += buzz[i];
      return b > a && cnt * 2 >= b - a ? 'stationary buzz' : fallback;
    };
    const add = (startS, endS, kind, fallback) => {
      const reason = cutReason(startS, endS, fallback);
      const cut = { startS, endS, kind, reason };
      if (reason === 'stationary buzz') {
        Object.assign(cut, buzzStats(startS, endS));
        if (kind === 'gap' && !result.flags.includes('STATIONARY_GAP')) result.flags.push('STATIONARY_GAP');
      }
      result.cuts.push(cut);
    };
    if (!keep.length) return add(0, durationS, 'head', 'no audio kept');
    if (keep[0].startS > 0) add(0, keep[0].startS, 'head', 'before audio that stays on');
    for (let k = 1; k < keep.length; k++) {
      const len = round3(keep[k].startS - keep[k - 1].endS);
      add(keep[k - 1].endS, keep[k].startS, 'gap', `silent gap of ${len} s`);
    }
    const tailEnd = keep[keep.length - 1].endS;
    if (tailEnd < durationS) add(tailEnd, durationS, 'tail', 'after last audio that stays on');
  };
  // No hiss to trim: keep everything except any buzz runs.
  const keepAll = () => {
    result.flags.push('NO_NOISE_SAMPLE');
    if (!buzzRuns.length) {
      result.keep = [{ startS: 0, endS: durationS }];
      result.flags.push('NO_TRIM');
      return;
    }
    // Segments between buzz runs touch buzz on every side; short ones are buzz debris, not program.
    const segs = [];
    let cur = 0;
    for (const r of buzzRuns) {
      if (r.a > cur) segs.push({ a: cur, b: r.a });
      cur = r.b;
    }
    if (cur < n) segs.push({ a: cur, b: n });
    for (const g of segs) {
      const edge = g.a === 0 || g.b === n;
      const minWin = win(edge ? p.headTailMinRunS : p.islandMinRunS);
      if (g.b - g.a >= minWin) result.keep.push({ startS: sec(g.a), endS: sec(g.b) });
      else {
        result.droppedIslands.push({ startS: sec(g.a), endS: sec(g.b), reason: 'short segment adjacent to stationary buzz' });
      }
    }
    // Cuts are the complement of keep (a dropped segment merges into the buzz cut around it).
    pushCutsFromKeep(result.keep);
  };
  if (rawFloorDb > ceilDb) {
    keepAll();
    result.flags.push('NO_HISS_FLOOR');
    return result;
  }

  const contentAbove = (fl) => {
    const vals = [];
    for (const v of nb) if (v > fl + p.contentAboveFloorDb) vals.push(v);
    return vals;
  };
  let contentVals = contentAbove(rawFloorDb);
  if (contentVals.length < floorWin) {
    result.flags.push('ALL_SILENT');
    if (digitalFloor) result.flags.push('DIGITAL_SILENCE_FLOOR');
    return result;
  }

  let floorDb = rawFloorDb;
  let contentDb = median(contentVals);
  let thresholdDb = Math.max(contentDb - p.contentMinusDb, floorDb + p.floorPlusDb);

  // Interior floor: a quiet leader or digital silence can drag the global floor far below the
  // real hiss. Judge hiss between first and last audible window instead, when clearly justified.
  let firstOn = -1;
  let lastOn = -1;
  for (let i = 0; i < nb.length; i++) {
    if (nb[i] >= thresholdDb) {
      if (firstOn < 0) firstOn = i;
      lastOn = i;
    }
  }
  if (firstOn >= 0) {
    const interiorFloor = minSlidingMedian(nb, firstOn, lastOn + 1, floorWin);
    if (contentDb - interiorFloor >= INTERIOR_FLOOR_MIN_HEADROOM_DB && interiorFloor <= ceilDb) {
      const eff = Math.max(rawFloorDb, interiorFloor);
      const vals = contentAbove(eff);
      if (eff > rawFloorDb && vals.length >= floorWin) {
        floorDb = eff;
        contentVals = vals;
        contentDb = median(vals);
        thresholdDb = Math.max(contentDb - p.contentMinusDb, floorDb + p.floorPlusDb);
      }
    }
  }
  result.floorDb = round2(floorDb);
  result.contentDb = round2(contentDb);
  result.thresholdDb = round2(thresholdDb);

  // Too little headroom to tell hiss from program: trim nothing.
  if (contentDb - floorDb < p.lowHeadroomDb) {
    keepAll();
    result.flags.push('LOW_HEADROOM');
    if (digitalFloor) result.flags.push('DIGITAL_SILENCE_FLOOR');
    return result;
  }

  // 2. Splitters: stretches below floor+6 lasting at least gapKeepS. Everything between
  // two splitters is a run. Dips that are shorter or louder never split anything.
  const quietCeil = Math.min(floorDb + p.gapFloorPlusDb, ceilDb);
  const keepMinWin = win(p.gapKeepS);
  const cutMinWin = win(p.gapCutS);
  const splitters = [];
  for (let i = 0; i < n; ) {
    if (!buzz[i] && db[i] >= quietCeil) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && (buzz[j] || db[j] < quietCeil)) j++;
    if (j - i >= keepMinWin) splitters.push({ a: i, b: j });
    i = j;
  }

  const runs = [];
  const addRun = (a, b) => {
    let first = -1;
    let last = -1;
    for (let i = a; i < b; i++) {
      if (!buzz[i] && db[i] >= thresholdDb) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first >= 0) runs.push({ a, b, first, last, span: last - first + 1 });
  };
  let cursor = 0;
  for (const s of splitters) {
    addRun(cursor, s.a);
    cursor = s.b;
  }
  addRun(cursor, n);

  // 3. Head/tail: first/last run that came on and stayed on. Shorter runs outside are dropped.
  const longest = Math.max(...runs.map((r) => r.span));
  const minRunWin = Math.min(win(p.headTailMinRunS), longest);
  // Nothing came on and stayed on: keep the fallback result but flag it for the caller.
  if (longest < win(p.headTailMinRunS)) result.flags.push('NO_SUSTAINED_RUN');
  const headIdx = runs.findIndex((r) => r.span >= minRunWin);
  let tailIdx = runs.length - 1;
  while (runs[tailIdx].span < minRunWin) tailIdx--;

  const dropRun = (r, reason) =>
    result.droppedIslands.push({ startS: sec(r.first), endS: sec(r.last + 1), reason });
  runs.slice(0, headIdx).forEach((r) => dropRun(r, `before head: run shorter than ${p.headTailMinRunS} s`));
  runs.slice(tailIdx + 1).forEach((r) => dropRun(r, `after tail: run shorter than ${p.headTailMinRunS} s`));

  // Group the runs between head and tail; a gap only separates groups if it holds a cut-eligible splitter.
  const gapCuttable = (from, to) =>
    splitters.some((s) => s.a >= from && s.b <= to && s.b - s.a >= cutMinWin);
  let groups = [];
  for (const r of runs.slice(headIdx, tailIdx + 1)) {
    const prev = groups[groups.length - 1];
    if (prev && !gapCuttable(prev.runs[prev.runs.length - 1].b, r.a)) prev.runs.push(r);
    else groups.push({ runs: [r] });
  }

  // Interior islands too short to be music (handling noise, tape clicks) are dropped and listed.
  const islandMinWin = win(p.islandMinRunS);
  groups = groups.filter((g, gi) => {
    if (gi === 0 || gi === groups.length - 1) return true;
    const span = g.runs[g.runs.length - 1].last - g.runs[0].first + 1;
    if (span >= islandMinWin) return true;
    result.droppedIslands.push({
      startS: sec(g.runs[0].first),
      endS: sec(g.runs[g.runs.length - 1].last + 1),
      reason: `interior island shorter than ${p.islandMinRunS} s`,
    });
    return false;
  });

  // 4 + 5. Fade extension and padding, then merge and clamp.
  const lookWin = win(FLOOR_LOOKAHEAD_S);
  const maxExtWin = win(p.fadeExtendMaxS);
  const extendedEdge = (idx, dir) => {
    const region = dir < 0 ? [Math.max(0, idx - lookWin), idx] : [idx, Math.min(n, idx + lookWin)];
    const local = region[1] - region[0] >= floorWin ? minSlidingMedian(db, region[0], region[1], floorWin) : floorDb;
    const level = Math.max(floorDb, local) + p.fadeExtendFloorPlusDb;
    let i = idx;
    if (dir < 0) while (i > 0 && idx - i < maxExtWin && !buzz[i - 1] && db[i - 1] >= level) i--;
    else while (i < n && i - idx < maxExtWin && !buzz[i] && db[i] >= level) i++;
    // Cut ceiling: never leave a window at or above cutCeilingDb on the cut side of a boundary.
    if (dir < 0) while (i > 0 && !buzz[i - 1] && db[i - 1] >= ceilDb) i--;
    else while (i < n && !buzz[i] && db[i] >= ceilDb) i++;
    return i;
  };

  const last = groups.length - 1;
  const padded = groups.map((g, gi) => {
    const firstRun = g.runs[0];
    const lastRun = g.runs[g.runs.length - 1];
    const startIdx = gi === 0 ? firstRun.first : firstRun.a;
    const endIdx = gi === last ? lastRun.last + 1 : lastRun.b;
    const sIdx = extendedEdge(startIdx, -1);
    const eIdx = extendedEdge(endIdx, 1);
    // No padding into a buzz run: the cut starts exactly where the buzz does.
    const padStart = sIdx > 0 && buzz[sIdx - 1] ? 0 : gi === 0 ? p.padHeadTailS : p.padInteriorS;
    const padEnd = eIdx < n && buzz[eIdx] ? 0 : gi === last ? p.padHeadTailS : p.padInteriorS;
    return {
      startS: Math.max(0, round3(sec(sIdx) - padStart)),
      endS: Math.min(durationS, round3(sec(eIdx) + padEnd)),
    };
  });
  const keep = [];
  for (const seg of padded) {
    const prev = keep[keep.length - 1];
    if (prev && seg.startS <= prev.endS) prev.endS = Math.max(prev.endS, seg.endS);
    else keep.push({ ...seg });
  }
  result.keep = keep;

  pushCutsFromKeep(keep);

  // 7. Flags.
  if (keep.length === 1 && keep[0].startS === 0 && keep[0].endS === durationS) result.flags.push('NO_TRIM');
  if (result.cuts.filter((c) => c.kind === 'gap').length > p.manyCutsN) result.flags.push('MANY_CUTS');
  if (digitalFloor) result.flags.push('DIGITAL_SILENCE_FLOOR');

  // 8. Noise sample.
  result.noiseSample = pickNoiseSample(db, result.cuts, thresholdDb, p, hints, win, sec, buzz);
  if (!result.noiseSample) result.flags.push('NO_NOISE_SAMPLE');

  return result;
}

/**
 * Longest hiss-only stretch inside a cut region, for a later denoise profile.
 * Interior gaps first, then head, then tail. Leader (windows well under the hiss level, or before
 * hints.leaderEndS) is excluded. "Hiss-only" is judged against the region's own level, so a
 * leader quieter than the global floor cannot hide the hiss next to it.
 */
function pickNoiseSample(db, cuts, thresholdDb, p, hints, win, sec, buzz) {
  const regions = cuts.map((c) => ({ kind: c.kind, a: win(c.startS), b: win(c.endS) }));
  const quiet = [];
  for (const r of regions) for (let i = r.a; i < r.b; i++) if (!buzz[i] && db[i] < thresholdDb) quiet.push(db[i]);
  if (!quiet.length) return null;

  const hissRef = percentile(quiet, 0.75);
  const leaderEndWin = hints?.leaderEndS ? Math.ceil((hints.leaderEndS * 1000) / p.windowMs) : 0;
  const isLeader = (i) => buzz[i] || i < leaderEndWin || db[i] < hissRef - LEADER_BELOW_HISS_DB;
  const edgeWin = win(p.noiseEdgeExcludeS);
  const minWin = win(p.noiseMinS);

  const bestIn = (r) => {
    const usable = [];
    for (let i = r.a; i < r.b; i++) if (!isLeader(i)) usable.push(db[i]);
    if (!usable.length) return null;
    const limit = median(usable) + p.noiseMaxAboveFloorDb;
    let best = null;
    for (let i = r.a; i < r.b; ) {
      if (isLeader(i) || db[i] > limit) {
        i++;
        continue;
      }
      let j = i;
      while (j < r.b && !isLeader(j) && db[j] <= limit) j++;
      const a = i + edgeWin;
      const b = j - edgeWin;
      if (b - a >= minWin && (!best || b - a >= best.b - best.a)) best = { a, b };
      i = j;
    }
    return best;
  };

  for (const kind of ['gap', 'head', 'tail']) {
    let best = null;
    for (const r of regions.filter((x) => x.kind === kind)) {
      const c = bestIn(r);
      if (c && (!best || c.b - c.a > best.b - best.a)) best = c;
    }
    if (best) return { startS: sec(best.a), endS: sec(best.b) };
  }
  return null;
}
