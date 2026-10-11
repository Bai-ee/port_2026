// Review actions on a stored suggestion: compose queue content, Edit, Save Draft
// (create-once, unscheduled), and Dismiss.
// Decides what may enter the queue; never schedules, publishes, or generates suggestions.
// Builds on run-store and the copy/eligibility checks.

import { packageEligibility } from './content-basis.js';
import { checkSuggestionText, guardTypeFor } from './copy.js';
import { socialPostIdFor } from './time-ids.js';
import { bad, runDocId } from './run-store.js';

// --- review actions --------------------------------------------------------

function findSuggestion(run, suggestionId) {
  const s = run?.suggestions?.find((x) => x.id === suggestionId);
  if (!s) throw bad('Suggestion not found.', 404);
  return s;
}

/** Compose what goes into the queue. A quote carries the quoted URL last,
 * which is how X composes a quote post. */
export function composeQueueContent(suggestion, text) {
  const body = String(text ?? '').trim();
  if (suggestion.type !== 'quote') return body;
  const url = suggestion.opportunity?.url;
  if (!url) throw bad('Quote suggestion has no source URL.', 422);
  return `${body}\n\n${url}`;
}

/**
 * Save one suggestion to `social_posts` as an unscheduled draft.
 * Re-checks the (possibly edited) text and the package's eligibility first;
 * a blocked suggestion never reaches the queue.
 *
 * deps: { store, getPackage(id), createDraftPostOnce(clientId, postId, payload), now(),
 *         postExists?(id) }  — postExists lets a deleted queue row be saved again.
 */
export async function saveSuggestionDraft(deps, { key, suggestionId, text }) {
  const run = await deps.store.read(key);
  let s = findSuggestion(run, suggestionId);
  if (s.socialPostId) {
    // Saved earlier, but the operator may have deleted the queue row since.
    if (!deps.postExists || (await deps.postExists(s.socialPostId))) return { ok: true, postId: s.socialPostId, existing: true };
    const at = new Date(deps.now ? deps.now() : Date.now()).toISOString();
    const restored = s.savedText || s.edit?.text || s.draft?.text || '';
    s = await deps.store.updateSuggestion(key, s.id, () => ({ socialPostId: null, reviewState: 'edited', edit: { text: restored, at, checks: checkSuggestionText(restored, s) } }));
  }
  if (s.reviewState === 'dismissed') throw bad('Suggestion was dismissed.', 409);

  const finalText = typeof text === 'string' ? text : s.edit?.text || s.draft?.text || '';
  const checks = checkSuggestionText(finalText, s);
  if (checks.blocked) throw bad(`Blocked by checks: ${checks.violations.join('; ') || 'content guard hard block'} — edit the text and try again.`, 422, { checks });

  // A reaction slot (quote-react) owns no library item, so there is nothing to re-check.
  const packageId = s.package?.id ?? null;
  const pkg = packageId ? await deps.getPackage(packageId) : null;
  if (packageId) {
    const eligibility = pkg ? packageEligibility(pkg, { now: deps.now ? deps.now() : Date.now() }) : { ok: false, reason: 'missing' };
    if (!eligibility.ok) throw bad(`Content item is no longer eligible (${eligibility.reason}).`, 409);
  }

  const postId = socialPostIdFor(s.id);
  const planVersion = run?.strategySource?.planVersion;
  const expiresAt = s.expiresAt || s.package?.expiresAt || null;
  const { post, existing } = await deps.createDraftPostOnce(key.clientId, postId, {
    content: composeQueueContent(s, finalText),
    platform: 'x',
    source: 'daily-loop',
    packageId,
    engine: pkg?.engine || null,
    selfReply: s.draft?.selfReply ? { text: s.draft.selfReply } : null,
    // A reply carries its target the same way Reply Targets drafts do; the
    // operator posts it into the thread.
    replyTo: s.type === 'reply' && s.opportunity ? { author: s.opportunity.author, url: s.opportunity.url, text: s.opportunity.text, source: 'daily-loop' } : null,
    sourceRef: {
      kind: 'daily-loop',
      runKey: runDocId(key),
      suggestionId: s.id,
      suggestionType: s.type,
      conversationId: s.conversation?.id || null,
      opportunityId: s.opportunity?.id || null,
      opportunityUrl: s.opportunity?.url || null,
      matchTerms: s.match?.terms || [],
    },
    xStrategy: { postType: guardTypeFor(s), source: 'daily-loop' },
    algorithmProfileVersion: checks.score?.profile || null,
    // Provenance (lifecycle v2).
    runId: runDocId(key),
    suggestionId: s.id,
    ...(typeof planVersion === 'number' ? { strategyVersion: planVersion } : {}),
    channel: 'x',
    ...(expiresAt ? { expiresAt } : {}),
    lifecycleVersion: 2,
  });

  await deps.store.updateSuggestion(key, s.id, () => ({
    reviewState: 'saved',
    socialPostId: post?.id || postId,
    savedText: finalText,
    savedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString(),
    checks,
  }));
  return { ok: true, postId: post?.id || postId, existing };
}

/**
 * Store the reviewer's working copy. The text is re-checked now, so the card can
 * show a block before Save; empty text drops the edit and returns to pending.
 * Refuses suggestions that are already saved or dismissed (409).
 */
export async function editSuggestion(deps, { key, suggestionId, text }) {
  const body = String(text ?? '').trim();
  return deps.store.updateSuggestion(key, suggestionId, (s) => {
    if (s.socialPostId || s.reviewState === 'saved') throw bad('Already saved as a draft — delete it from the queue to edit again.', 409);
    if (s.reviewState === 'dismissed') throw bad('Suggestion was dismissed.', 409);
    if (!body) return { edit: null, reviewState: 'pending' };
    const at = new Date(deps.now ? deps.now() : Date.now()).toISOString();
    return { edit: { text: body, at, checks: checkSuggestionText(body, s) }, reviewState: 'edited' };
  });
}

export async function dismissSuggestion(deps, { key, suggestionId }) {
  return deps.store.updateSuggestion(key, suggestionId, (s) => {
    if (s.socialPostId) throw bad('Already saved as a draft — delete it from the queue instead.', 409);
    return { reviewState: 'dismissed', dismissedAt: new Date(deps.now ? deps.now() : Date.now()).toISOString() };
  });
}
