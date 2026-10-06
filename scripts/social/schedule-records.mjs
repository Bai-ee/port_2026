// Schedule story-ready Discogs record drafts into the C1 slots (09:00 / 19:00 CT).
// Usage: node --env-file=.env.local scripts/social/schedule-records.mjs [--dry-run] [--per-day=1|2]
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
