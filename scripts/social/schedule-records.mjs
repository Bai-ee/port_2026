// Schedule story-ready Discogs record drafts, quota-aware (engine 'record'): prefers 09:00 / 19:00 CT,
// falls back to the nearest valid time in 08:00-21:00 CT; honors daily cap, share cap, 120 min spacing, entity cooldown.
// Prints per-record reasons (plan[].reason, skipped[].reasons).
// Usage: node --env-file=.env.local scripts/social/schedule-records.mjs [--dry-run] [--per-day=1|2]
// --per-day defaults to engines.record.targetPerDay (1), clamped to engines.record.maxPerDay.
// Never posts to X. Uses firebase-admin through the existing service modules.
import { discogsClientId } from '../../features/discogs-ingest/service.js';
import { scheduleReadyRecords } from '../../features/discogs-ingest/scheduler.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const perDayArg = args.find((a) => a.startsWith('--per-day='));
const config = perDayArg ? { perDay: Number(perDayArg.split('=')[1]) || 1 } : {};

const result = await scheduleReadyRecords({ clientId: discogsClientId(), dryRun, config });
console.log(JSON.stringify(result, null, 2));
process.exit(result.errors.length ? 1 : 0);
