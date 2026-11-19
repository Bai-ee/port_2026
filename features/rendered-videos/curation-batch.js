// Owner-triggered batch of random-artist remix renders (PAID GitHub Actions) for the curated review page.
// Jobs live under their OWN client id so they never touch the owner's mediaCaptures (last-40 cap), the digest/auto-post
// fresh-render picker, or the owner's clip anti-repeat lookback. The rendered-video sync reads the global EditVideos
// feed, so finished renders still appear on the review page. Pure planner; I/O is wired in the quote-targets route.

export const CURATION_BATCH_CLIENT_ID = 'ue-curation';
export const BATCH_MAX_PER_CLICK = 5;
export const BATCH_MAX_INFLIGHT = 5;
export const BATCH_MAX_PER_24H = 20;
export const BATCH_JOBS_LOOKBACK = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const INFLIGHT_STATUSES = new Set(['queued', 'processing']);
// A batch job's status only advances when something reconciles it (the 13:30 cron; nothing polls batch jobs), so a job
// counts as in flight only while it is young. Renders finish in ~5-15 min.
export const BATCH_INFLIGHT_WINDOW_MS = 30 * 60 * 1000;

const toMs = (v) => {
  if (typeof v === 'number') return v;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : NaN;
};

/**
 * jobs: listMediaJobs(CURATION_BATCH_CLIENT_ID, { type: 'video-remix', limit: BATCH_JOBS_LOOKBACK }) rows.
 * Returns { count, inflight, last24h, reason } where reason is 'inflight-full' | 'daily-cap' when count is 0.
 */
export function planBatch({ requested, jobs, now = Date.now() }) {
  const n = Math.floor(Number(requested));
  const want = Math.min(BATCH_MAX_PER_CLICK, Math.max(1, Number.isFinite(n) ? n : BATCH_MAX_PER_CLICK));
  const rows = (Array.isArray(jobs) ? jobs : []).filter((j) => j && (!j.clientId || j.clientId === CURATION_BATCH_CLIENT_ID) && (!j.type || j.type === 'video-remix'));
  const inflight = rows.filter((j) => { const t = toMs(j.createdAt); return INFLIGHT_STATUSES.has(j.status) && Number.isFinite(t) && now - t < BATCH_INFLIGHT_WINDOW_MS; }).length;
  const last24h = rows.filter((j) => { const t = toMs(j.createdAt); return Number.isFinite(t) && now - t < DAY_MS; }).length;
  const room = Math.min(BATCH_MAX_INFLIGHT - inflight, BATCH_MAX_PER_24H - last24h);
  const count = Math.max(0, Math.min(want, room));
  let reason = null;
  if (count === 0) reason = BATCH_MAX_PER_24H - last24h <= 0 ? 'daily-cap' : 'inflight-full';
  return { count, inflight, last24h, reason };
}
