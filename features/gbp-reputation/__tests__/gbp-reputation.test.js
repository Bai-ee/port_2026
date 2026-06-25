'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { analyzeGbpReputation } = require('../analyzer');
const { ROSITAS_GBP_PAYLOAD, ROSITAS_GBP_DISCONNECTED } = require('../rositas-mock');
const { resolveChecklist, CHECKLIST_TOTAL } = require('../seo-checklist');
const { suggestReply } = require('../reply-templates');
const gbpAnalyzer = require('../../scout-intake/analyzers/gbp-reputation');
const { CARD_CONTRACT, getCard } = require('../../scout-intake/card-contract');
const { REGISTRY } = require('../../scout-intake/analyzers');

describe('gbp-reputation analyzer — Rosita\'s connected payload', () => {
  const r = analyzeGbpReputation(ROSITAS_GBP_PAYLOAD);

  test('reports connected with rating + counts', () => {
    assert.equal(r.connected, true);
    assert.equal(r.ratingAverage, 4.4);
    assert.equal(r.reviewCount, 186);
  });

  test('counts unreplied + negative unreplied reviews', () => {
    // r2(2★), r3(1★), r4(3★), r5(5★) have no reviewReply → 4 unreplied
    assert.equal(r.unrepliedCount, 4);
    // r2(2★) + r3(1★) → 2 negative unreplied
    assert.equal(r.negativeUnrepliedCount, 2);
  });

  test('prioritizes negative unreplied reviews → urgent', () => {
    assert.equal(r.riskLevel, 'urgent');
    assert.equal(r.priorityAction.severity, 'high');
    assert.match(r.priorityAction.label, /negative review/i);
  });

  test('reviewsNeedingReply puts negatives first', () => {
    assert.ok(r.reviewsNeedingReply.length === 4);
    assert.ok(r.reviewsNeedingReply[0]._rating <= 2);
    assert.ok(r.reviewsNeedingReply[1]._rating <= 2);
  });

  test('produces a suggested reply draft per unreplied review', () => {
    assert.equal(r.suggestedReplies.length, 4);
    const neg = r.suggestedReplies.find((s) => s.sentiment === 'negative');
    assert.ok(neg.draft.includes('(815) 756-3817'));
  });

  test('surfaces profile + seo gaps', () => {
    assert.ok(r.profileGaps.includes('hasRecentPosts'));
    assert.ok(r.profileGaps.includes('hasMenuOrProducts'));
    assert.equal(r.seoChecklist.total, CHECKLIST_TOTAL);
    assert.ok(r.seoChecklist.completed >= 9);
    assert.ok(r.seoChecklist.priorityItems.length > 0);
  });
});

describe('gbp-reputation analyzer — degrade paths', () => {
  test('disconnected payload returns setup state', () => {
    const r = analyzeGbpReputation(ROSITAS_GBP_DISCONNECTED);
    assert.equal(r.connected, false);
    assert.equal(r.setupRequired, true);
    assert.equal(r.riskLevel, 'setup');
    assert.equal(r.priorityAction.severity, 'setup');
  });

  test('null payload returns setup state', () => {
    const r = analyzeGbpReputation(null);
    assert.equal(r.riskLevel, 'setup');
  });

  test('healthy when all reviews replied + no gaps', () => {
    const r = analyzeGbpReputation({
      connected: true,
      brand: 'Test Co',
      reviews: [
        { starRating: 'FIVE', reviewer: { displayName: 'A' }, comment: 'great', createTime: '2026-06-01T00:00:00Z', reviewReply: { comment: 'ty', updateTime: '2026-06-01T01:00:00Z' } },
      ],
      profileHealth: { hasWebsite: true, hasPhone: true, hasHours: true, hasPhotos: true, hasRecentPosts: true, hasMenuOrProducts: true },
      checklistCompletedIds: require('../seo-checklist').ALL_ITEM_IDS,
    });
    assert.equal(r.riskLevel, 'healthy');
    assert.equal(r.unrepliedCount, 0);
  });

  test('attention when unreplied but none negative', () => {
    const r = analyzeGbpReputation({
      connected: true,
      reviews: [
        { starRating: 'FIVE', reviewer: { displayName: 'A' }, comment: 'great', createTime: '2026-06-01T00:00:00Z' },
      ],
      profileHealth: { hasWebsite: true, hasPhone: true, hasHours: true, hasPhotos: true, hasRecentPosts: true, hasMenuOrProducts: true },
    });
    assert.equal(r.riskLevel, 'attention');
    assert.equal(r.priorityAction.severity, 'medium');
  });
});

describe('gbp-reputation analyzer adapter (scout-intake)', () => {
  test('registered in analyzer REGISTRY', () => {
    assert.equal(typeof REGISTRY['gbp-reputation']?.run, 'function');
  });

  test('reads payload from sharedResults.externalSignals', async () => {
    const out = await gbpAnalyzer.run({
      card: getCard('gbp-reputation'),
      sharedResults: { externalSignals: { googleBusinessProfile: ROSITAS_GBP_PAYLOAD } },
    });
    assert.equal(out.status, 'ok');
    assert.equal(out.signals.connected, true);
    assert.equal(out.confidence, 'high'); // urgent → high
  });

  test('degrades to empty/setup when no payload present', async () => {
    const out = await gbpAnalyzer.run({ card: getCard('gbp-reputation'), sharedResults: {} });
    assert.equal(out.status, 'empty');
    assert.equal(out.signals.riskLevel, 'setup');
  });
});

describe('card-contract wiring', () => {
  test('gbp-reputation card exists with correct analyzer impl', () => {
    const card = getCard('gbp-reputation');
    assert.ok(card);
    assert.equal(card.analyzer.impl, 'gbp-reputation');
    assert.equal(card.tier, 'paid');
    assert.equal(card.sourceField, 'externalSignals.googleBusinessProfile');
  });

  test('card is included in CARD_CONTRACT', () => {
    assert.ok(CARD_CONTRACT.some((c) => c.id === 'gbp-reputation'));
  });
});

describe('precomputed client report stays in sync with analyzer', () => {
  // lib/gbpReputationReport.js is the client-safe ESM copy of the analyzer
  // output for the Rosita's mock (the CJS analyzer can't be imported into the
  // client bundle). If this fails, regenerate the file from the analyzer.
  test('ROSITAS_GBP_REPORT deep-equals analyzeGbpReputation(ROSITAS_GBP_PAYLOAD)', async () => {
    const mod = await import('../../../lib/gbpReputationReport.js');
    const live = JSON.parse(JSON.stringify(analyzeGbpReputation(ROSITAS_GBP_PAYLOAD)));
    assert.deepEqual(mod.ROSITAS_GBP_REPORT, live);
  });
});

describe('reusable helpers', () => {
  test('suggestReply maps ratings to sentiment', () => {
    assert.equal(suggestReply({ starRating: 'ONE' }).sentiment, 'negative');
    assert.equal(suggestReply({ starRating: 'THREE' }).sentiment, 'neutral');
    assert.equal(suggestReply({ starRating: 'FIVE' }).sentiment, 'positive');
  });

  test('resolveChecklist tokenizes brand/site + caps priorityItems', () => {
    const c = resolveChecklist([], { brand: "Rosita's", site: 'rositas.com' });
    assert.equal(c.completed, 0);
    assert.equal(c.total, CHECKLIST_TOTAL);
    assert.ok(c.priorityItems.length <= 4);
    assert.ok(c.priorityItems.some((i) => /rositas\.com|Rosita/.test(i.label) || i.frequency === 'daily'));
  });
});
