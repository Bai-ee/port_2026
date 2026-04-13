# Dashboard Terminal UI — Datapoint Handoff Guide

Status: Source of truth for terminal UI work
Scope: How to surface new datapoints / pipeline steps in the dashboard terminal(s)

## Purpose

When we add a new datapoint or pipeline step (screenshot capture, narrator, competitor scan, etc.), the dashboard terminal(s) need to reflect it. Point any agent at this doc before they add or edit terminal output.

## Two terminals exist — pick the right one

The dashboard currently has **two distinct terminals** with **different data models**. Do not mix models.

### 1. Intake Terminal — live, backend-driven

- Builder: `buildTerminalLines()` at [DashboardPage.jsx:480](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:480)
- Data source: Firestore `run.progress` written by the backend via `emitProgress(stage, message, extra)` in [features/scout-intake/runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js:1)
- Cadence: **live** — advances when the backend writes a new stage
- Stage order: `['fetch', 'analyze', 'synthesize', 'compose', 'normalize']`
- Use when: the datapoint is part of an intake run (scout-intake owns it, or a concurrent task like a screenshot)

### 2. SEO Rerun Terminal — scripted, timer-driven

- Builder: `buildSeoRerunTerminalLines()` at [DashboardPage.jsx:636](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:636)
- Data source: client-side `seoRerunStage` advanced by `setTimeout` after the user presses Re-run ([DashboardPage.jsx:712](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:712))
- Cadence: **scripted** — stages fire at fixed elapsed times (0s / 10s / 25s / 38s / 52s)
- Stage order: `['start', 'fetch', 'audit', 'narrator', 'write']`
- Use when: the datapoint is a user-triggered one-shot (not tied to an intake run) and we have reasonable expected timings

Rule: if the backend emits real progress, wire it live — do not script it. If no live signal exists yet, a scripted terminal is acceptable but mark it so in a code comment.

## Line shape

Every terminal line is:

```
{ tag: string, text: string, type: 'label'|'dim'|'ok'|'active'|'error'|'success', active?: boolean }
```

- `tag` — 3–7 char uppercase label (e.g. `FETCH`, `SCREEN`, `AI`, `WRITE`)
- `text` — short sentence; present tense for active, past tense for ok
- `type`:
  - `label` — section banner (start / done)
  - `active` — currently running (pair with `active: true` for cursor/blink)
  - `ok` — completed
  - `dim` — muted detail line
  - `error` — failure
  - `success` — final green result
- `active: true` — flags an in-flight line for UI treatment

## Stage semantics

- Exactly **one active line at a time** in the main flow — the thing currently running
- An `active` line must resolve to `ok`, `error`, or be superseded when the flow ends — no dangling spinners
- **Concurrent tasks** (e.g. screenshot running during fetch+analyze) are rendered as `active` during earlier stages and flipped to `ok` at the earliest stage where the main pipeline is guaranteed to have awaited them

Example — screenshot in the intake terminal:

- Emitted at the `capture` stage but runs in background during `fetch` + `analyze`
- Shown as `SCREEN active` while `currentIdx <= 1` (fetch/analyze)
- Shown as `SCREEN ok` once `currentIdx >= 2` (synthesize), because by then it has been awaited

See [DashboardPage.jsx:549-558](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:549) for the canonical pattern.

Example — device mockup generation in the intake terminal:

- Emitted at the `compose` stage after screenshots + synthesis are ready
- Shown as `MOCK active` while `currentIdx === 3`
- Shown as `MOCK ok` once `currentIdx >= 4` (normalize), because by then the composited mockup has been persisted

## Adding a new datapoint — checklist

1. **Decide which terminal** it belongs to (intake, SEO rerun, or a new one — see "New terminal" below).
2. **Pick a tag** — ≤7 chars, uppercase, distinct from existing tags (see inventory below).
3. **Decide live or scripted:**
   - Live: backend calls `emitProgress(stage, message, extra)` and the frontend builder handles the new stage key
   - Scripted: add a stage to the client-side state machine and extend the `setTimeout` ladder; document expected duration in a code comment
4. **If concurrent**, identify:
   - earliest stage where it can appear as `active`
   - earliest stage where it is guaranteed resolved (appear as `ok`)
5. **Update the builder function only** — do not scatter line-construction logic across components.
6. **Handle every state:** running, succeeded, cancelled, failed. If the datapoint can fail independently of the main flow, emit an explicit `error` line.
7. **Test all transitions locally** — not just the happy path.

## Live-terminal wiring (intake pattern)

**Backend** ([features/scout-intake/runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js:1)):

- Call `emitProgress(stage, message, extra)` at the point the datapoint state changes
- `stage` is a short string; add it to the frontend `stageOrder` array if sequential, or handle as a concurrent branch
- `extra` is merged into `run.progress` — use it for structured values (counts, URLs, etc.)

**Frontend** (`buildTerminalLines`):

- Read `progress.stage`, compute `currentIdx = stageOrder.indexOf(stage)`
- Gate line emission on `currentIdx >= N`
- Concurrent task lines key off both their own state and the parent stage's index

## Scripted-terminal wiring (rerun pattern)

- Add the stage key to the state machine and the advance ladder ([DashboardPage.jsx:712](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:712))
- Add the builder branch that renders the cumulative line set for that stage (earlier stages as `ok`, current as `active`)
- Tune timings against observed durations; prefer staying `active` slightly too long over flipping to `ok` before the backend finishes

## Rules (do not deviate)

- One builder per terminal — do not scatter line construction
- Line output must be pure: `(state) → lines[]`. No side effects, no fetches
- Never display raw data (JSON blobs, tokens, errors >140 chars) — truncate with `…`
- Every `active` line must have a resolution path
- Preserve existing tags when editing; if a container needs targeting for styling, use `id` / `data-section` on the rendered element, not on the line data
- Don't introduce new `type` values without updating this doc
- Don't add line building inside React components — it goes in the builder function
- Don't add a scripted timer to mask a missing backend signal — wire the live signal instead

## When a new terminal is justified

Only add a third terminal if **all** of these are true:

- Trigger is distinct from an intake run and from the SEO rerun button
- Flow is user-visible and warrants its own card
- No existing terminal is a natural home

If you add one, document it in this file with the same sections: data source, cadence, stage order, use-when.

## Anti-patterns

- Hardcoding line text inside JSX
- Multiple active lines in the same terminal at the same time
- Debug-style tags (`DEBUG`, `LOG`) — tags are user-facing
- `text` >90 chars — summarize or split across two lines
- Scripted timers substituting for missing backend signals
- Mixing live and scripted sources in the same builder

## Tag inventory

Update this table when introducing a new tag.

| Tag | Meaning | Terminal |
|-----|---------|----------|
| START | Run began | Intake |
| QUEUE | Queued before worker claim | Intake |
| FETCH | Fetching site / data | Both |
| ANALYZE | Extracting structure | Intake |
| SCREEN | Screenshot capture | Intake |
| MOCK | Device mockup render | Intake |
| SYNTH | LLM synthesis (intake) | Intake |
| WRITE | Persisting to DB / state | Both |
| DONE | Run complete (label) | Intake |
| OK | Final success | Intake |
| CANCEL | Run cancelled | Intake |
| ERROR | Failure | Both |
| INFO | Informational | Intake |
| PROC | Processing (fallback) | Intake |
| SEO | SEO rerun banner | Rerun |
| AUDIT | Lighthouse analysis | Rerun |
| AI | LLM narrator | Rerun |

## Related files

- Builders: [DashboardPage.jsx:480](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:480), [DashboardPage.jsx:636](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:636)
- Rerun state machine: [DashboardPage.jsx:712](/Users/bballi/Documents/Repos/Bballi_Portfolio/DashboardPage.jsx:712)
- Backend progress emitter: [features/scout-intake/runner.js](/Users/bballi/Documents/Repos/Bballi_Portfolio/features/scout-intake/runner.js:1)
- Intelligence runner (future live wiring for rerun): [api/_lib/intelligence-runner.cjs](/Users/bballi/Documents/Repos/Bballi_Portfolio/api/_lib/intelligence-runner.cjs:1)
