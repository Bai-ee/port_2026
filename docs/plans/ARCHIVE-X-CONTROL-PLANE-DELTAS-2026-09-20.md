# Archive Control-Plane Contract Deltas (2026-09-20, W5)

Companion to `assetManager/docs/archive/CONTROL_PLANE.md` (worker repo, not
edited from here — HITLOOP cannot touch that repo). This records what changed
on the HITLOOP side of the contract during W5 of
`docs/plans/ARCHIVE-X-MASTER-PLAN-2026-09-20.md`, so the worker owner can port
these notes into `CONTROL_PLANE.md` from the assetManager repo.

No wire-format change. Every delta below is HITLOOP-side storage/read
behavior; the worker's heartbeat/source-registration request bodies are
unchanged and need no daemon.ts edits.

## 1. Source registration now also creates the worker doc

`POST /api/archive/worker/sources` used to write only
`archive_workers/{workerId}/sources/{sourceId}`. The parent
`archive_workers/{workerId}` doc was created **only** by the first heartbeat,
so a freshly registered worker was invisible on `/archive` (WAITING FOR
WORKER, empty BROWSE target) until its first heartbeat landed — normally ~10s
later, but a real gap if the daemon's heartbeat ever lags registration.

As of this delta, `sources` POST also upserts
`archive_workers/{workerId}` with `{workerId, registeredAt (first write
only), updatedAt}` (merge). No new fields in the request payload; this is
pure HITLOOP-side storage. Nothing for the daemon to change.

## 2. Heartbeat no longer blanks `counters` on an idle beat

Previously the heartbeat route wrote `counters: counters || null`
unconditionally. Since `JSON.stringify` drops an `undefined` key, the
daemon's idle ONLINE heartbeat (`daemon.ts` — no `counters` field at all, sent
on startup and every ~12 polls / ~60s) landed as `counters: undefined` in the
request body, and the route wrote `counters: null` over Firestore — wiping a
just-completed job's numbers within about a minute of job completion.

Delta: the route now only writes the `counters` field when the heartbeat
payload actually carries a non-null counters object. An idle heartbeat with
no counters leaves the stored `counters` field untouched.

Additionally, whenever a heartbeat **does** carry counters, the route now
also stamps:

```json
{
  "lastJobCounters": { "discovered": 0, "hashed": 0, "duplicates": 0, "failed": 0 },
  "lastJobAt": "<server timestamp>"
}
```

`lastJobCounters`/`lastJobAt` are a defensive second copy: they survive even
if a *later* job's own early heartbeats reset `counters` to a fresh zero
state before an operator has seen the previous job's final tally. The
`/archive` page renders `counters` when present, else falls back to
`lastJobCounters` with a "from last completed job · <relative time>" label.

Still nothing for the daemon to change — this is purely how HITLOOP persists
and reads a payload shape the daemon already sends.

## 3. New read-only endpoint: recent commands for a worker

`GET /api/archive/commands/process?workerId=<id>` (admin-auth, same file as
the existing `POST` on that route — no new route file, to stay inside the
Vercel Hobby function-packaging cap). Returns the last 5 `archive_commands`
docs for that worker across all types (`PROCESS_COLLECTION`,
`LIST_DIRECTORY`, `UPLOAD_ASSET_ARWEAVE`) and all states, newest
`updatedAt`/`createdAt` first:

```json
{ "commands": [{ "id": "...", "type": "PROCESS_COLLECTION", "state": "COMPLETE", "error": null, "updatedAt": "...", "createdAt": "..." }] }
```

`error` is only populated when `state === 'FAILED'`. This is purely a
HITLOOP-side read of the existing `archive_commands` collection the worker
already writes via `PATCH /api/archive/commands/worker` — no new writes, no
daemon change.

Deliberately implemented as a single-equality-filter Firestore query
(`where('workerId','==',...)`, no `orderBy`), fetching the worker's full
command history and sorting/slicing to 5 in memory — the same
fetch-then-sort style `GET /api/archive/workers` already uses. An
equality-filter-plus-orderBy-on-a-different-field query needs a Firestore
composite index; this repo avoids introducing new composite indexes where a
full-collection-per-worker read is cheap enough (per-worker command volume is
small).

## 4. `/archive` display state is now derived, not just echoed

Not a contract change (no new fields read from the worker beyond what's
above), but worth noting for the worker owner: `/archive` no longer shows a
raw `worker.state` forever. If `lastHeartbeatAt` is older than 180s, the page
shows OFFLINE with "last seen <relative time>" regardless of the last stored
`state` value — because a worker that dies mid-idle-loop (no SIGTERM, no
final OFFLINE heartbeat) leaves `archive_workers/{id}.state` stuck at
whatever it last successfully wrote. PROCESSING/ERROR/PAUSED are still
trusted as-sent (not staleness-checked) since those only ever arrive from an
active daemon loop.

This means the worker does **not** need to be taught to send an explicit
`OFFLINE` heartbeat on graceful shutdown for `/archive` to reflect it — 180s
of heartbeat silence is now sufficient. Sending one anyway (if daemon.ts ever
adds a `SIGTERM`/`SIGINT` final heartbeat) would just make the offline
transition faster and more precise; not required.
