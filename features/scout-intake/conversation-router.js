'use strict';

// conversation-router.js
//
// Foundation for stage-aware, entry-aware conversation branching.
//
// Resolves a stable `variantKey` from two signals:
//   - entryMode: 'website' | 'no_website'   (set at provision, see client-provisioning.cjs)
//   - stage:     onboarding `stage` answer   ('idea' | 'early' | 'in_progress' | 'live' | 'scaling')
//
// This module is PURE — no Firestore, no LLM. It only decides WHICH conversation
// variant applies. The actual conversation copy/prompts live in CONVERSATION_VARIANTS
// and are filled in a later customization phase; until then getConversationVariant
// returns a safe default so callers never break on an unmapped key.

// Collapse the 5 onboarding stages into 3 coarse groups the conversation cares about.
const STAGE_GROUP = {
  idea: 'pre_launch',
  early: 'pre_launch',
  in_progress: 'building',
  live: 'live',
  scaling: 'live',
};

const VALID_ENTRY_MODES = new Set(['website', 'no_website']);

function normalizeEntryMode(entryMode) {
  return VALID_ENTRY_MODES.has(entryMode) ? entryMode : 'no_website';
}

function stageGroupOf(stage) {
  return STAGE_GROUP[stage] || 'pre_launch';
}

/**
 * Resolve the conversation variant key for a client.
 * @param {object} args
 * @param {string} args.entryMode  'website' | 'no_website'
 * @param {string} args.stage      onboarding stage value (may be undefined)
 * @returns {{ variantKey: string, entryMode: string, stageGroup: string, stage: (string|null) }}
 */
function resolveConversationVariant({ entryMode, stage } = {}) {
  const mode = normalizeEntryMode(entryMode);
  const group = stageGroupOf(stage);
  return {
    variantKey: `${mode}:${group}`,
    entryMode: mode,
    stageGroup: group,
    stage: stage || null,
  };
}

// ── Variant registry (scaffold) ───────────────────────────────────────────────
// Keyed by `${entryMode}:${stageGroup}`. Each entry will hold the conversation
// focus + opener + prompt guidance once the customization phase defines them.
// Left intentionally empty now — getConversationVariant falls back to DEFAULT.
const CONVERSATION_VARIANTS = {
  // 'website:pre_launch':   { focus: '', opener: '' },
  // 'website:building':     { focus: '', opener: '' },
  // 'website:live':         { focus: '', opener: '' },
  // 'no_website:pre_launch':{ focus: '', opener: '' },
  // 'no_website:building':  { focus: '', opener: '' },
  // 'no_website:live':      { focus: '', opener: '' },
};

const DEFAULT_VARIANT = { focus: '', opener: '' };

/**
 * Look up the conversation variant definition for a client. Always returns an
 * object (DEFAULT_VARIANT when the key is not yet defined) so callers are safe.
 * @param {object} args  same shape as resolveConversationVariant
 */
function getConversationVariant(args) {
  const resolved = resolveConversationVariant(args);
  const def = CONVERSATION_VARIANTS[resolved.variantKey] || DEFAULT_VARIANT;
  return { ...resolved, ...def };
}

module.exports = {
  STAGE_GROUP,
  CONVERSATION_VARIANTS,
  resolveConversationVariant,
  getConversationVariant,
  stageGroupOf,
  normalizeEntryMode,
};
