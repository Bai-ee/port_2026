#!/usr/bin/env node
// Render a client's Creative Brief (the onboarding composition) to a standalone
// HTML file so you can eyeball the design without the authed dashboard route.
//
// Run: node scripts/render-creative-brief.mjs [clientId]
//   defaults to the HitLoop client (clairecalls-WUoltG84 → hitloop.agency).
//
// The cover summary uses the client's generated briefSummaries.onboarding when
// present, else the upsell "Recommended final version" from
// docs/ONBOARDING_UPSELL_SUMMARY.md as a representative example.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env.local so firebase-admin.cjs finds its credentials.
for (const line of readFileSync(join(repoRoot, '.env.local'), 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const require = createRequire(import.meta.url);
const fb = require('../api/_lib/firebase-admin.cjs');
const { renderMarketingBriefHtml } = await import('../app/api/dashboard/brief-preview/route.js');

// Upsell "Recommended final version" — docs/ONBOARDING_UPSELL_SUMMARY.md.
const UPSELL_FINAL = [
  "Hello, thanks for signing up! We've turned your onboarding into a first-pass creative baseline built around what people actually see first. That includes your site across devices, a polished device mockup, a social share preview, a motion/video mockup, and a concise AI summary of how your current presence reads today.",
  'This gives us a practical starting point for improvement. Instead of guessing, we can now see how the brand presents across screens, how it shares, and where the message or visuals need work. From here, the highest-value next steps are usually a stronger landing page, a clearer brand system, a social/content launch package, or a more fully managed creative and growth engagement.',
].join('\n');

const clientId = process.argv[2] || 'clairecalls-WUoltG84';

const dashSnap = await fb.adminDb.collection('dashboard_state').doc(clientId).get();
if (!dashSnap.exists) {
  console.error(`No dashboard_state for ${clientId}.`);
  process.exit(1);
}
const dash = dashSnap.data() || {};

const moduleBriefs = dash.moduleBriefs?.items || [];
const auditMockupUrl = dash.artifacts?.homepageDeviceMockup?.downloadUrl || null;
const studioVideoUrl = (() => {
  const caps = Array.isArray(dash.studioCaptures) ? dash.studioCaptures : [];
  for (let i = caps.length - 1; i >= 0; i -= 1) {
    if (caps[i]?.type === 'studio_video' && caps[i]?.downloadUrl) return caps[i].downloadUrl;
  }
  return null;
})();
const socialPreviewImageUrl = dash.siteMeta?.ogImage || null;
const coverSummary = dash.briefSummaries?.onboarding?.summary || UPSELL_FINAL;

// What's available — so a thin brief is explained, not a mystery.
const deviceBrief = moduleBriefs.find((b) => b.moduleId === 'multi-device-view');
console.log(`Rendering Creative Brief for ${clientId}`);
console.log(`  device mockup:   ${Boolean(deviceBrief?.mockupUrl || auditMockupUrl)}`);
console.log(`  screenshots:     ${Object.keys(deviceBrief?.screenshots || {}).join(', ') || 'none'}`);
console.log(`  social OG image:  ${Boolean(socialPreviewImageUrl)}`);
console.log(`  studio video:     ${Boolean(studioVideoUrl)}`);
console.log(`  cover summary:    ${dash.briefSummaries?.onboarding?.summary ? 'client-generated' : 'upsell template (fallback)'}`);

const html = renderMarketingBriefHtml({
  marketingBrief: dash.marketingBrief || null,
  clientName: dash.clientName || clientId,
  websiteUrl: dash.websiteUrl || null,
  generatedAt: dash.marketingBrief?.generatedAtIso || new Date().toISOString(),
  clientId,
  tier: dash.tier || 'free',
  moduleBriefs,
  auditMockupUrl,
  studioVideoUrl,
  socialPreviewImageUrl,
  briefType: 'onboarding',
  coverSummary,
  displayLabel: 'Creative Brief',
});

const outPath = join(repoRoot, 'scripts', `creative-brief-${clientId}.html`);
writeFileSync(outPath, html, 'utf8');
console.log(`\nWrote ${outPath}`);
process.exit(0);
