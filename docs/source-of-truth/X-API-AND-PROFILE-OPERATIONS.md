# X (Twitter) API & Profile Operations — SSOT

How to work with the X API in this repo and how to make changes to the **real `@bai_ee` account**.

Two things make this surface different from everything else in the codebase:

1. **It costs money per call**, on a credit model that is *not* visible in the Operating Cost card.
2. **Writes are irreversible and public.** An unfollow, a post, or a delete happens on a live account with real followers. There is no undo.

Because of that, this doc opens with a hard gate.

---

## 0. THE SPEND GATE (read before any execution)

> **No agent executes an X API write without the user confirming spend first.**

Before running anything that hits the X API in write mode, you MUST:

1. **Run the free dry-run** (see §4 — it makes zero network calls) to get the exact operation count.
2. **Report to the user, in one message:**
   - how many API calls the run will make,
   - which credit-consuming endpoints they hit,
   - the current credit/plan state *if known* (and say plainly if it is not — see §3),
   - that the action is irreversible.
3. **Wait for explicit approval.** "Go", "run it", "yes" — an actual answer. Silence, a thumbs-up on an unrelated message, or approval from an earlier session does not carry over.
4. **Cap the run.** Always pass `--max=N` on the first execution after any pause. Never uncork the full backlog on a resume.

Approval for one batch is approval for **that batch only**. Come back and re-confirm for the next one.

**Never** do any of these without a fresh, explicit instruction naming the action:
- post, reply, quote, or delete a tweet
- follow or unfollow an account
- change profile fields (name, bio, avatar, banner, handle)
- change who can reply / account privacy

Reading this doc is not authorization. A task that merely *mentions* X is not authorization.

---

## 1. Account & credentials

| Thing | Value |
|---|---|
| Authenticated user | `@bai_ee` ("Baiee"), user id `18508964` |
| Enrolled dev account | `1918540743066472448` (from the 402 payload) |
| Client library | `twitter-api-v2` (`package.json`) |
| Auth style | OAuth 1.0a user context (4 keys — app key/secret + access token/secret) |

Env vars live in `.env.local` (untracked):

```
TWITTER_API_KEY
TWITTER_API_SECRET
TWITTER_ACCESS_TOKEN
TWITTER_ACCESS_SECRET
```

`scripts/unfollow-inactive-following.mjs` also accepts `X_*` aliases (`X_API_KEY`, `X_ACCESS_TOKEN`, …) and strips surrounding quotes. `features/social-posting/twitter-service.js` reads the `TWITTER_*` names.

---

## 2. Where the X API is called from

There are exactly **four** X API surfaces (§2a app-runtime OAuth 1.0a, §2b CLI, §2d app-runtime OAuth 2.0, §2e per-client publishing). Do not add a fifth without reading this whole doc.

### 2a. App runtime — `features/social-posting/twitter-service.js`
Backs the **Copywriter** and **Schedule Posts** cards.

| Call | Purpose |
|---|---|
| `v1.tweet(text)` | post (legacy path) |
| `v2.tweet(payload)` | post |
| `v1.uploadMedia(buffer, …)` | chunked media upload |
| `v1.verifyCredentials()` / `v2.me()` | connection check |
| `v2.userByUsername()` / `v2.userTimeline()` | watchlist pulls |

Already handles `429` and `402` with user-facing hints (`twitter-service.js:501-513`).

### 2b. CLI — `scripts/unfollow-inactive-following.mjs`
The only **profile-mutating** script. Calls `v2.unfollow(sourceUserId, targetId)`. See §4.

### 2c. NOT the X API — the cheap read path
Market Signals / Scout read X through **ScrapeCreators** (`features/scout-intake/external-scouts/scrapecreators-client.js`), not the X API. ScrapeCreators credits are ~$0.0012/credit and *are* tracked in the Operating Cost card.

> **Rule:** if you need to *read* X data, use the ScrapeCreators path. Only use the X API when you need to **write** as `@bai_ee`, or need something ScrapeCreators genuinely cannot provide.

### 2d. App runtime — `features/social-posting/x-oauth.js` (OAuth 2.0 user context)
Backs the **X Command Center** card (`x-profile`, admin-only, social bucket) — added 2026-07-19 because bookmarks are unreachable over OAuth 1.0a (and invisible to ScrapeCreators — they're private to the authed user). PKCE flow against the HitLoop app's OAuth 2.0 client (`X_OAUTH_CLIENT_ID` / `X_OAUTH_CLIENT_SECRET` / `X_OAUTH_REDIRECT_URI` env; tokens + in-flight PKCE state in Firestore `system_flags/x_oauth_tokens` / `x_oauth_pending`; refresh tokens rotate on use). Routes: `app/api/social-posting/x-oauth` (admin-gated status/start/disconnect/verify-bookmarks) + `…/x-oauth/callback` + alias `app/api/auth/twitter/callback` (matches the portal-registered prod callback). Connected as `@bai_ee` with all 11 scopes (tweet/users/bookmark/like/follows + offline.access) 2026-07-19; bookmark read access **verified live**.

Hard-won portal facts: authorize codes expire in ~30s (never route them through human copy-paste — the prod callback completes server-side); X rejects `localhost`/`127.0.0.1` OAuth 2.0 callbacks in practice; editing the callback list can transiently break the whole allowlist ("Something went wrong" on authorize) — re-save a single clean prod entry to repair. `GET /2/usage/tweets` works app-only (request counts vs monthly cap); dollar spend remains console-only.

### 2e. App runtime — Social Auto-Publish (per-client publishing) — `features/social-posting/adapters/x.js` + `social-accounts.js`
Added for the **Social Auto-Publish** feature (daily video → each client's own account, off/auto/approval modes). Unlike §2a–2d, this surface writes to accounts **other than @bai_ee** — every client can connect its own X account (its own OAuth 2.0 tokens under HitLoop's app, or its own OAuth 1.0a dev-app keys) via the **Social Accounts** card (`x-profile`, admin-only — the same card that used to be "X Command Center"; the legacy bookmarks/profile/engagement panels on that card still act as `@bai_ee` only, untouched by this).

| Call | Purpose |
|---|---|
| `getPlatformClient(clientId, 'x')` | resolves the write client: per-client oauth1 override → per-client oauth2 tokens → (only the digest home client) global `TWITTER_*` env → `409 account-not-connected` |
| `v1.uploadMedia` / `v2.uploadMedia` | media upload, split by which auth mode resolved |
| `v2.tweet(payload)` | post |

Full data model, the three publish modes, the approval-token contract, and the roll-up double-send guard: [`SOCIAL-AUTO-PUBLISH.md`](./SOCIAL-AUTO-PUBLISH.md). Every write here (this surface AND the legacy §2a path) is logged to `usage_events` with `provider:'x-api'` — call counts only, no dollar rate (see §3's blind-spot note, which now applies to a second account per client, not just @bai_ee).

---

## 3. Cost model & the blind spot

X API v2 is **credit-metered** on the enrolled developer account. Writes consume credits. When they run out you get:

```json
{
  "code": 402,
  "data": {
    "title": "CreditsDepleted",
    "detail": "Your enrolled account [1918540743066472448] does not have any credits to fulfill this request.",
    "type": "https://api.twitter.com/2/problems/credits"
  }
}
```

### ⚠️ X API spend is invisible to the Operating Cost card

`app/api/admin/cost-report/route.js` tracks **Anthropic**, **ScrapeCreators**, and **Browserless** only. There is **no X API ledger**. The card will report `$0` for X no matter how much is spent. Do not use it to check X budget — it will tell you everything is fine when it is not.

**The only reliable way to check credit/plan state is the X developer portal** (`developer.x.com`, the enrolled account above). An agent cannot read it. **Ask the user** — do not guess a balance, and do not quote a price tier from memory. If the user does not know, say the balance is unknown and let them decide.

### Observed rate limits (measured 2026-06-19, unfollow endpoint)

| Bucket | Limit | Window |
|---|---|---|
| Unfollow, short window | **50** | 15 min (resets observed 15 min apart) |
| Secondary/app bucket | 40000 | longer window |

Empirically: **~75 unfollows** succeeded before the account hit `CreditsDepleted`. Treat ~50/15min as the ceiling and assume credits are the real constraint, not rate limits.

Error shapes you will hit — both are already handled, don't re-invent:
- `429 Too Many Requests` — has `error.rateLimit.reset` (unix seconds). Wait, don't retry-hammer.
- `402 CreditsDepleted` — **stop the run entirely.** Retrying burns nothing but proves nothing. Tell the user; only they can add credits.

---

## 4. The unfollow workflow (`scripts/unfollow-inactive-following.mjs`)

### Free preflight — zero API calls
```bash
node scripts/unfollow-inactive-following.mjs
```
Without `--execute` the script filters candidates, writes a dry-run log, and **exits before the `TwitterApi` client is ever constructed**. No network, no credits, no rate limit. **Always run this first** to produce the number you put in front of the user for the §0 gate.

### Execute (only after approval)
```bash
node scripts/unfollow-inactive-following.mjs --execute --max=25 --delay=1200
```

| Flag | Effect |
|---|---|
| `--execute` | actually unfollow (default is dry-run) |
| `--max=N` | stop after N unfollows this run — **always set this** |
| `--delay=MS` | pause between calls (default `1200`) |
| `--auto-wait` | on 429, sleep until `rateLimit.reset` and continue instead of stopping |

⚠️ `--auto-wait` turns a capped run into a long-running one that keeps spending across rate-limit windows. Only use it with `--max=` set, and only when the user has approved that specific batch size.

### Safety properties (already built in — preserve them)
- **Resume-safe.** Completed IDs are read back from the log and skipped, so a re-run never double-spends on an account already unfollowed.
- **Writes after every call.** The log is flushed each iteration, so a crash or kill loses at most one record.
- **Stops on 402.** Credit depletion breaks the loop rather than grinding through failures.

### Data files (all in `data/`, which is **gitignored** — local only, not recoverable from git)

| File | Role |
|---|---|
| `bai-ee-following-audit.json` | full following scrape (1604 accounts) |
| `bai-ee-inactive-following-audit.json` | activity check — **896/1604 checked**, rate-limited mid-scan |
| `bai-ee-inactive-unfollow-log.json` | append-only action log; the resume source of truth |
| `bai-ee-x-scrub-audit.json`, `bai-ee-x-delete-*.json` | separate post-deletion workstream |

Human-readable summaries are committed under `docs/audits/bai-ee-*.md`.

### Current state (as of 2026-06-19, unchanged since)
- 260 inactive candidates identified (cutoff: no visible post since `2025-06-19`)
- **75 unfollowed**, 2 failed (`429`, then `402`)
- **185 candidates still pending**
- **708 of 1604 followed accounts were never audited** — the scan died on a 429, so the true inactive count is likely far higher than 260
- Run halted on `CreditsDepleted`. **Resuming requires the user to add X API credits first.**

### ⚠️ The audit generator is missing
Only the *unfollow* script was committed. The script that produced `bai-ee-following-audit.json` and the inactive check was never committed, and `data/` is gitignored — so it is gone. Finishing the remaining 708 accounts means **writing a new scraper**, and that scraper will consume read credits. Budget for it explicitly at the §0 gate; consider the ScrapeCreators path (§2c) instead of the X API where it can do the job.

---

## 5. Changing profile fields

There is **no script** for profile edits (name, bio, location, URL, avatar, banner) — by design. If asked to change them:

1. Confirm the exact final text/asset with the user, verbatim. Never draft-and-ship a bio.
2. Prefer the user doing it by hand in the X web UI — it is instant, free, and reversible by them.
3. Only reach for the API (`v1.updateAccountProfile` / `v1.updateAccountProfileImage` via `twitter-api-v2`) if the user explicitly asks for automation, and pass the §0 gate first.
4. Handle changes (`@bai_ee` → something else) break every stored reference in this repo and in the audit data. Push back hard; ask for confirmation twice.

---

## 6. Checklist for a future agent

Before touching X at all:

- [ ] Is this a **read**? → use ScrapeCreators (§2c), not the X API.
- [ ] Is this a **write**? → run the free dry-run, then the §0 gate.
- [ ] Did the user approve **this specific batch**, in this conversation?
- [ ] Is `--max=` set?
- [ ] Have I told the user the X spend will **not** show up in the Operating Cost card?
- [ ] On `402` → stop, report, do not retry.

Related: [`docs/audits/bai-ee-following-audit.md`](../audits/bai-ee-following-audit.md) · [`docs/audits/bai-ee-inactive-following-audit.md`](../audits/bai-ee-inactive-following-audit.md) · [`docs/audits/bai-ee-x-scrub-audit.md`](../audits/bai-ee-x-scrub-audit.md) · [`docs/source-of-truth/OPERATING-COST-CARD.md`](OPERATING-COST-CARD.md) · [`docs/source-of-truth/COPYWRITER-CARD.md`](COPYWRITER-CARD.md)
