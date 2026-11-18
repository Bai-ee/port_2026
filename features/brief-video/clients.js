// dashboard client id -> Remotion videoClient for the daily brief video. Own module (no heavy imports) so the
// worker route, tests and dry-run share it. Adding a client here is the allowlist; DAILY_BRIEF_VIDEO_ENABLED gates the cron.
export const DAILY_BRIEF_VIDEO_CLIENTS = Object.freeze({ 'paradice-dbBQCHUX': 'critters-quest' });

// Bump when the render template changes so a re-render gets a fresh idempotent jobId.
export const TEMPLATE_VERSION = 'cq-briefcut-1';

export const BRIEF_VIDEO_JOBS = 'brief_video_jobs';
export const BRIEF_VIDEO_STATE = 'showcase_state';
export const MAX_ATTEMPTS = 2;
export const MAX_RENDERS_PER_DAY = 10;
export const LOOKAHEAD_DAYS = 7;
export const ACTIVE_MAX_MS = 20 * 60 * 1000;
export const REPOKE_AFTER_MS = 60 * 1000;

// CQ-HowTo briefs (`howto=<id>`): gated by CQ_HOWTO_ENABLED=true. No howto render is started for a post whose reviewOn is later.
export const HOWTO_TEMPLATE_VERSION = 'cq-howto-1';
export const HOWTO_CAMPAIGN_UNTIL = '2026-12-17';
export const HOWTO_REQUESTS = 'howto_requests';
export const HOWTO_STATUS_WRITES_PER_TICK = 5;
export const howtoEnabled = (env = process.env) => env?.CQ_HOWTO_ENABLED === 'true';
