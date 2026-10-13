# X Strategy Document — master plan (2026-10-12)

Branch `feat/strategy-doc` (worktree `Bballi_Portfolio-strategy-doc`, from main `7d858ea0`).

## Objective

Make setting X strategy in HitLoop work like the owner's sessions with Claude: a readable **Strategy document**
the owner can edit directly, an agent that reads it, discusses it against benchmarks + the owner's own profile +
the X algorithm, and proposes edits; a **Refresh** that pulls current data; and a **Review** that says in the chat
whether the new data changes the strategy — and, if so, how.

## What exists (main 7d858ea0)

- Strategy tab = `StrategyPanel.jsx`: chat (left, `StrategyChat.jsx`) + Details (Plan / Accounts / Insights / History).
- Plan = `x_strategy_plans/{clientId}` (knobs: authoredPerDay, floors/caps, engineTargets, contentTracks, notes ≤1000).
  Version-checked transactions (`plan-state.js`, `plan-store.js`), history ≤30 with before/after snapshots.
- Chat agent (`features/x-strategy/agent/*`): Sonnet 4.6, read tools (evaluation, plan, tracks, context, top posts…),
  8 proposal kinds, owner Confirm/Reject (`proposals.js`). Never starts on its own. No algorithm, X Monitor or
  rule-check tools. Strategy model is hardcoded in `prompt.js`.
- Benchmarks/own corpus: `x_corpora`, refreshed free by `bird` via the Mac worker (`x_strategy_refresh_requests`).
  Insights (`evaluate.js`) is deterministic and display-only.
- Daily loop reads the plan via `resolvePlanInputs` (single source). Model drafting (`draft.js buildDraftPrompt`) gets
  story + Brain voice + shape; no strategy text.

## Direction

The **Strategy document** becomes the top of the hierarchy: doc (why/what) → plan knobs (how much) → daily loop.
The owner edits it directly; the agent edits it only through proposal cards the owner confirms. Every change —
manual or chat — is versioned and shows up in the chat as a line, so "how and if the strategy changed" is visible
where the conversation happens.

## Data model

`x_strategy_docs/{clientId}` (new; separate from the plan so plan history snapshots stay small):

```
{ version, updatedAt, updatedBy,
  sections: { thesis, audience, tracks, formats, rules, algorithm, decisions, open },   // strings
  lastReview: { at, threadId, docVersion, planVersion, dataAsOf } | null,
  history: [ { version, at, by, source:'manual'|'chat'|'seed', proposalId?, reason, changed:[section],
               before:{section:text}, after:{section:text} } ]   // ≤ 25, oldest first, changed sections only
}
```

Section caps 2,000 chars each (doc ≤ 16k). Absent doc → seeded draft (source `seed`, from the Seb model +
session-protocol "already decided" list), shown as **Draft — not yet confirmed by you** until the owner saves once.

## Phases

### P1 — Strategy document: store, routes, editor (no AI)
- `features/x-strategy/strategy-doc.js` (pure: sections, normalize, validate, applyEdit, revert, diff, summarize).
- `strategy-doc-store.js` (Firestore, version-checked transaction; memory store for tests).
- `strategy-doc-seed.js` (default draft text).
- Route actions in `route-handlers.js`: `strategy-doc-get`, `strategy-doc-save` (section edits + expectedVersion),
  `strategy-doc-revert`.
- UI: Details gets a first sub-tab **Strategy** — section cards (read view, Edit → textarea, Save/Cancel,
  stale-version message), doc history with Restore. Stable ids `#strategy-doc-panel`, `#strategy-doc-section-<key>`.
- Tests: pure + store + handler.

### P2 — Agent reads and edits the document
- Doc injected into the system prompt (capped) + `get_strategy_doc` tool.
- New proposal kind `strategy-doc-edit` `{section, text, expectedVersion}`; executor writes the doc with
  `source:'chat'`, `proposalId`. ProposalCard shows before → after for the section.
- Prompt: the doc is the owner's strategy; argue from it; when a doc change implies a knob change, propose both;
  decisions section = settled, don't relitigate unless data contradicts it (say so with evidence).
- Change lines: every saved doc/plan version appends an `event` message to the active thread
  ("Strategy v8 — Rules edited by you"). Chat renders them as dividers.

### P3 — Algorithm + own-profile tools
- `get_algorithm`: active profile (`features/x-growth/algorithm-profiles`, id + what is rewarded/penalized, weights).
- `score_posts`: `scoreXPost` over the top/recent originals of own or a benchmark corpus (originals only; quote-react
  caveat attached).
- `get_audience`: stored X Monitor snapshots (follower trend, gained/lost) — read-only, no sync, no spend.
- `get_rule_check`: `guardXPost` over own recent posts → violations list.

### P4 — Refresh + Review
- **Refresh data** button (Strategy tab header): queues own + all benchmark handles on the existing free `bird`
  refresh queue; shows per-handle freshness + queue state (needs the Mac worker).
- **Review strategy** button: one agent turn with a fixed brief — what changed in the data since `lastReview`, then
  each doc section marked holds / weaker / contradicted with evidence, then ≤2 proposals. Starts a thread if none.
  Stamps `lastReview`. Banner "New data since last review" when corpora are newer than `lastReview.dataAsOf`.
- **Start session** (empty chat) = the same review, framed as an opener with 2–3 threads to pull.
- Manual click only (≈ $0.05–0.10 per review, counts toward the daily turn cap).

### P5 — The document runs the system
- `loadContentContext` lists the strategy doc as an input (version, confirmed/draft).
- Daily-run record stamps `strategyDocVersion`.
- Model drafting (`buildDraftPrompt`) gets the **rules** + **formats** sections (capped) when the doc is confirmed.
  Deterministic loop unchanged (it already follows the plan knobs).

### P6 — Docs, verification, ship
- SSOT update: `docs/source-of-truth/X-STRATEGY-TAB.md` (Strategy doc section) + CLAUDE.md pointer.
- Full scoped tests; localhost :3002 walkthrough against prod data (read-only except owner-confirmed saves).
- Push branch → preview READY → owner OK → fast-forward main.

## Keep vs change

Keep: plan doc + knobs, tracks, Insights, propose→confirm, chat threads, refresh queue, daily loop logic.
Change: add doc store/tab/tools/proposal kind/review action; prompt gains doc + new tools; drafter gains two sections.
Untouched: `DashboardPage.jsx`, X API paths, posting/scheduling, Telegram.

## Risks

- Prompt size/cost grows with the doc → cap injected text; Review is click-only.
- Benchmark post text is third-party → stays quoted data in tool results, never instructions.
- Refresh depends on the Mac `bird` worker; the UI must say "queued — waiting for the Mac worker", not "done".
- Chat never applies changes on its own; doc edits from chat are proposals only.
- Seeded draft must read as a draft so the agent and drafter don't treat it as confirmed strategy (drafter only uses a
  confirmed doc).

## Phase order

P1 → P2 → P3 → P4 → P5 → P6, tests green at each step; one preview deploy at the end.
