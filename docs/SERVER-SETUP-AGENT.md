# HITLOOP: set up the repo and localhost on a new machine (agent master doc)

**Audience:** a coding agent (Claude Code or similar) on the owner's home server. Goal: a current clone of
hitloop.agency (`Bai-ee/port_2026`), dependencies installed, secrets in place, and `localhost:3000` serving, so the
owner can start giving you code and feature tasks. Read this whole file first, then work through it in order.

Stop and ask the owner whenever a step says **ASK**, and whenever the machine disagrees with this doc. Do not guess
around a missing secret or a failing step.

Related, fuller doc (Mac-specific, also covers satellite repos, NAS, and local-only files):
[`docs/HANDOFF-ALWAYS-ON-SERVER.md`](HANDOFF-ALWAYS-ON-SERVER.md). Use it for steps 6-7 below if the owner wants the
full environment.

---

## 0. Hard rules (apply for the life of this machine)

1. **Localhost talks to production.** `.env.local` points at the live Firebase project (`human-in-the-loop-a1a19`),
   real Stripe, Anthropic, ScrapeCreators, X API, Resend, etc. Anything you click or call locally can change real
   client data or spend real money.
2. **Never call `/api/worker/*` routes** (curl, browser, scripts). With `CRON_SECRET` unset in dev they run their real
   jobs: paid scans, emails, posts. See step 5 for closing them.
3. **X API:** metered, and writes hit live accounts irreversibly. Read
   `docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md` before any X-related work. No X write without a free dry
   run and the owner's explicit OK for that batch.
4. **No deploys** (`vercel --prod`), Vercel env edits, Firestore/Storage rules deploys, or paid batch runs without
   the owner's OK.
5. **Public repo.** Never commit `.env*`, `.vercel/`, `.claude/`, `CLAUDE.md`, client data, personal data, or
   `docs/company-brain/clients/*/live-export-*`.
6. **Git:** work on feature branches off `main`. Commit when asked; push only when the owner asks. Never force-push
   `main`.
7. **Do not run `npm run build` in the checkout whose dev server is running.** It overwrites `.next` and the dev
   server starts throwing ChunkLoadErrors. Build in a separate worktree
   (`git worktree add ../Bballi_Portfolio-build <branch>`).
8. Do not install or run the scheduled jobs (launchd/cron: X quote scan, strategy-refresh worker, archive analyzer).
   They run on another machine; running them twice double-spends.

---

## 1. Detect the machine

Run and record the answers; later steps branch on them.

```sh
uname -a                      # Darwin = macOS, Linux = Linux/WSL
cat /etc/os-release 2>/dev/null | head -3
uname -m                      # x86_64 or arm64/aarch64
whoami; echo $HOME
command -v git node npm nvm port brew apt dnf ffmpeg gh 2>/dev/null
node -v 2>/dev/null
df -h $HOME | tail -1         # need ~10 GB free (node_modules + .next are large)
```

If the machine is Windows without WSL, **ASK** the owner before continuing (use WSL2 Ubuntu; native Windows is
untested).

---

## 2. Toolchain

Required: **git**, **Node 24** (the owner's Mac runs 24.7; Next 16 / React 19), npm (ships with Node).
Optional, install only when a task needs it: `ffmpeg` (video posters/renders), Playwright Chromium (smoke tests),
`gh` (GitHub CLI), `vercel` CLI.

Node via nvm (works on macOS and Linux, no sudo):

```sh
# skip if nvm already exists
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
nvm install 24 && nvm alias default 24
node -v   # v24.x
```

System packages (only what is missing):

| OS | git / ffmpeg | Build tools (for native modules if a prebuilt binary is missing) |
|---|---|---|
| macOS + Homebrew | `brew install git ffmpeg` | `xcode-select --install` |
| macOS + MacPorts | `sudo port install git ffmpeg8` (note the binary path) | `xcode-select --install` |
| Debian/Ubuntu/WSL | `sudo apt-get install -y git ffmpeg` | `sudo apt-get install -y build-essential python3` |
| Fedora/RHEL | `sudo dnf install -y git ffmpeg` | `sudo dnf groupinstall -y "Development Tools"` |

If ffmpeg is not at `/opt/homebrew/bin/ffmpeg` (the code's macOS default), add `FFMPEG_PATH` and `FFPROBE_PATH` with
the real paths to `.env.local` in step 4.

---

## 3. Clone the current repo

```sh
mkdir -p ~/Documents/Repos && cd ~/Documents/Repos
git clone https://github.com/Bai-ee/port_2026.git Bballi_Portfolio
cd Bballi_Portfolio
git checkout main && git pull --ff-only     # main = what is live on hitloop.agency
npm ci                                      # exact lockfile install; takes several minutes
```

Keep the folder name `Bballi_Portfolio`; docs, scripts, and worktree names assume it.

Branches:
- `main`: production. Start here. New work goes on `feat/<name>` branches cut from `main`.
- `feat/client-content-sources`: the owner's in-progress work (content-source inventory, not yet merged). Check it
  out only if the owner asks.
- Worktree convention: one extra checkout per branch at `../Bballi_Portfolio-<name>`
  (`git worktree add ../Bballi_Portfolio-<name> <branch>`), each with its own copy of `.env.local`.

If `npm ci` fails on a native module (`sharp`, `canvas`-like packages), install the build tools from step 2 and
rerun. Report the exact error if it still fails.

---

## 4. Secrets: `.env.local`

The app does not boot usefully without `.env.local` (~68 keys; `.env.example` lists the names). Two ways to get it;
**ASK** the owner which:

**A. Owner sends the file** (AirDrop, password manager, scp over the LAN). Never via git, chat logs, or the NAS.
Place it at `Bballi_Portfolio/.env.local`.

**B. Pull from Vercel** (owner must complete the login in a browser):

```sh
npm i -g vercel
vercel login                    # owner completes
vercel link                     # scope Bai-ee, project port_2026
vercel env pull .env.local --environment=development
```

If the development environment on Vercel is missing keys, pull `--environment=production` into a scratch file and
let the owner decide what to copy. Do not edit Vercel env.

Then:

```sh
chmod 600 .env.local
cut -d= -f1 .env.local | sort > /tmp/have.txt
grep -vE '^\s*(#|$)' .env.example | cut -d= -f1 | sort > /tmp/want.txt
comm -13 /tmp/have.txt /tmp/want.txt      # keys in .env.example but missing locally
```

Minimum for localhost to work: the `NEXT_PUBLIC_FIREBASE_*` block (client sign-in) and `FIREBASE_ADMIN_PROJECT_ID`,
`FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, `FIREBASE_ADMIN_STORAGE_BUCKET` (every API route). Report
any other missing keys to the owner; do not invent values.

Never print secret values in output or logs. Show key names only.

---

## 5. Start localhost

Close the worker routes first (rule 2). Add a random `CRON_SECRET` to `.env.local` on this machine only; the worker
routes then reject calls that lack it:

```sh
grep -q '^CRON_SECRET=' .env.local || echo "CRON_SECRET=$(openssl rand -hex 24)" >> .env.local
```

Run the dev server so it survives the agent session:

```sh
# Option 1: tmux (preferred; attach later with `tmux attach -t hitloop`)
tmux new -d -s hitloop 'cd ~/Documents/Repos/Bballi_Portfolio && npm run dev 2>&1 | tee -a ~/hitloop-dev.log'

# Option 2: no tmux
cd ~/Documents/Repos/Bballi_Portfolio && nohup npm run dev > ~/hitloop-dev.log 2>&1 &
```

`npm run dev` = `next dev --webpack` on port 3000. First compile of a page takes a while; that is normal.

```sh
sleep 20
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/            # expect 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health  # expect 200
tail -n 40 ~/hitloop-dev.log                                              # no repeated errors
```

Restart the dev server after editing server-side `.cjs` files under `api/_lib/` (they are cached in the dev
process): stop it (`tmux kill-session -t hitloop` or kill the PID) and start it again.

### Reaching it from other devices (only if the owner asks)

- Same network: start with `npx next dev --webpack -H 0.0.0.0 -p 3000` instead and open `http://<server-LAN-IP>:3000`.
  Allow port 3000 in the OS firewall if needed.
- Remote: use Tailscale (or similar private VPN), not port forwarding.
- **Never expose this dev server to the public internet.** It runs with production credentials.
- Sign-in from a LAN IP or Tailscale hostname fails until that host is added to Firebase Auth → Authorized domains.
  That is a production setting: **ASK** the owner. `localhost` already works. Google OAuth callbacks (Calendar, X,
  Instagram connects) only work on registered origins; test those on `localhost` or production.

---

## 6. Verify

```sh
cd ~/Documents/Repos/Bballi_Portfolio
npm test                                        # node --test suite; record pass/fail counts
npx playwright install --with-deps chromium     # once (Linux: --with-deps needs sudo; macOS: drop --with-deps)
npm run smoke:routes                            # loads public pages + /api/health against localhost:3000
```

`npm test` reads no network and spends nothing. `smoke:routes` only loads public pages; it does not touch worker
routes.

Then open `http://localhost:3000/` and `http://localhost:3000/dashboard` in a browser (if the machine has one) and
confirm the home page renders and the dashboard asks for sign-in.

---

## 7. Optional: the owner's local-only files

Some useful files are git-ignored and not in a fresh clone: the repo map `CLAUDE.md` (lists every surface and its
source-of-truth doc), `.claude/` skills and settings, `ds-bundle/` (design-system reference), portfolio media, and
the owner's Claude memory/threads. They are archived on the owner's NAS. Restoring them is covered in
[`docs/HANDOFF-ALWAYS-ON-SERVER.md`](HANDOFF-ALWAYS-ON-SERVER.md) §4-5. **ASK** the owner whether to do it.

Without them, orient from tracked docs:
- `docs/source-of-truth/SOURCE-OF-TRUTH.md`: launch-surface source of truth (wins on conflicts).
- `docs/source-of-truth/`: one canonical doc per feature. Read the relevant one before touching a feature.
- `docs/DEVELOPER-HANDOFF-CONTENT-SYSTEM.md`: content system entry point.
- `docs/README.md`: how the rest of `docs/` is organized.

---

## 8. Report to the owner

Keep it short:

```
Machine: <OS / arch>, Node <version>
Repo: Bballi_Portfolio @ <branch> <short sha>
Secrets: .env.local present (<n> keys), missing: <names or none>, CRON_SECRET set locally: yes/no
Dev server: http://localhost:3000 -> <code>, /api/health -> <code>, running in <tmux session / nohup PID>, log ~/hitloop-dev.log
Tests: npm test <pass>/<fail>; smoke:routes <result>
Problems / asks: <list>
```

Then ask what to work on.

---

## 9. Working on tasks afterward

- `git fetch && git checkout main && git pull --ff-only` before cutting each new branch.
- Read the feature's source-of-truth doc in `docs/source-of-truth/` before editing it.
- Small, reviewable diffs; preserve existing patterns. Inline `style` props are the house idiom for React UI.
- Adding a hex/rgba colour literal to a theme-migrated file fails `npm test` (theme allowlists in
  `lib/theme-migration/allowlists/`). Use theme tokens.
- Run `npm test` before reporting a change done; say which tests ran and what you checked in the browser.
- Large shared files (`DashboardPage.jsx`) hot-reload the whole dashboard: avoid saving them while the owner is mid-run
  in the browser.
