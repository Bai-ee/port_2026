'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hasHttpUrl, filterActionableOpportunities } = require('../post-url-validator.cjs');
const { normalizeIntelligence } = require('../intelligence.js');
const { projectBrief } = require('../../intelligence/_brief-intel.js');

const redditNoUrl = {
  topic: '(Brooklyn) Dog sitter recommendations! — active Reddit recommendation thread',
  url: null,
  priority: 'high',
};
const good = { conversation: 'Dog sitter recs', url: 'https://www.reddit.com/r/AskNYC/comments/abc/x/', injectionAngle: 'help' };

test('hasHttpUrl accepts only http(s)', () => {
  assert.equal(hasHttpUrl('https://example.com/a'), true);
  assert.equal(hasHttpUrl('javascript:alert(1)'), false);
  assert.equal(hasHttpUrl(''), false);
  assert.equal(hasHttpUrl(null), false);
  assert.equal(hasHttpUrl('not a url'), false);
});

test('filter drops null-url Reddit thread, javascript: and empty urls; keeps https', () => {
  const list = [redditNoUrl, { ...good, url: 'javascript:alert(1)' }, { ...good, url: '' }, good];
  const { kept, droppedNoUrl } = filterActionableOpportunities(list);
  assert.deepEqual(kept, [good]);
  assert.equal(droppedNoUrl, 3);
});

test('generic content ideas (no thread markers) are kept without a url', () => {
  const idea = { topic: 'Show the cleaning process', whyNow: 'trust', priority: 'medium', format: null };
  assert.equal(filterActionableOpportunities([idea]).kept.length, 1);
});

test('Scribe input (normalizeIntelligence) excludes url-less opportunities', () => {
  const agentData = { viralOpportunities: { opportunities: [redditNoUrl, good] } };
  const out = normalizeIntelligence(agentData, {});
  assert.equal(out.contentOpportunities.length, 1);
  assert.equal(out.contentOpportunities[0].url, good.url);
});

test('projectBrief cleans stored briefs and reports droppedNoUrl', () => {
  const stored = {
    contentOpportunities: [redditNoUrl, { topic: 'ok', url: 'https://x.com/a/status/1' }],
    scoutBrief: { agentData: {} },
  };
  const p = projectBrief(stored);
  assert.equal(p.opportunities.length, 1);
  assert.equal(p.opportunities[0].url, 'https://x.com/a/status/1');
  assert.equal(p.droppedNoUrl, 1);

  const viral = projectBrief({ scoutBrief: { agentData: { viralOpportunities: { opportunities: [redditNoUrl, good] } } } });
  assert.equal(viral.opportunities.length, 1);
  assert.equal(viral.droppedNoUrl, 1);
});
