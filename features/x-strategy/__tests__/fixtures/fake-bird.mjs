#!/usr/bin/env node
// Fake `bird` for the ingest golden test. Serves the deterministic fixture pages by cursor.
// FAKE_BIRD_FAIL_ON=<cursor|first> makes that page exit 1 with "boom" on stderr.
import { makePages } from './timeline-fixture.js';
const argv = process.argv.slice(2);
const ci = argv.indexOf('--cursor');
const cursor = ci === -1 ? null : argv[ci + 1];
const failOn = process.env.FAKE_BIRD_FAIL_ON;
if (failOn && (failOn === (cursor || 'first'))) { process.stderr.write('boom\n'); process.exit(1); }
const pages = makePages();
const idx = cursor ? Number(cursor.slice(1)) : 0;
process.stdout.write(`some banner line\n${JSON.stringify(pages[idx])}\n`);
