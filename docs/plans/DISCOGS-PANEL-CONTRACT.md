# Discogs panel — locked contract (v1: Plan + Add to collection + Undo)

Owner-approved 2026-10-08. The Content Engine card gets a Discogs source panel that works like the NAS panel: pick a folder, see the price, run the label read + match on the Mac, review held records, add to the Discogs collection, undo. Render & draft (publish-cli) and NAS renames are **out of scope for v1**.

Owner decisions: Discogs runs **inside the existing analyzer process** (one thing to start). Held-record decisions live in **Firestore** (`discogs_decisions`). v1 = **Plan + Add to collection** (+ undo).

## Transport (same split as NAS)

- Free/read-only: browser → Mac analyzer `http://127.0.0.1:8777` (`localThumbBase` from `nas-status`). Same loopback-Host + origin allowlist as `/nas/*`.
- Paid / writes: dashboard → `POST /api/dashboard/quote-targets {action:'discogs-*'}` → Firestore `archive_commands` → analyzer polls `/api/archive/commands/worker` (existing) → PATCHes state/result (existing). **No new HITLOOP worker routes**: plan rows travel in the command `result`.

## Mac side (assetManager, branch feat/discogs-ingest)

Boundary rule kept: `lib/discogs` may import `lib/archive`, never the reverse. The analyzer gains a generic plugin seam; the Discogs plugin + composition root live in `lib/discogs`.

### Plugin seam — `lib/archive/analyzer/plugin.ts`
```ts
import type { Cmd, CmdUpdate } from './control';
import type { SourceInfo } from './store';
export interface PluginContext {
  update(u: CmdUpdate): Promise<void>;          // = control.update (use state 'RUNNING' + result.progress for progress)
  isCancelled(commandId: string): boolean;
  getSource(id: string): SourceInfo | undefined;
}
export interface PluginRouteRequest { method: string; pathname: string; url: URL; body: unknown /* parsed JSON for POST, else undefined */ }
export interface AnalyzerPlugin {
  name: string;
  commandTypes: string[];                       // claimed + run serially by the daemon; added to poll types + heartbeat capabilities
  run(cmd: Cmd, ctx: PluginContext): Promise<{ result: unknown; cancelled?: boolean }>;
  routePrefix?: string;                         // e.g. '/discogs/'
  route?(req: PluginRouteRequest, ctx: { getSource(id: string): SourceInfo | undefined; listSources(): SourceInfo[] }): Promise<{ status: number; body: unknown } | null>;
}
```
- `Cmd` gets an index signature (`[extra: string]: unknown`) so plugin fields ride along.
- Daemon: claims plugin types; `runOne` PATCHes `RUNNING`, calls `plugin.run`, then `COMPLETE {result}` or `FAILED 'CANCELLED by owner' {result}` when `cancelled`; thrown error → `FAILED`. Existing ANALYZE/STAGE/CANCEL behaviour unchanged.
- Server: a pathname starting with a plugin `routePrefix` → origin check (as `/nas/ops`), JSON body (1 MB cap) for POST, `route()`; `null` → 404.
- `daemon.ts` exports `startAnalyzer({ plugins })`; the old `argv` main path calls it with `plugins: []`.
- Composition root: `lib/discogs/analyzer-entry.ts` → `startAnalyzer({ plugins: [discogsPlugin()] })`. `package.json` `archive:analyzer` points at it.

### Discogs runtime — `lib/discogs/run.ts` (pure-ish, injected deps)
- `planFolder({ dir, limit }, deps)` → `{ planId, rows: PlanRow[], plans: GroupPlan[], summary, spentUsd, cost, capReached, cancelled, remaining }`. Saves `runs/<planId>-plan.json` (full `GroupPlan[]`, same as the CLI). deps: `client`, `cacheDir`, `runsDir`, `indexPath`, `capUsd?`, `onProgress?({phase,done,total,spentUsd})`, `isCancelled?()`. Cap check before each **uncached** label read (estimate one read at the measured/rate-card price); on hit, stop and report `capReached:true`, `remaining`.
- `estimateFolder({ dir, limit }, deps)` → `{ groups, images, videos, cachedReads, uncachedReads, perReadUsd, estUsd, model }` — scan (index-cached) + cache lookup, **no model calls**.
- `applyPlan({ planId, items:[{groupId, releaseId}], notes, folderId=1 }, deps)` → re-fetches collection; already owned → `skipped`; else `addToCollection`, journal line `{releaseId, folderId, instanceId, group}` to `runs/<planId>-applied-<stamp>.jsonl`; notes (field 3, ≤250 chars, `HITLOOP ingest…`) only on records it just added. Returns `{ planId, journal (basename), applied:[{groupId,releaseId,instanceId}], skipped:[{groupId,releaseId,reason}], errors:[{groupId,releaseId,error}] }`.
- `undoApply({ journal }, deps)` → basename must match `/^[\w.-]+-applied[\w.-]*\.jsonl$/`, resolved inside `runsDir` only → `{ journal, removed:[{groupId,releaseId,instanceId}], errors }`.
- `ingest-cli.ts` becomes a thin wrapper over these; CLI flags/output/undo behaviour (incl. `--rename`, `--undo-renames`) unchanged.

### Discogs plugin — `lib/discogs/analyzer-plugin.ts`
Command types `DISCOGS_PLAN`, `DISCOGS_APPLY`, `DISCOGS_UNDO`. Folder = `getSource(sourceId).rootPath` + `relativePath` (reject absolute / `..` / escaping the root).

| Command | Fields (from HITLOOP) | COMPLETE `result` |
|---|---|---|
| `DISCOGS_PLAN` | `sourceId, relativePath, limit (≤300, default 300), capUsd (>0, ≤20, default 2)` | `{ planId, sourceId, relativePath, summary:{groups,add,alreadyOwned,review,unreadable}, rows: PlanRow[], spentUsd, cost:{billedCalls,cachedCalls}, capReached, remaining }` |
| `DISCOGS_APPLY` | `planId, items:[{groupId,releaseId}] (≤100), notes:boolean, folderId (1)` | applyPlan result |
| `DISCOGS_UNDO` | `journal, applyCommandId` | undoApply result |

Progress (PATCH `RUNNING`): `result.progress = { phase: 'scanning'|'reading'|'matching'|'adding'|'removing', done, total, spentUsd }`. Cancel = existing `CANCEL_JOB` (daemon reads `targetCommandId || jobId`); cancelled plan returns partial rows.

`PlanRow` (compact — keeps the Firestore doc well under 1 MB):
```ts
{ groupId, files: string[] /* basenames, ≤8 */, images: number, videos: number,
  read: { artist, title, label, catno, year } | null,
  candidates: { releaseId, title, catno, label, year, formats /* ≤3 */, score, reasons }[] /* ≤3 */,
  best: number | null, action: 'add'|'already-owned'|'review'|'skip-unreadable', reason: string, catnoExact: boolean }
```

Live endpoints (no model calls):
- `GET /discogs/status` → `{ ok, configured:{ discogsToken, anthropicKey }, username: string|null, collectionCount: number|null, defaultSourceId: string|null, defaultPath: string|null }` (identity cached 10 min; default folder = `DISCOGS_DEFAULT_DIR` or `/Volumes/bryan/MacTransfer/discogs`, mapped to the registered source whose root contains it).
- `POST /discogs/estimate {sourceId, relativePath, limit?}` → `{ ok, ...estimateFolder }`. First scan of a folder is slow (fingerprints over SMB); the index makes repeats fast.

## HITLOOP side (worktree Bballi_Portfolio-content-system)

### Actions — `features/discogs-ingest/actions.js`
`export const DISCOGS_ACTIONS`, `export async function handleDiscogsAction(deps, action, body, decoded)`; deps = the route's `nasDeps()` (`db, fieldValue, now, randomId`). Registered in `app/api/dashboard/quote-targets/route.js` exactly like `NAS_ACTIONS`. Equality-only Firestore queries (no new composite index). Reuses analyzer lookup from `x-content-inventory/nas.js` (export helpers there; no behaviour change).

| Action | Body | Returns |
|---|---|---|
| `discogs-status` | — | `{ ok, online, workerId, supportsDiscogs /* heartbeat capabilities include DISCOGS_PLAN */, localThumbBase, sources }` |
| `discogs-plan` | `sourceId, relativePath, limit?, capUsd?` | queues `DISCOGS_PLAN` (analyzer must be online + supportsDiscogs) → `{ ok, commandId }` |
| `discogs-jobs` | — | latest 10 DISCOGS_* jobs: `{ id, type, state, relativePath, planId, progress, summary, spentUsd, capUsd, counts:{applied,skipped,removed,errors}, journal, applyCommandId, error, createdAt, updatedAt }` |
| `discogs-cancel` | `commandId` | queues `CANCEL_JOB { targetCommandId, commandId }` → `{ ok, commandId }` |
| `discogs-records` | `planId?` | plan = given or latest DISCOGS_PLAN with rows (COMPLETE, or cancelled with partial rows) → `{ ok, plan:{ commandId, planId, sourceId, relativePath, summary, capReached, remaining, createdAt } \| null, rows: [PlanRow + { decision, status, added }] }` |
| `discogs-decide` | `groupId, decision:'accept'\|'skip'\|'reset', releaseId?, manual?` | writes/deletes `discogs_decisions/{groupId}` `{ groupId, decision, releaseId, planId, by, at }`. accept needs a positive integer `releaseId` that is one of the row's candidates, unless `manual:true` |
| `discogs-apply` | `planId, groupIds[] (≤100), notes?` | per group: `releaseId` = accepted decision's, else row.best when `action==='add'` and not skipped; anything else / already added → 400 naming the groups. Queues `DISCOGS_APPLY` → `{ ok, commandId, count }` |
| `discogs-undo` | `applyCommandId` | apply job must be COMPLETE with `result.journal`; queues `DISCOGS_UNDO { journal, applyCommandId }` → `{ ok, commandId }` |

Row `status` (derived, in order): `added` (in a COMPLETE apply result, not removed by a later COMPLETE undo; `added = { releaseId, instanceId, applyCommandId, journal }`) · `adding` (in a QUEUED/CLAIMED/RUNNING apply) · `skipped` (decision skip) · `ready` (action add, or decision accept) · `review` · `owned` (already-owned) · `unreadable`.

### UI — `components/dashboard/x-content/DiscogsPanel.jsx`
Mounted from `SourcePanel` when `bucket?.sourceKind === 'discogs' || bucketId === 'record'` (fixes the dead `bucketId === 'discogs'` branch). `BucketsPanel` also polls `nas-status` for the Discogs bucket so `localThumbBase` is known. Stable ids, plain language, no emoji, CSS at the END of the card's style block prefixed `#x-content-card`, reuse `xce-nas-*` classes where they fit.
- `#discogs-setup-checklist` — Mac online · Discogs support loaded (restart analyzer hint) · Discogs token · Anthropic key · NAS mounted.
- `#discogs-folder-row` — source + folder (default from `/discogs/status`), folder browser via `/nas/browse`.
- `#discogs-estimate-line` — live `/discogs/estimate` on folder change: records · label photos · already read (free) · ~price.
- `#discogs-plan-controls` — cap ($0–20, default 2) + **Read labels & match** → `discogs-plan`.
- `#discogs-jobs-list` — job rows like NAS (plan / add / undo in plain words), progress bar, Stop, **Undo** on a finished add job (inline confirm).
- `#discogs-results` — filter chips: Ready · Needs review · Added · Already owned · Unreadable · Skipped. Ready rows: checkbox (default on) + Skip. Review rows: candidate list (Discogs link `https://www.discogs.com/release/<id>`, score, reasons) + Use this / manual release id / Skip.
- `#discogs-apply-bar` — notes toggle + **Add N to collection** → inline confirm naming N → `discogs-apply`.
Polls jobs every 3 s while open; reloads records when a job finishes.

## Guardrails for every phase
No commits, pushes, deploys, real Discogs writes, or paid model calls without the owner's OK. Do not restart the analyzer while a batch is in flight. Leave assetManager's uncommitted organizer work untouched (`lib/archive/{control-plane,daemon,worker}.ts`, `lib/archive/organize/`, docs). Never edit `DashboardPage.jsx`.
