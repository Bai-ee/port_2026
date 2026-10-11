// Read-only smoke: parse a real Facebook export with the facebook-html adapter and print counts.
// Usage: node scripts/social-archive/smoke-facebook.mjs [dir]   (never writes anywhere)
import { readerFromDir } from '../../features/social-archive/fs-reader.js';
import { ADAPTER, detect, parse } from '../../features/social-archive/adapters/facebook.js';

const dir = process.argv[2] || '/Volumes/Public/Bryan/Facebook Downloads/facebook-HousepitCHI';
const reader = readerFromDir(dir);
console.log(`adapter=${ADAPTER} dir=${dir} detect=${detect(reader)}`);
const { entries, stats, warnings } = parse({ reader, account: 'Housepit CHI', archiveName: 'facebook-HousepitCHI' });
const sorted = [...entries].sort((a, b) => a.ts.localeCompare(b.ts));
console.log('entries:', stats.entries, 'byKind:', JSON.stringify(stats.byKind), 'withMedia:', stats.withMedia);
console.log('skipped:', JSON.stringify(stats.skipped));
console.log('range:', sorted[0]?.ts, '->', sorted[sorted.length - 1]?.ts);
console.log('warnings:', warnings.length ? warnings : 'none');
const pick = [sorted.find((e) => e.kind === 'post' && e.text), sorted.find((e) => e.kind === 'media'), sorted.find((e) => e.kind === 'event')].filter(Boolean);
for (const e of pick) {
  console.log(`- [${e.kind}] ${e.ts} ${e.tsSource} media=${e.media.length}${e.album ? ` album="${e.album.slice(0, 40)}"` : ''}${e.place ? ` place="${e.place.slice(0, 40)}"` : ''} text="${e.text.replace(/\s+/g, ' ').slice(0, 80)}"`);
}
