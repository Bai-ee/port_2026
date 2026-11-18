# CQ How-To Video Requests — lifecycle

Built 2026-11-18. Not deployed yet; the render step is behind `CQ_HOWTO_ENABLED` (default off). The cron, job fields and troubleshooting are in [`CQ-DAILY-BRIEF-VIDEO.md`](CQ-DAILY-BRIEF-VIDEO.md) section 13. The request format (v3) is `clients/critters-quest/docs/VIDEO_REQUEST_TEMPLATE.md` in the `hitloop-video` repo (section 4 is the automation contract); it is not copied here.

ChatGPT proposes, the owner builds and approves, the cron renders. Nothing posts by itself.

## Lifecycle

| # | Who | Step | Result |
|---|---|---|---|
| 1 | ChatGPT | `video.howto.request.submit` | `howto_requests/<id>` `status: 'submitted'` |
| 2 | ChatGPT | `queue.draft.create` with the one-line brief | CQ draft with `howto=<id>` |
| 3 | owner + Claude | `/cq-howto` in `hitloop-video`: spec, VO, review | `specs/<id>.json` + mp3s committed |
| 4 | owner | redeploy `showcase-render` | the spec is in the image |
| 5 | owner | `approve-request.mjs` (dry run, then `--write`) | `status: 'approved'` + `specHash` |
| 6 | cron | render `CQ-HowTo`, attach to the draft | draft has video + poster |
| 7 | human | approve the post in the calendar | normal publish path |

## 1. Submit (`video.howto.request.submit`)

Catalog action in `features/x-strategy/agent/catalog/video.js` (tier 1, Firestore only, no render, no spend); route `app/api/dashboard/howto-requests/route.js`; logic `features/brief-video/howto-request.js`. Body: `{action: 'submit', request: <v3 YAML as JSON>}`. `video.howto.request.get` (GET `?action=get&id=`) returns status, owner `note`, warnings, `briefLine`.

- **Client allowlist:** `HOWTO_ALLOWED_CLIENTS = ['paradice-dbBQCHUX']`; anything else is 403 `client-not-allowed:<id>`. The client comes from the caller's auth context, not the body.
- **Errors (400 `invalid-request`, nothing saved):** `request_version` is not 3; `narration` present but not a boolean; `id` not `[a-z0-9-]{3,48}`; `review_on` not `YYYY-MM-DD`; `type` not `how-to`/`feature-promo`; `game_commit`, `goal`, `audience`, `public_copy`, `hook`, `banner`, `host.name`, `arrival.say` missing; `public_copy` over 280 chars; `steps` not 2 to 4 items, or a step missing `say`/`panel`/`surface`/`clicks` (each click needs `target` and `handler`); `payoff.say`, `payoff.spot_art`, `payoff.town.name` missing, or `payoff.town.level` not an integer 1 to 15; request over 32 KB.
- **`narration` (template v3.1):** optional boolean, default `false` (narration/voice-over off). Only the owner's request should set `true`. A non-boolean is a 400 `invalid-request` with `narration must be true or false`; the value is stored as given in `request`. The catalog description says narration is off unless `narration: true`.
- **Warnings (saved and returned):** the template section 3 copy budget: step `say` 4 to 8 words, `arrival.say` up to 5, `payoff.say` 4 to 6, `banner` 2 to 3 words and UPPERCASE.
- **Lock rule:** create or overwrite only while the doc is absent or `status === 'submitted'`. Otherwise 409 `request-locked:<status>` (or `other-client`). The agent can never set `building`, `approved` or `rejected`, and those statuses are locked from the MCP side: a rejected request cannot be resubmitted under the same id; use a new id.
- **Response:** includes `briefLine` = `INTERNAL VIDEO BRIEF: howto=<id>`.

## 2. Draft (`queue.draft.create`)

`content` = `public_copy` + `"\n\n"` + `briefLine`. The brief text must be exactly `howto=<id>`: extra text, other case or YAML makes it `invalid` and it is never rendered (`CQ-DAILY-BRIEF-VIDEO.md` section 3). The draft's `reviewOn` must be on or before `2026-12-17` (`HOWTO_CAMPAIGN_UNTIL`), else `after-campaign`. Until the request is approved the draft waits (`videoBriefStatus: 'waiting_howto'`, flag on). The publish guard still blocks approving a draft whose brief is not yet attached.

## 3. Build (owner, `hitloop-video`, `/cq-howto`)

Skill: `.claude/skills/cq-howto/SKILL.md`. In order:

1. Read the request; verify every click in the game code at `game_commit`.
2. Storyboard gate: shot table, owner approves.
3. Build `src/howto/specs/<id>.json` and any missing panels (plan reviewed first).
4. `npm run howto:vo -- src/howto/specs/<id>.json` in `clients/critters-quest`. **This calls ElevenLabs and costs money: owner-approved only.** It writes the mp3s under `public/` and `vo[line] = {file, text}` into the spec.
5. Review in Remotion Studio (`CQ-HowTo`). Owner notes become rules in `HOWTO_RULES.md`.
6. Set `mode` to `"final"` only after owner approval.
7. Commit the spec and the mp3s.

## 4. Redeploy `showcase-render`

The service reads the spec and mp3s from its image. It never generates VO. Redeploy per `SITE-SHOWCASE-VIDEO.md` section 8, then note the revision (optional `--image-revision`).

## 5. Approve (owner script)

```
node scripts/cq-howto/approve-request.mjs --id <id> --spec <path/to/specs/<id>.json>        # dry run
node scripts/cq-howto/approve-request.mjs --id <id> --spec <path> [--image-revision <rev>] [--note "..."] --write
```

The script reads production Firestore even in a dry run (read-only); only `--write` writes, and only to that one `howto_requests/<id>` doc (one transaction that re-reads the record and re-checks before `update`). The dry run prints the current record, the computed `specHash` and the planned write; nothing changes without `--write`. It refuses if the request does not exist, `spec.mode !== 'final'`, or `spec.id !== --id`. It writes `status: 'approved'`, `specHash`, `approvedAt`, `approvedBy: 'owner-script'`, and optional `imageRevision`/`note`. `--status building|rejected` marks the doc without a spec. Needs `FIREBASE_ADMIN_*` in `.env.local`. MCP cannot do this.

### specHash

`howtoSpecHash` (app `features/brief-video/howto.js`, service `services/showcase-render/job.mjs`): sha256 of `JSON.stringify(sortKeysDeep({...spec, mode: 'final'}))`, hex, first 16 characters. Keys are sorted recursively, arrays keep order, `mode` is forced to `"final"` so a review/final flip does not change it. Both repos test it on `{"b":1,"a":{"d":[2,1],"c":"x"},"mode":"review"}`.

**The spec must be byte-for-byte (in content) the one deployed.** The hash covers every field, including `vo[line].text`, so changing any word, timing or mp3 reference after approval changes it. The job carries the approved `specHash`; the service recomputes it from the spec in its image and fails `validate: spec-hash-mismatch` if they differ. After any spec change: commit, redeploy, run the approve script again (new hash, new job id, fresh attempts). The mp3 bytes are not hashed, only their `file` and `text`; do not swap an mp3 under the same name without redeploying.

## 6. Render and attach (cron)

With `CQ_HOWTO_ENABLED=true` the `*/15` tick finds the ready draft, creates a `cq-howto` job and pokes the service. The next tick attaches the mp4 and poster, strips the brief from `content`, clears `videoBriefStatus`/`videoBriefReason`, and sets `mediaMetadata.source: 'cq-howto'`. Do a `?dryRun=1` first (`CQ-DAILY-BRIEF-VIDEO.md` section 9).

## 7. Human approves

The reviewer watches the video in the calendar before approving. It is rebuilt UI with mock numbers, not footage of the game.

## Who can change what

| State | ChatGPT (MCP) | Owner script | Cron |
|---|---|---|---|
| `howto_requests/<id>` | create/overwrite while `submitted` | set `approved`/`building`/`rejected` | read only |
| draft | create | none | writes `videoBriefStatus`/`Reason`, then attach |
| spend | none | `npm run howto:vo` (ElevenLabs), owner OK | render only (about $0.07 to $0.10) |
