# HITLOOP: always-on server handoff

**Audience:** an agent setting up the HITLOOP development environment on the owner's always-on server (a 2019 Intel
MacBook Pro, macOS 14, MacPorts instead of Homebrew, node via nvm). Read this whole file, then work through it in
order. Stop and ask the owner wherever a step says so, and whenever the machine disagrees with this doc.

Written 2026-11-09 on the owner's main Mac (the "old Mac"). The Life Timeline photo ingest is a **separate** project
with its own doc (`Bai-ee/assetManager` → `docs/photolib/SERVER-HANDOFF.md`, branch `feat/photolib`); if it is
already running on this machine, never disturb it (it needs the NAS to itself and its own dev server on :3005).

## What this machine is for (for now)

- A full working copy of HITLOOP (hitloop.agency) and its satellite repos, ready for development sessions.
- **Not** a job runner yet. The three scheduled jobs (X quote scan, strategy-refresh worker, NAS archive analyzer)
  stay on the old Mac until the owner says to move them. Running them in two places double-scans and double-spends.

## Hard rules (from the repo's CLAUDE.md; read that file after step 5 restores it)

1. No deploys, Vercel env changes, Firestore/Storage rules deploys, or paid API calls without the owner's OK.
2. **X API is metered and writes are irreversible.** Read `docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md`
   before any X work. No X write without a free dry run and the owner's explicit OK for that batch.
3. **Never curl `/api/worker/*` locally.** `CRON_SECRET` is unset in dev, so those routes really run their jobs and
   spend money.
4. Do not install the launchd plists or run `scripts/x-content/scan-*`, `strategy-refresh-worker`, or the archive
   analyzer here.
5. The repos are **public** (`port_2026`, `assetManager`, `arweave-video-generator`): never commit `.env*`,
   `.vercel/`, `.claude/mcp.json`, `docs/company-brain/clients/*/live-export-*`, client data, or personal data.
6. Do not run `npm run build` in a checkout whose dev server is running (it clobbers `.next` → ChunkLoadErrors).
   Use a separate worktree for builds.
7. Commit on feature branches; push only when the owner asks.

## 1. Toolchain

Already on the machine per the server agent's report: MacPorts, `gh` (logged in as Bai-ee), nvm.

```sh
nvm install 24 && nvm alias default 24          # Next 16 / React 19; satellites need node >=20
sudo port install ffmpeg8                        # video posters/renders in scripts; note the binary path
npm i -g vercel firebase-tools                   # old Mac: vercel 64.x
```

Python: some scripts use a local venv (`.venv`, `scripts/.venv-img`). Create them only when a task needs them.

## 2. Clone the repos

```sh
mkdir -p ~/Documents/Repos && cd ~/Documents/Repos
git clone https://github.com/Bai-ee/port_2026.git Bballi_Portfolio
cd Bballi_Portfolio && git checkout feat/client-content-sources && npm ci && cd ..
git clone https://github.com/Bai-ee/assetManager.git assetManager
cd assetManager && git checkout analyzer-fast-rerun && npm ci && cd ..
git clone https://github.com/Bai-ee/hitloop-video.git hitloop-video
cd hitloop-video && git checkout wip/handoff-2026-11-08 && npm ci && cd ..
mkdir -p EditVideos && git clone https://github.com/Bai-ee/arweave-video-generator.git EditVideos/arweave-video-generator
cd EditVideos/arweave-video-generator && git checkout feat/player-drawer-acidman && cd ../..
```

| Repo | Branch to start on | What it is |
|---|---|---|
| `port_2026` → `Bballi_Portfolio` | `feat/client-content-sources` (owner's active work; `main` = production) | hitloop.agency: Next.js 16 app, dashboard, API routes, crons |
| `assetManager` | `analyzer-fast-rerun` (what the old Mac's analyzer runs) | NAS worker: archive analyzer, organizer, Discogs CLI, photolib |
| `hitloop-video` | `wip/handoff-2026-11-08` (snapshot of `feat/ue-acidman-promo-drawer` + uncommitted work) | Remotion client videos |
| `arweave-video-generator` | `feat/player-drawer-acidman` | EditVideos render worker + Underground Existence site |

Worktree convention on the old Mac: one checkout per branch at `~/Documents/Repos/Bballi_Portfolio-<name>`
(`git worktree add ../Bballi_Portfolio-<name> <branch>`). Create them only when a task needs that branch. 40+ other
feature branches are already on GitHub; most are merged into `main` by squash.

Branches deliberately NOT pushed (June 2026, obsolete): `onboarding-brief`, `production`,
`snapshot/studio-worktree-20260804`. `feat/mcp-server`'s last commit shipped to `main` as `e4bce520`.

## 3. Secrets (owner sends privately: AirDrop or a password manager; never git, never the NAS)

| File | Notes |
|---|---|
| `Bballi_Portfolio/.env.local` | 68 keys; covers every worktree. The Life Timeline worktree adds `LIFE_OWNER_UIDS`. |
| `Bballi_Portfolio/.claude/mcp.json` | lazyweb MCP bearer token |
| `assetManager/.env.local` | worker keys (control URL, worker token/id, TwelveLabs, Anthropic, Discogs, Arweave wallet JWK) |
| `EditVideos/arweave-video-generator/.env.local` | render worker keys |

`chmod 600` each. Vercel: `vercel login` (owner completes), then `vercel link` in `Bballi_Portfolio` (project
`port_2026`). Production env can be read with `vercel env pull` if ever needed. Do not change it.

## 4. Mount the NAS

Same share as the photo project (`/Volumes/bryan`, guest SMB; ask the owner for the address if it is not mounted).

## 5. Restore local-only files (from `/Volumes/bryan/HITLOOP-ARCHIVE/_hitloop-handoff/`)

Run one NAS copy at a time; if the photo ingest is running, wait for a pause between batches or ask the owner.

| Archive | Extract | Contents |
|---|---|---|
| `bballi-portfolio-local-files.tar` | `tar -C ~/Documents/Repos/Bballi_Portfolio -xf …` | git-ignored but real: `CLAUDE.md` (repo map, read it), `.claude/` skills + settings, `.agents/`, `data/` (X audit logs), `docs/diagnostics`, `docs/storyboards`, `clients/`, `ds-bundle/`, `.ds-sync/`, `print-screenshots/`, portfolio media in `public/img`, `public/ui-teasers`, `public/vid/reel.mp4`, `services/loopcore/{inputs,outputs}`, a few untracked files (2.2 GB) |
| `claude-context.tar` | `tar -C ~ -xf …` | `~/.claude/CLAUDE.md` (global working rules), `settings*.json`, global `skills/`, `threads/` (saved working threads; `/open` lists them), `plans/`, and the project memory folder |
| `mac-jobs.tar` | reference only; **do not install** | `~/.local/hitloop/run-main.sh` + the 3 `com.hitloop.*` launchd plists |

**Memory path fix:** Claude Code keys project memory by the repo path. The archive holds
`~/.claude/projects/-Users-bballi-Documents-Repos-Bballi-Portfolio/memory`. On this machine the key is built from
this home folder; move it:

```sh
mkdir -p ~/.claude/projects/-Users-$(whoami)-Documents-Repos-Bballi-Portfolio
mv ~/.claude/projects/-Users-bballi-Documents-Repos-Bballi-Portfolio/memory ~/.claude/projects/-Users-$(whoami)-Documents-Repos-Bballi-Portfolio/
```

Memory files and threads mention `/Users/bballi/...` paths; read them as relative to the repos folder.

## 6. Verify

```sh
cd ~/Documents/Repos/Bballi_Portfolio
npm test                                   # full node --test suite (it was green on the old Mac for merged work)
nohup npm run dev > /tmp/hitloop-dev.log 2>&1 &   # next dev --webpack on :3000
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/        # expect 200
npx playwright install chromium           # once; the smoke script drives a headless browser
npm run smoke:routes                       # loads public pages + /api/health only (no worker routes)
```

Report: test pass/fail counts, dev 200, smoke result. Failures in `feat/client-content-sources` WIP are possible
(the invoice studio + brief OG image snapshot was committed as `wip` with only invoice tests run: 63/63).

## 7. Then

Tell the owner the environment is ready and ask what to work on. Starting points:

- `CLAUDE.md` (repo root, restored in step 5): the map of every surface and its source-of-truth doc.
- `docs/source-of-truth/`: canonical docs per feature.
- `~/.claude/threads/INDEX.md` + `/open`: saved working threads with restart prompts.

## Later: moving the scheduled jobs (only when the owner says so)

1. Old Mac: `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.hitloop.<job>.plist` for each job.
2. This machine: create a runner worktree (`git worktree add ../Bballi_Portfolio-runner --detach origin/main`), copy
   `.env.local` into it, install `run-main.sh` to `~/.local/hitloop/`, fix the user paths inside the plists, install
   `bird` (X CLI using browser cookies, needed by the quote scan, which requires a logged-in browser on this machine),
   then `launchctl bootstrap gui/$(id -u) <plist>`.
3. Watch one run of each before calling it done.
