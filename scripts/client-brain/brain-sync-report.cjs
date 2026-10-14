#!/usr/bin/env node
'use strict';

// Read-only preview of what the Client Brain sync will do for a client:
//   1. one-time adoption of current settings into the Brain (if not done yet)
//   2. the first Brain -> settings sync after that
// Writes nothing. Usage: node scripts/client-brain/brain-sync-report.cjs <clientId> [...] [--markdown <path>]
// --markdown previews a local CLIENT_BRAIN.md as if it were injected (approved, not yet adopted).

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.local'), quiet: true });
const { readClientBrainDoc } = require('../../features/client-brain/store.cjs');
const { TARGETS, adoptSettingsIntoMarkdown, planTargetWrite, readStoreValues } = require('../../features/client-brain/brain-sync.cjs');

const show = (x) => {
  if (x == null) return '∅';
  if (Array.isArray(x)) {
    if (x[0] && typeof x[0] === 'object') return `[${x.length} rows: ${x.map((r) => r.label || r.track).join(', ')}]`;
    return `[${x.length}] ${x.slice(0, 4).join(', ').slice(0, 110)}${x.length > 4 ? ', …' : ''}`;
  }
  return `"${String(x).replace(/\s+/g, ' ').slice(0, 70)}"`;
};

// Read-only: each STORE only reads its current value.
const storeValues = readStoreValues;

async function report(clientId, markdownPath) {
  const brain = markdownPath
    ? { status: 'approved', markdownSource: fs.readFileSync(markdownPath, 'utf8') }
    : await readClientBrainDoc(clientId);
  if (markdownPath) console.log(`\n(using local Markdown ${markdownPath})`);
  console.log(`\n=== ${clientId} · status=${brain?.status || '—'} · markdown=${Boolean(brain?.markdownSource)}${brain?.settingsAdoptedAt ? ` · adopted ${brain.settingsAdoptedAt}` : ''}`);
  if (!brain?.markdownSource) return console.log('  No Markdown Brain: sync skips this client.');
  if (brain.status !== 'approved') console.log('  Not approved: nothing runs until it is approved.');
  const current = await storeValues(clientId);
  let markdown = brain.markdownSource;
  if (!brain.settingsAdoptedAt) {
    const adopted = adoptSettingsIntoMarkdown(markdown, current);
    markdown = adopted.markdown;
    console.log(`  1) Adopt current settings into the Brain: ${adopted.changes.length} field(s)`);
    for (const c of adopted.changes) {
      console.log(`     ${c.target}.${c.field}: Brain ${show(c.brain)}  →  ${show(c.settings)}`);
      if (c.droppedFromBrain.length) console.log(`       removed from Brain: ${c.droppedFromBrain.join('; ').slice(0, 200)}`);
    }
  }
  console.log('  2) First sync, Brain → settings:');
  for (const [target, fields] of Object.entries(TARGETS)) {
    const { diff } = planTargetWrite(fields, markdown, current[target]);
    console.log(`     [${target}] ${diff.length} change(s)`);
    for (const d of diff) console.log(`       ${d.field.padEnd(26)} ${show(d.from)}  →  ${show(d.to)}${d.origin === 'derived' ? ' (fills empty)' : ''}`);
  }
}

(async () => {
  const args = process.argv.slice(2);
  const mdAt = args.indexOf('--markdown');
  const markdownPath = mdAt >= 0 ? args.splice(mdAt, 2)[1] : null;
  const ids = args;
  if (!ids.length) {
    console.error('Usage: node scripts/client-brain/brain-sync-report.cjs <clientId> [...]');
    process.exit(1);
  }
  for (const id of ids) await report(id, markdownPath);
  process.exit(0);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
