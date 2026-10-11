// Daily Content Loop — run persistence, rerun protection and review actions.
//
// Suggestions live HERE, in `x_content_daily_runs`, not in `social_posts`.
// Only an explicit Save Draft copies one into the queue, as an unscheduled
// draft, through the create-once helper (`createDraftPostOnce`) so a
// double-click or a concurrent request still yields exactly one row.
//
// Run key: (clientId, localDate, channel, version) → one doc per local day.
// Rerun rules: a claim is a short lease (no duplicate model work from two
// Generate clicks); an unchanged input fingerprint skips regeneration; a
// regeneration keeps every reviewed (saved/dismissed) suggestion.
//
// I/O is injected: `createFirestoreRunStore(db)` for real runs,
// `createMemoryRunStore()` for replay and tests.

export { RUNS_COLLECTION, CLAIM_LEASE_MS, runDocId, claimDecision, mergePreserved, createMemoryRunStore, createFirestoreRunStore } from './daily-loop/run-store.js';
export { composeQueueContent, saveSuggestionDraft, editSuggestion, dismissSuggestion } from './daily-loop/review.js';
export { loadDailyLoopInputs } from './daily-loop/inputs.js';
export { DRAFT_MODEL, createModelDrafter } from './daily-loop/drafter.js';
