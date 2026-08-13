'use strict';

// buildBriefSummaryEvidence — the Creative Brief ('onboarding') used to be
// built from meta tags plus one-line module roll-ups only, so real on-page
// CTAs, copy and social links were reported as missing from the site, and a
// module that failed or never ran read the same as a genuine gap.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBriefSummaryEvidence } = require('../brief-summarizer.js');

const PAGE = {
  url: 'https://critters.quest/',
  type: 'homepage',
  title: 'Critters Quest - Choose Your World',
  h1: ['MINE', 'PLAY GAME'],
  h2: ['TWO WORLDS. TWO DESTINATIONS.'],
  navLabels: [],
  ctaTexts: ['Pre-Mine', 'Play Game - enter Valdara'],
  bodyParagraphs: ['STAKING IS LIVE. FEED THE LUCKY PICK FROM AUG 4.'],
  socialLinks: ['https://x.com/CrittersQuest'],
  contactClues: [],
};

const crawled = (overrides = {}) => ({
  siteMeta: { title: 'Critters Quest' },
  evidence: { url: PAGE.url, thin: false, warnings: [], pages: [PAGE] },
  modules: { 'social-preview': { status: 'succeeded' } },
  ...overrides,
});

test('page content reaches the Creative Brief evidence bundle', () => {
  const { evidenceText } = buildBriefSummaryEvidence('onboarding', crawled());
  assert.match(evidenceText, /## site-content/);
  assert.match(evidenceText, /H1 \(homepage\) — MINE · PLAY GAME/);
  assert.match(evidenceText, /CTA text \(homepage\) — Pre-Mine · Play Game - enter Valdara/);
  assert.match(evidenceText, /Social links \(homepage\) — https:\/\/x\.com\/CrittersQuest/);
});

test('a successful crawl that found no CTA says so explicitly', () => {
  const data = crawled();
  data.evidence.pages = [{ ...PAGE, ctaTexts: [] }];
  const { evidenceText } = buildBriefSummaryEvidence('onboarding', data);
  assert.match(evidenceText, /CTA text \(homepage\) — none found in the static HTML/);
  assert.match(evidenceText, /read 1 page\(s\) of real content/);
});

test('a crawl that never ran is marked UNPROVEN, not missing', () => {
  const { evidenceText } = buildBriefSummaryEvidence('onboarding', crawled({ evidence: null }));
  assert.match(evidenceText, /## CAPTURE STATUS/);
  assert.match(evidenceText, /Page crawl — DID NOT RUN this run/);
  assert.match(evidenceText, /UNPROVEN/);
  assert.doesNotMatch(evidenceText, /## site-content/);
});

test('a JS-rendered site that returned no static text is marked UNPROVEN', () => {
  const data = crawled();
  data.evidence.thin = true;
  const { evidenceText } = buildBriefSummaryEvidence('onboarding', data);
  assert.match(evidenceText, /COULD NOT BE READ/);
  assert.match(evidenceText, /UNPROVEN/);
});

test('failed and never-run modules are reported separately', () => {
  const { evidenceText } = buildBriefSummaryEvidence('onboarding', crawled({
    modules: {
      'seo-performance': { status: 'failed', lastErrorCode: 'seo_skill_failed' },
      'style-guide': { status: 'queued' },
      'social-preview': { status: 'succeeded' },
    },
  }));
  assert.match(evidenceText, /Modules that FAILED this run.*seo-performance \(seo_skill_failed\)/);
  assert.match(evidenceText, /Modules that NEVER RAN this run.*style-guide \(queued\)/);
});

test('page content alone is enough to generate the brief', () => {
  // No siteMeta, no brand overview, no module briefs — every composition
  // section is empty, but a real crawl still has something to say.
  const { sectionCount } = buildBriefSummaryEvidence('onboarding', {
    evidence: { thin: false, warnings: [], pages: [PAGE] },
  });
  assert.ok(sectionCount > 0, 'expected the crawl block to count as usable evidence');
});

test('other brief types are untouched', () => {
  const data = crawled({ marketingBrief: { headline: 'Mainnet is live.' } });
  const { evidenceText } = buildBriefSummaryEvidence('marketing-director', data);
  assert.doesNotMatch(evidenceText, /## site-content/);
  assert.doesNotMatch(evidenceText, /## CAPTURE STATUS/);
});
