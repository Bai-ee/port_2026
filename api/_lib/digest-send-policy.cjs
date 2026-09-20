'use strict';

// digest-send-policy.cjs — the ONE place that decides what a daily-digest
// request mode is allowed to do (EMAIL-REBUILD-PLAN.md Phase 1 rules, owner
// decisions 2026-08-18). The route derives every gate from these flags, so the
// invariants are testable and greppable instead of scattered conditions:
//
//  - A SCHEDULED send (cron fan-out / sweep reclaim) is zero-generation and
//    zero-side-effect: no LLM call of any kind, no social queue write, no
//    approval-token mint, no X publish, no fresh-brief publish. It reads saved
//    data, renders, snapshots, sends. Anything missing renders an honest
//    empty/stale state.
//  - A MANUAL send (admin Send Now) may run inline LLM (bounded by
//    callAnthropic's timeout) and the social side effects — an operator is
//    watching the terminal.
//  - Previews/templates never touch social state; live preview may use LLM
//    unless the caller passed noLlm (handled by the route's skipLlm).
//  - NO send path may run a paid/fresh brief publish — that moved to the
//    pre-digest refresh phase (publishFreshDigestBrief).

function resolveSendPolicy({ isPreview = false, isTemplate = false, isSendNow = false } = {}) {
  const isRealSend = isSendNow || (!isPreview && !isTemplate);
  const isScheduledSend = isRealSend && !isSendNow;
  return {
    isRealSend,
    isScheduledSend,
    // Inline LLM (summary, captions): never on a scheduled send.
    allowInlineLlm: !isScheduledSend,
    // Social writes (suggested-post queue, auto-publish, approval tokens):
    // manual real sends only.
    allowSocialSideEffects: isRealSend && !isScheduledSend,
    // Fresh hosted-brief publish: no send path, ever (refresh phase owns it).
    allowFreshBriefRun: false,
  };
}

function validateVideoPublishEmailGate({
  isRealSend = false,
  allowSocialSideEffects = false,
  wantRemix = false,
  homeClientId = '',
  publishMode = 'off',
  publishResult = null,
  remixVideo = null,
  videoSourceClientId = '',
} = {}) {
  if (!isRealSend || !wantRemix || !homeClientId || publishMode === 'off') return null;

  if (!remixVideo || remixVideo.stale) {
    return new Error(`No completed Video Remix is available for the selected video source; email was not sent.`);
  }

  if (!allowSocialSideEffects) return null;

  if (publishResult?.skipped === 'not-connected') {
    return new Error(`X is not connected for video owner ${videoSourceClientId}; email was not sent because no working approval/publish action could be created.`);
  }
  if (publishMode === 'approval' && !publishResult?.approvalUrl) {
    return new Error(`Approval link could not be created for video owner ${videoSourceClientId}; email was not sent.`);
  }
  if (publishResult?.skipped === 'enqueue-failed' || publishResult?.skipped === 'publish-failed') {
    return new Error(`Daily video ${publishMode} setup failed for video owner ${videoSourceClientId}; email was not sent.`);
  }

  return null;
}

module.exports = { resolveSendPolicy, validateVideoPublishEmailGate };
