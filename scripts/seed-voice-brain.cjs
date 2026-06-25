#!/usr/bin/env node
// seed-voice-brain.cjs — One-time seed: brand-voice.json -> approved Client Brain.
//
// Makes the single-source voice path testable end-to-end. Reads a client's
// on-disk brand-voice.json, maps it into the Client Brain voice/content
// superset, and saves it APPROVED so resolveVoiceProfile (Scribe + Guardian)
// reads voice from the brain instead of the file.
//
// This is the reverse of voice-resolver.js's projection (file -> brain).
// It WRITES to Firestore (clients/{clientId}/client_brain/current) — run it
// against the environment whose brain you intend to populate.
//
//   node scripts/seed-voice-brain.cjs not-the-rug
//
// Idempotent: re-running overwrites the voice/content sections from the file.

require('../features/not-the-rug-brief/load-env');
const { loadBrandVoice } = require('../features/not-the-rug-brief/knowledge');
const { saveClientBrain, getClientBrain } = require('../features/client-brain/store.cjs');

function fileToBrainVoice(file) {
  const tone = [file.core_tone, file.tone_description].filter(Boolean).join(' ').trim();
  return {
    voice: {
      toneSummary: tone,
      pillars: Array.isArray(file.voice_pillars) ? file.voice_pillars : [],
      avoidPatterns: Array.isArray(file.avoid) ? file.avoid : [],
      formattingRules: file.formatting_rules || {},
      instagramFormatting: file.instagram_formatting || {},
      scribeInstructions: file.scribe_instructions || '',
      dailyBriefVoice: file.daily_brief_voice || {},
    },
    content: {
      pillars: Array.isArray(file.content_pillars) ? file.content_pillars : [],
      postExamples: Array.isArray(file.few_shot_examples) ? file.few_shot_examples : [],
    },
  };
}

async function main() {
  const clientId = process.argv[2];
  if (!clientId) {
    console.error('Usage: node scripts/seed-voice-brain.cjs <clientId>');
    process.exit(1);
  }

  const file = loadBrandVoice(clientId);
  if (!file) {
    console.error(`No brand-voice.json found for "${clientId}" — nothing to seed.`);
    process.exit(1);
  }

  // Preserve any existing brain sections; only overwrite voice + content.
  const { brain: existing } = await getClientBrain(clientId);
  const mapped = fileToBrainVoice(file);

  const patch = {
    voice: { ...(existing.voice || {}), ...mapped.voice },
    content: { ...(existing.content || {}), ...mapped.content },
    status: 'approved',
  };

  const saved = await saveClientBrain(clientId, patch);
  console.log(`Seeded approved Client Brain voice for "${clientId}" (version ${saved.version}).`);
  console.log(`  pillars: ${patch.voice.pillars.length} · examples: ${patch.content.postExamples.length} · avoid: ${patch.voice.avoidPatterns.length}`);
  console.log('  resolveVoiceProfile will now source voice from the brain for Scribe + Guardian.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
