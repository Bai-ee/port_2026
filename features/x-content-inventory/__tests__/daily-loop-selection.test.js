// Selection regressions against REAL saved shapes (fixtures/daily-loop-real-shapes.json:
// conversationSearch + scan posts and x_content_packages docs, copied read-only 2026-10-10).
// The only invented post is MODEST_ON_BRAND, marked below; real data had no post naming a held artist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  conversationPostsFrom, normalizeConversationPost, packageEligibility, buildBrandProfile, brandFit, groupNarratives,
  matchScore, selectSuggestions,
} from '../daily-loop.js';

const FX = JSON.parse(readFileSync(new URL('./fixtures/daily-loop-real-shapes.json', import.meta.url), 'utf8'));
const NOW = Date.parse(FX.now);
const pkg = (id) => FX.packages.find((p) => p.id === id);
const postText = (id) => conversationPostsFrom(FX).find((p) => p.id === id).text;

const MODEST_ON_BRAND = normalizeConversationPost({
  id: 'invented-1', author: 'chicagoheads', text: 'Glenn Underground and Cei-Bei, House Music Will Never Die. Still the one.',
  createdAt: new Date(NOW - 2 * 3_600_000).toISOString(), likeCount: 60, retweetCount: 5, replyCount: 8,
}, 'search:glenn underground');

const select = (extraPosts = []) => selectSuggestions({
  clientId: 'fixture-client-a', localDate: '2026-10-10', now: NOW, packages: FX.packages,
  conversationPosts: [...conversationPostsFrom(FX), ...extraPosts],
  strategy: { gaps: [], decisions: { maxQuotes: 3 } },
});

test('fixture is real-shaped: a 15-post pool and library items from several sources', () => {
  assert.equal(conversationPostsFrom(FX).length, 15);
  assert.ok(FX.packages.some((p) => p.source?.kind === 'discogs'));
  assert.ok(FX.packages.some((p) => p.source?.kind === 'nas-archive'));
});

// Each pair is a false positive seen in review; the text is the real post that triggered the search.
test('junk matches stay rejected', () => {
  const cases = [
    ['pro', postText('2108788059135500717'), 'discogs-30820134'], // "Pro" vs Pro-Zak Trax / Kojak – Hold Me
    ['hey', postText('2108788059135500717'), 'nas-007be700c625d64e'], // portrait photo
    ['japanese', postText('2107944838478107024'), 'nas-b152328f17d602c2'], // shokupan photo
    ['super', 'Super Bowl Sunday watch party, super hype', 'nas-05b332d72c9e34c8'], // only the full party name counts
    ['star wars', postText('2108748099476693494'), 'nas-7132666eb6e82f53'], // text-message screenshot
  ];
  for (const [word, text, id] of cases) assert.equal(matchScore(text, pkg(id)), null, `"${word}" must not match ${id}`);
  // The whole party name does match; it is the single word that must not.
  assert.equal(matchScore('Super Bowl Beatdown in 2007 was wild', pkg('nas-05b332d72c9e34c8')).tier, 'specific');
});

test('the junk posts never reach a suggestion from the full real pool', () => {
  const r = select();
  const picked = r.suggestions.map((s) => s.package.id);
  for (const id of ['nas-007be700c625d64e', 'nas-b152328f17d602c2', 'nas-7132666eb6e82f53', 'nas-05b332d72c9e34c8']) assert.ok(!picked.includes(id));
  assert.ok(!r.suggestions.some((s) => ['2108788059135500717', '2108748099476693494'].includes(s.opportunity?.id)));
});

test('a conversation naming a held artist/label matches that item as `specific`', () => {
  const m = matchScore(MODEST_ON_BRAND.text, pkg('discogs-10207'));
  assert.equal(m.tier, 'specific');
  assert.ok(m.phrases.includes('glenn underground'));
  const r = select([MODEST_ON_BRAND]);
  const s = r.suggestions.find((x) => x.opportunity.id === 'invented-1');
  assert.equal(s.package.id, 'discogs-10207');
  assert.equal(s.match.tier, 'specific');
  assert.match(s.why.content, /named in the conversation/);
});

test('an image-only post is never brand-fit, and the shortlist says why', () => {
  const ns = groupNarratives(conversationPostsFrom(FX), { now: NOW });
  const profile = buildBrandProfile({ packages: FX.packages.filter((p) => packageEligibility(p).ok) });
  const imageOnly = ns.find((n) => n.anchor.id === '2108745834477089129');
  assert.equal(imageOnly.anchor.hasMedia, true);
  const fit = brandFit(imageOnly, profile);
  assert.equal(fit.score, 0);
  assert.equal(fit.reason, 'no text to assess');
  const row = select().shortlist.find((x) => x.anchor.endsWith('/2108745834477089129'));
  assert.equal(row.skipped, 'off-brand');
  assert.equal(row.reason, 'no text to assess');
  assert.equal(row.brandFit, 0);
  assert.ok(row.label.length > 0, 'a text-less post still has a visible label');
});

test('a viral off-brand post loses to a modest on-brand one', () => {
  const viral = conversationPostsFrom(FX).find((p) => p.id === '2108748099476693494'); // Star Wars poster, ~1600 likes
  assert.ok(viral.likes > 20 * MODEST_ON_BRAND.likes);
  const r = select([MODEST_ON_BRAND]);
  assert.equal(r.suggestions[0].opportunity.id, 'invented-1');
  assert.ok(!r.suggestions.some((s) => s.opportunity?.id === viral.id));
  const skipped = r.shortlist.find((x) => x.anchor.endsWith(`/${viral.id}`));
  assert.equal(skipped.skipped, 'off-brand');
  assert.ok(skipped.reason);
});

test('every suggestion explains itself: why.now, why.brand, why.content are non-empty', () => {
  for (const posts of [[], [MODEST_ON_BRAND]]) {
    const r = select(posts);
    assert.ok(r.suggestions.length > 0);
    for (const s of r.suggestions) {
      for (const k of ['now', 'brand', 'content']) assert.ok(typeof s.why[k] === 'string' && s.why[k].trim().length > 0, `why.${k} on ${s.id}`);
    }
  }
  // The original fallback (no conversation at all) explains itself too.
  const none = selectSuggestions({ clientId: 'fixture-client-a', localDate: '2026-10-10', now: NOW, packages: FX.packages, conversationPosts: [], strategy: { gaps: [] } });
  assert.equal(none.suggestions[0].type, 'original');
  for (const k of ['now', 'brand', 'content']) assert.ok(none.suggestions[0].why[k].trim());
});
