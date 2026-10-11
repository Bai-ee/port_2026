// Golden capture of planSlots() BEFORE T5 (no typeCaps, no planMeta). node capture-planslots.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../../..');
const rd = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const { planSlots } = await import(path.join(ROOT, 'features/x-content-inventory/daily-loop/slots.js'));
const { buildDayPlan } = await import(path.join(ROOT, 'features/x-content-inventory/plan-day.js'));
const base = {
  corpusRows: rd('docs/audits/bai-ee-x-corpus.json'), benchmarkRows: rd('docs/audits/seb-design-x-corpus.json'),
  packages: rd('features/x-content-inventory/content-packages.json'), date: '2026-10-11', now: Date.parse('2026-10-11T15:00:00.000Z'),
};
const out = {};
for (const posts of [undefined, 3, 5, 6, 8]) {
  const r = planSlots({ buildDayPlan, input: { ...base, posts } });
  out[String(posts)] = { slots: r.slots, strategySource: r.strategySource };
}
writeFileSync(path.join(HERE, 'plan-slots.json'), `${JSON.stringify(out, null, 2)}\n`);
