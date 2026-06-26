import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDailyEditorialRecommendation,
  collectDailyEditorialSignals,
  formatEditorialRecommendationForPrompt,
  normalizeEditorialStrategyConfig,
} from '../engine.js';

const EDITORIAL = {
  frameworkVersion: '2.0',
  schedulePolicy: {
    platforms: {
      primary: ['x'],
      secondary: ['linkedin'],
    },
    publishingCadence: {
      x: '1 high-quality post every weekday',
      linkedin: '2 posts per week',
    },
    preferredPublishingWindows: {
      x: ['8:00-10:00 AM', '1:00-3:00 PM'],
      linkedin: ['Tuesday-Thursday morning'],
    },
    campaignAllocation: {
      'Creative Systems': '25%',
    },
    narrativeRotation: {
      minDaysBetweenSameNarrative: 3,
      maxProjectUsesPerSevenDays: 2,
      rotateBy: ['Project', 'Narrative', 'Editorial Format', 'Platform'],
    },
    editorialFormatRotation: {
      formats: ['Production Notes', 'Behind the Build'],
      maxConsecutiveRepeats: 2,
    },
    fallbackRules: ['Publish the originally scheduled evergreen post.'],
  },
  campaigns: [{
    id: 'creative-systems',
    name: 'Creative Systems',
    priority: 0.9,
    allocationPct: 25,
    strategicObjective: 'Become associated with designing systems that survive implementation.',
    positioningObjective: 'Own creative systems architecture.',
    targetAudience: ['Startup founders'],
    supportedClientBrainTopics: ['Creative Systems Architecture'],
    supportingProjects: ['Critters', 'HITLOOP'],
    narrativeBuckets: ['AI Workflow Integration', 'Brand Translation'],
    keywords: ['creative systems', 'AI workflow', 'Critters'],
    dailySignalTriggers: ['AI workflow conversations', 'product design discourse'],
    editorialFormats: ['Production Notes', 'Behind the Build'],
    fallback: 'Evergreen Brand Translation',
    weeklyFocus: 'AI workflow decisions grounded in real work.',
    successMetrics: ['More profile clicks from founders'],
    assetLibrary: [{
      id: 'critters-workflow',
      title: 'Critters UI evolution',
      type: 'screenshot',
      narrative: 'AI Workflow Integration',
      projects: ['Critters'],
      topics: ['creative systems', 'AI workflow'],
      platforms: ['x'],
      keywords: ['AI workflow', 'design decision'],
      evergreenScore: 0.95,
      freshnessScore: 0.8,
      preparedCopy: 'How an AI-assisted production loop changed one Critters design decision.',
      mediaHint: 'Use Critters workflow screenshots.',
    }],
  }],
  operatorPreferences: { preferredPlatforms: ['x'] },
};

test('normalizeEditorialStrategyConfig sanitizes campaigns and assets', () => {
  const config = normalizeEditorialStrategyConfig(EDITORIAL);
  assert.equal(config.enabled, true);
  assert.equal(config.frameworkVersion, '2.0');
  assert.equal(config.schedulePolicy.platforms.primary[0], 'x');
  assert.equal(config.schedulePolicy.narrativeRotation.minDaysBetweenSameNarrative, 3);
  assert.equal(config.campaigns[0].id, 'creative-systems');
  assert.equal(config.campaigns[0].allocationPct, 25);
  assert.equal(config.campaigns[0].editorialFormats[0], 'Production Notes');
  assert.equal(config.campaigns[0].assetLibrary[0].type, 'screenshot');
  assert.equal(config.operatorPreferences.preferredPlatforms[0], 'x');
});

test('collectDailyEditorialSignals normalizes Marketing Brief signal shapes', () => {
  const signals = collectDailyEditorialSignals({
    intelligence: {
      viralOpportunities: { opportunities: [{ title: 'AI workflow discussion is active' }] },
      kolActivity: [{ name: '@founder', content: 'Creative systems and AI workflow are the topic today.' }],
    },
  });
  assert.equal(signals.length, 2);
  assert.ok(signals.some((signal) => signal.type === 'viral'));
  assert.ok(signals.some((signal) => signal.type === 'kol'));
});

test('buildDailyEditorialRecommendation selects aligned prepared asset', () => {
  const recommendation = buildDailyEditorialRecommendation({
    editorial: EDITORIAL,
    ctx: {
      intelligence: {
        kolActivity: [{
          name: '@operator',
          content: 'Teams are debating AI workflow integration, creative systems, Critters, and design decision loops today.',
        }],
      },
    },
    now: '2026-06-26T12:00:00.000Z',
  });

  assert.equal(recommendation.mode, 'recommendation');
  assert.equal(recommendation.campaign.id, 'creative-systems');
  assert.equal(recommendation.selectedAsset.id, 'critters-workflow');
  assert.equal(recommendation.influenceLevel, 'swap-within-campaign');
  assert.equal(recommendation.influenceDecision.label, 'Swap Within Campaign');
  assert.equal(recommendation.campaign.allocationPct, 25);
  assert.equal(recommendation.schedulePolicy.primaryPlatforms[0], 'x');
  assert.equal(recommendation.narrativeStrength[0].narrative, 'AI Workflow Integration');
  assert.equal(recommendation.narrativeStrength[0].strength, 'strong');
  assert.ok(recommendation.opportunityScore >= 60);
  assert.ok(recommendation.relevantDailySignals.length > 0);
});

test('buildDailyEditorialRecommendation falls back when no campaign is configured', () => {
  const recommendation = buildDailyEditorialRecommendation({ editorial: { campaigns: [] } });
  assert.equal(recommendation.mode, 'fallback');
  assert.equal(recommendation.influenceLevel, 'no-change');
  assert.match(recommendation.fallbackRecommendation, /scheduled content/i);
});

test('formatEditorialRecommendationForPrompt summarizes recommendation', () => {
  const recommendation = buildDailyEditorialRecommendation({
    editorial: EDITORIAL,
    ctx: { intelligence: { categoryTrends: ['AI workflow conversations in design teams'] } },
  });
  const text = formatEditorialRecommendationForPrompt(recommendation);
  assert.match(text, /Influence:/);
  assert.match(text, /Schedule policy:/);
  assert.match(text, /Campaign allocation: 25%/);
  assert.match(text, /Narrative strength:/);
  assert.match(text, /Campaign: Creative Systems/);
  assert.match(text, /Selected asset: Critters UI evolution/);
});
