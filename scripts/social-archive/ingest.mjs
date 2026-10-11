#!/usr/bin/env node
// Import a downloaded social archive (Facebook / X / Instagram export folder) into the living timeline.
// Default is a DRY RUN that prints the report and writes nothing; --write is the only way to write.
//
// Usage: node scripts/social-archive/ingest.mjs --platform facebook --account "Housepit CHI" \
//   --dir "/Volumes/Public/Bryan/Facebook Downloads/facebook-HousepitCHI" \
//   --archive-root-rel "Facebook Downloads/facebook-HousepitCHI" [--archive-name <n>] [--client <id>] [--write]
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readerFromDir } from '../../features/social-archive/fs-reader.js';
import { ingestArchive } from '../../features/social-archive/ingest.js';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const write = process.argv.includes('--write');

const platform = arg('--platform');
const account = arg('--account');
const dir = arg('--dir');
const archiveRootRel = arg('--archive-root-rel');
if (!platform || !account || !dir || !archiveRootRel) {
  console.error('Required: --platform <facebook|x|instagram> --account <name> --dir <export folder> --archive-root-rel <path relative to NAS source root>');
  process.exit(1);
}
const archiveName = arg('--archive-name', path.basename(path.resolve(dir)));

require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
const clientId = arg('--client', process.env.DISCOGS_X_CLIENT_ID || 'bryan-balli-WUoltG84');

const report = await ingestArchive({
  db: fb.adminDb, clientId, platform, account, archiveName, archiveRootRel,
  reader: readerFromDir(dir), dryRun: !write,
});

const lines = [
  `${report.dryRun ? 'DRY RUN (nothing written)' : 'WRITTEN'} · client ${clientId}`,
  `${report.platform} · ${report.account} · archive "${report.archiveName}"`,
  `entries: ${report.entries} (with media: ${report.withMedia}) · days: ${report.days}`,
  `range: ${report.firstTs || '-'} -> ${report.lastTs || '-'}`,
  `by kind: ${JSON.stringify(report.byKind)}`,
  `rejected: ${JSON.stringify(report.rejected)}`,
  `media: ${report.media.total} total · ${report.media.matched} matched · ${report.media.unmatched} unmatched`,
  ...(report.warnings.length ? ['warnings:', ...report.warnings.slice(0, 20).map((w) => `  - ${w}`)] : []),
  `unmatched sample (${report.unmatchedSample.length}):`,
  ...report.unmatchedSample.map((u) => `  ${u.entryId}  ${u.relPath}`),
];
console.log(lines.join('\n'));
if (report.dryRun) console.log('\nRe-run with --write to import.');
