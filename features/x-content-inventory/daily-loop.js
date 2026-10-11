// Daily Content Loop — which X conversations to join, with what owned content.
//
// The core decision, per the master plan (docs/plans/DAILY-CONTENT-LOOP-MASTER-PLAN.md):
//   "What conversation is gaining momentum, why is it appropriate for my brand,
//    and what relevant content can I contribute?"
//
// Inputs are the systems that already exist — the saved watchlist scan
// (scan-quote-targets), a saved brand-topic search (bird, local), the content
// inventory, the approved Client Brain, the saved Strategy Builder plan, the
// committed own/benchmark corpora — and every suggestion carries the evidence
// for each part of that decision, including what is missing.
//
// Brand relevance is NOT one keyword hit. A conversation must clear four
// independent checks, each shown to the reviewer:
//   1. vocabulary — it talks about things the owner's library actually holds
//   2. lane       — the content guard places it outside casino/politics
//   3. content    — an eligible owned item can ground a contribution
//   4. history    — what the owner's own posts on that topic/type earned (or
//                   that there is no evidence)
// plus the approved Brain when there is one (an unapproved Brain is a gap,
// never a silent substitute).
//
// Nothing here schedules or publishes. Suggestions live in the run store until
// a human presses Save Draft; the queue row is `status:'draft'`, `scheduledAt:null`.
//
// Pure except `runDailyLoop`, whose I/O is injected (tests use fakes).

export * from './daily-loop/index.js';
