# Social Auto-Publish — implementation plan (X first, Instagram next)

**Status:** approved plan, not built. **Owner:** implementer thread (Sonnet, one shot).
**Read before coding:** [`X-API-AND-PROFILE-OPERATIONS.md`](../source-of-truth/X-API-AND-PROFILE-OPERATIONS.md) (§0 spend gate is binding), [`EMAIL-DIGEST-CARD.md`](../source-of-truth/EMAIL-DIGEST-CARD.md), [`COPYWRITER-CARD.md`](../source-of-truth/COPYWRITER-CARD.md).

---

## 1. Objective

Publish each client's automatically-generated daily video to **that client's own social account**, on that client's terms:

- `off` — nothing publishes (default for every existing client)
- `auto` — publishes at digest send, no human in the loop
- `approval` — a **Post to X** button rides in the email; nothing publishes until it is clicked

X is adapter #1. **Instagram is adapter #2 and the whole config/UI/token layer is built platform-generic from day one** — adding Instagram must be a registry entry + an adapter file, not a refactor.

Admin can select any client (existing `activeClientId` switch) and edit that client's accounts + publish mode. Admin also receives **one roll-up email** aggregating every enrolled client's pending video, each row with its own Post button.

### Non-goals (do not build)
- Instagram publishing itself — the adapter ships as a registered stub that throws `not-implemented`.
- Threads, replies, carousels, multi-media posts.
- Changing how the daily video is *rendered* (that lives in the EditVideos worker repo).
- Touching the existing `autoPostX` feature (the **text** suggested-post enqueue). It is a separate, unrelated feature that stays exactly as-is. Do not rename it, fold it in, or reuse its key.

---

## 2. Current architecture (verified anchors)

| Concern | Where | State |
|---|---|---|
| Daily video render | `app/api/worker/pre-digest-video/route.js` (cron `0 6`) | ⚠️ resolves **one** home client; `strictSourceFolders: ['skyline']` hardcoded in `DAILY_EMAIL_VIDEO_PRODUCTION` |
| Render → capture | `api/_lib/media-reconcile.cjs:69` | writes `dashboard_state.mediaCaptures[]` `{type:'video_remix', downloadUrl, contentType:'video/mp4', durationSeconds, jobId}` |
| Digest picks it up | `app/api/admin/daily-digest/route.js:2565+` | reads latest fresh capture, probes URL, LLM-captions it → `videoItems.remix = {url, duration, caption, stale, staleLabel}` |
| Email video row | `daily-digest/route.js:973` `buildVideoPostRow` | media cell + caption cell, no button |
| Digest fan-out | `daily-digest/route.js:2118` `fanOutScheduledSends` | one sub-request per `[homeClientId, ...listCronEnrolledClientIds()]`, each its own email to that client's `recipientEmail` (blank ⇒ `DIGEST_TO`) |
| Existing auto-post (text) | `daily-digest/route.js:1918` `enqueueDigestSuggestedPost`, gated `digestCfg.autoPostX` | **pattern to clone**, do not modify |
| Post storage | Firestore `social_posts`, `features/social-posting/twitter-service.js` | already carries `mediaUrl / mediaType / mediaContentType / mediaStoragePath / mediaJobId` |
| Post + media upload | `twitter-service.js` `uploadPostMedia` → `v1.uploadMedia`; `postToTwitter(content, media)` | works, MP4 only, WebM explicitly rejected |
| Due sweep | `twitter-service.js` `DUE_STATUSES = {scheduled, queued, failed}` → `processDuePostsForAllClients` | ⚠️ **no cron in `vercel.json`** — scheduled posts never fire in prod |
| X identity (OAuth 1.0a) | `TWITTER_*` env | ⚠️ single global account (`@bai_ee`) |
| X identity (OAuth 2.0) | `features/social-posting/x-oauth.js`, doc `system_flags/x_oauth_tokens` | ⚠️ single global doc; ⚠️ `X_OAUTH_SCOPES` has **no `media.write`** |
| X card UI | card `x-profile` (`DashboardPage.jsx:9217`, render `:15711`) → `components/dashboard/XProfileCard.jsx` | admin-only, hardwired to the global account |
| Digest config | `features/intelligence/_digest-config.js` (`DEFAULTS` ~L204, `getDigestConfig` ~L325, `saveDigestConfig` ~L347) | per-client `digest_config/{clientId}` |
| Digest config UI | `components/AdminEmailModals.jsx:644` (the `autoPostX` field) | SETTINGS tab |
| HMAC token pattern | `api/_lib/calendar-oauth.cjs:44` `signState`/`verifyState` | **copy this shape**, don't invent one |
| Public route pattern | `app/api/public/deleted-account-check/route.js` | uses `api/_lib/rate-limit.cjs` `checkRateLimit` + `getClientIp` |
| Public page pattern | `app/briefs/[clientId]/…` | unauthenticated page class |

---

## 3. Data model (new)

### 3a. `social_accounts/{clientId}` — identity, per platform
```js
{
  clientId: 'undergroundexistence-XXXX',
  platforms: {
    x: {
      enabled: true,
      authMode: 'oauth2' | 'oauth1',
      username: 'UDExistence',
      userId: '17...',
      // authMode 'oauth2' (HitLoop's X app, HitLoop's credits)
      accessToken, refreshToken, expiresAt, scope: [],
      // authMode 'oauth1' (client's OWN dev app, client's OWN credits)
      oauth1: { appKey, appSecret, accessToken, accessSecret } | null,
      connectedBy: 'bryanballi@gmail.com',
      updatedAt: 1737...,
    },
    instagram: null,
  },
}
```

### 3b. `digest_config/{clientId}.autoPublish` — mode, per platform
```js
autoPublish: {
  platforms: {
    x:         { mode: 'off' | 'auto' | 'approval', delayMinutes: 0, maxPerDay: 1 },
    instagram: { mode: 'off', delayMinutes: 0, maxPerDay: 1 },
  },
}
```
Default `mode: 'off'` for every platform, every client. **No existing client changes behavior.**

### 3c. `social_posts` — additive fields
```js
platform: 'x',                    // NEW — existing rows read as 'x'
status: 'awaiting_approval',      // NEW state, deliberately NOT in DUE_STATUSES
approvalTokenId: 'apv_…' | null,
approvedAt, approvedBy, approvalSource: 'email' | 'dashboard' | null,
rejectedAt: null,
```

### 3d. `social_approvals/{tokenId}` — single-use burn record
```js
{ tokenId, postId, clientId, platform, createdAt, expiresAt,
  redeemedAt: null, redeemedIp: null, redeemedUa: null,
  revokedAt: null, result: null }
```

---

## 4. Phases

> **Phase discipline:** implement in order, run `npm test` + `npm run build` after each, and stop for approval after **P5** and again after **P8**. Do not start a later phase early. Do not refactor adjacent code.

---

### P1 — Platform registry + per-client identity store

**New** `features/social-posting/platforms.js`
```js
const SOCIAL_PLATFORMS = [
  { key: 'x',         label: 'X',         live: true,  handlePrefix: '@' },
  { key: 'instagram', label: 'Instagram', live: false, handlePrefix: '@' },
];
```
Export `SOCIAL_PLATFORMS`, `PLATFORM_KEYS`, `LIVE_PLATFORM_KEYS`, `isLivePlatform(key)`. **Every** new config key, Firestore field, UI row, and token is derived from this list — never a hardcoded `'x'` literal outside the X adapter.

**New** `features/social-posting/social-accounts.js`
- `getSocialAccount(clientId, platform)` / `listSocialAccounts(clientId)` / `saveSocialAccount(clientId, platform, patch)` / `disconnectSocialAccount(clientId, platform)`
- Never return raw tokens to a client caller — add `toPublicAccount()` returning `{ connected, authMode, username, userId, scope, updatedAt, connectedBy }` only.

**Edit** `features/social-posting/x-oauth.js`
- `tokensRef()` / `pendingRef()` take a `clientId`; per-client tokens live in `social_accounts/{clientId}.platforms.x`, pending PKCE state in `social_oauth_pending/{clientId}`.
- **Legacy fallback:** when `clientId` resolves no per-client doc, fall back to reading `system_flags/x_oauth_tokens` so the existing @bai_ee connection keeps working. First per-client connect for that client writes the new doc.
- **Add `media.write` to `X_OAUTH_SCOPES`.** ⚠️ Existing @bai_ee token lacks it → video posting over OAuth 2.0 needs one reconnect. Surface this in the card as a "Reconnect required for video" notice when `scope` is missing `media.write`.
- `getXOAuth2Client(clientId)` refreshes as today, writing back to the per-client doc.

**New** `getPlatformClient(clientId, platform)` in `social-accounts.js` — resolution order:
1. per-client `oauth1` override → `new TwitterApi({appKey, appSecret, accessToken, accessSecret})`, `authMode:'oauth1'`
2. per-client `oauth2` tokens → `new TwitterApi(accessToken)`, `authMode:'oauth2'`
3. **only** when `clientId === resolveDigestClientId()`'s home client: global `TWITTER_*` env (preserves today's behavior)
4. else throw `{status:409, code:'account-not-connected'}`

**Acceptance:** X Command Center still loads and reports @bai_ee connected. `npm test` green. No behavior change anywhere.

---

### P2 — Adapters + posting layer takes a client identity

**New** `features/social-posting/adapters/x.js`
- `publish({ clientId, text, media })`:
  - resolve via `getPlatformClient(clientId, 'x')`
  - re-probe `media.mediaUrl` (HEAD/GET, non-2xx ⇒ throw `media-unavailable`) — an EditVideos link can die between render and publish
  - upload: `authMode === 'oauth1'` ⇒ `client.v1.uploadMedia(buf, {mimeType, target:'tweet'})`; `authMode === 'oauth2'` ⇒ `client.v2.uploadMedia(buf, {media_type: mimeType, media_category: isVideo ? 'tweet_video' : 'tweet_image'})`
  - keep the existing WebM guard and the MP4/PNG/JPG/GIF/WEBP allowlist verbatim
  - `client.v2.tweet({text, media:{media_ids:[id]}})`
  - map errors through the existing `mapTwitterError` shape (402 stop / 429 backoff hints already written — reuse, don't duplicate)
- `getStatus({clientId})`, `disconnect({clientId})`

**New** `features/social-posting/adapters/instagram.js` — same exported signature, every method throws `Object.assign(new Error('Instagram publishing is not implemented yet.'), {status:501, code:'not-implemented'})`.

**New** `features/social-posting/adapters/index.js` — `getAdapter(platform)`, throws on unknown.

**Edit** `features/social-posting/twitter-service.js`
- `postToTwitter(content, media, { clientId, platform = 'x' } = {})` → delegates to `getAdapter(platform).publish(...)`. **Backwards compatible:** no `clientId` ⇒ today's env-credential path.
- `postNow`, `postAndRecord`, `runDueSweep` pass `{ clientId: post.clientId, platform: post.platform || 'x' }`.
- `createSocialPost` persists `platform` (default `'x'`).
- Add `'awaiting_approval'` to the status vocabulary but **not** to `DUE_STATUSES`.

**Acceptance:** posting from the Copywriter card and Schedule Posts card behaves identically. A per-client-connected account posts as that handle. `npm test` green.

---

### P3 — Social Accounts UI (the `x-profile` card, per-client)

**Edit** `components/dashboard/XProfileCard.jsx` + `DashboardPage.jsx:9217` card def + `:15711` render.

- Card title → **Social Accounts**; description says "per-client publishing identities". Stays admin-only (`...(isAdmin ? [...] : [])`).
- Card is scoped to `activeClientId` — accepts it as a prop and passes it on every request. Header shows which client is loaded.
- New top panel `#social-accounts-panel` with one row per `SOCIAL_PLATFORMS` entry:
  - `#social-account-x-row` — handle, scopes, connected date, **Connect** (OAuth 2.0 PKCE) / **Disconnect**, plus a collapsed `#social-account-x-oauth1-row` for the four OAuth 1.0a override fields (write-only; never echo secrets back).
  - `#social-account-instagram-row` — rendered **disabled** with a "Coming soon" pill, driven off `live: false`. Proves the seam.
- Missing-`media.write` warning row when connected over OAuth 2.0 without it.
- Existing bookmarks / profile / engagement panels keep operating on the **global** @bai_ee connection; do not re-scope them in this phase.
- All spend-gated buttons keep the existing arm-then-confirm pattern.

**Edit** `app/api/social-posting/x-oauth/route.js` + `.../callback/route.js`
- Accept + require `clientId`; carry it in the signed PKCE pending doc so the callback knows whose account it is. Callback still completes server-side (authorize codes expire ~30s — never route through copy-paste).
- Stay admin-gated.

**Acceptance:** admin switches client, connects a second X account, both accounts persist independently, disconnect removes only that client's.

---

### P4 — Publish mode config + Email Digest UI

**Edit** `features/intelligence/_digest-config.js`
- `DEFAULT_AUTO_PUBLISH` built from `SOCIAL_PLATFORMS` (all `mode:'off'`).
- `normalizeAutoPublish(value)` — unknown platforms dropped, unknown modes ⇒ `'off'`, `delayMinutes` clamped 0–1440, `maxPerDay` clamped 1–10.
- Wire into `DEFAULTS`, `getDigestConfig`, `saveDigestConfig` (`if ('autoPublish' in patch)`), and the exports block.
- **Leave `autoPostX` untouched.**

**Edit** `components/AdminEmailModals.jsx` (SETTINGS tab, directly under the existing `autoPostX` field)
- New field block `#digest-autopublish-section`, one row per live platform: `#digest-autopublish-x-row` — three-way selector (Off / Auto / Approval), delay input, daily cap, and a readout `Posts as @UDExistence` sourced from `social_accounts` (or `Not connected — connect in Social Accounts`).
- Non-live platforms render disabled.
- Hint copy must state plainly: **Auto publishes with no human review. Approval emails a button and publishes nothing until it is clicked.**

**Acceptance:** mode saves per client, survives reload, defaults `off` on a fresh client, `npm run build` clean.

---

### P5 — Approval infrastructure ⛔ *stop for approval after this phase*

**New** `api/_lib/social-approval.cjs`
- `signApprovalToken({postId, clientId, platform})` / `verifyApprovalToken(token)` — **copy the HMAC shape from `api/_lib/calendar-oauth.cjs:44`** (`base64url(payload|sig)`, `timingSafeEqual`).
- Secret: `SOCIAL_APPROVAL_SECRET`. Hard-fail in production if unset; fall back to `CRON_SECRET` in dev only.
- TTL **48h**. Payload binds `postId|clientId|platform|nonce|ts`.
- `redeemApprovalToken(token, {ip, ua})` — Firestore **transaction** on `social_approvals/{tokenId}`: rejects if missing / expired / `redeemedAt` set / `revokedAt` set. Single-use burn happens *before* the publish call; a failed publish records `result:'failed'` and does **not** un-burn (re-approve from the dashboard instead).
- `revokeApprovalsForClient(clientId)`.

**New** `app/api/public/social-approve/route.js`
- **POST only.** A GET returns 405 — publishing must never happen on a link prefetch by an email scanner.
- Rate-limited via `api/_lib/rate-limit.cjs` (`checkRateLimit`, keyed on IP, 30/hr).
- Redeem → load post → `postToTwitter(post.content, postMedia(post), {clientId, platform})` → write `status:'posted'|'failed'`, `approvedAt`, `approvalSource:'email'`, `redeemedIp/Ua`.
- Sibling `GET /api/public/social-approve/preview?token=` — read-only, returns `{clientName, handle, caption, videoUrl, state}` for the page. Never publishes.

**New** `app/post-approval/[token]/page.jsx` (public, unauthenticated)
- Renders the video, the exact caption that will post, the client name and the **target handle**, then one primary button `#post-approval-action-shell` → POSTs.
- States: `ready` · `already posted` · `expired` · `revoked` · `failed` · `not found`. Each is a plain, final screen.
- ⚠️ Per the approved decision, **anyone holding the link can publish.** The page must say which live account is about to be posted to, in plain language, above the button.

**Edit** `app/api/social-posting/route.js` — new actions `approve-post`, `reject-post`, `revoke-approvals` (admin/owner-gated, `approvalSource:'dashboard'`).
**Edit** `components/dashboard/SocialPostingPanel.jsx` — surface `awaiting_approval` rows with Approve / Reject buttons.

**Acceptance:** token verifies, expires, burns once; a second click reports *already posted*; GET on the API is 405; revoke kills a pending token.

---

### P6 — Email: attribution + Post button

**Edit** `daily-digest/route.js` `buildVideoPostRow` (`:973`)
- New signature `buildVideoPostRow(item, kind, ctx)` where `ctx = {clientName, handle, mode, approvalUrl, publishedAt, platformLabel}`.
- Attribution line above the row: `UNDERGROUND EXISTENCE → @UDExistence` (mono, uppercase, `DT.light`).
- `mode === 'approval'` + a live pending post ⇒ bulletproof-table CTA `POST TO ${platformLabel}` → `approvalUrl`. **No flex, no JS** (Outlook).
- `mode === 'auto'` ⇒ passive badge `PUBLISHED · @handle · 9:14am` (or the failure reason).
- `mode === 'off'` ⇒ today's row, byte-identical.
- Keep the existing `stale` warning badge.

**New** `enqueueAutoPublishVideoPost({clientId, platform, videoItems, timestamp, digestCfg, step})` in the digest route, modeled on `enqueueDigestSuggestedPost:1918`:
- Gates: `isRealSend` · `mode !== 'off'` · `videoItems.remix` present · **`!videoItems.remix.stale`** (never republish yesterday's video) · account connected · under `maxPerDay`
- Dedupe `source: 'daily-video:{platform}:{YYYY-MM-DD}'` checked against `readSocialQueue(clientId)`
- Caption = `videoItems.remix.caption` (already generated upstream — **zero extra LLM cost**); fall back to `generatePromoCopy` only if empty
- Media = `{mediaUrl: item.url, mediaType:'video', mediaContentType:'video/mp4', mediaJobId}`
- `auto` ⇒ publish inline (`postNow`); `approval` ⇒ `createSocialPost` with `status:'awaiting_approval'` + mint token + build `approvalUrl` from `appOrigin()`
- Emit `step()` lines like every other digest section; never throw — a publish failure must not block the email.

**Acceptance:** approval-mode email renders a working button; auto-mode publishes once and shows the badge; off-mode email is unchanged; preview never publishes and never mints a live token.

---

### P7 — Admin roll-up email

**New** `app/api/worker/approval-rollup/route.js` (cron-secret gated, `nodejs`, `maxDuration 60`)
- Query `social_posts` where `status == 'awaiting_approval'`, group by `clientId`, resolve each client's name + target handle.
- Render one email: header `PENDING APPROVAL · N VIDEOS`, one attributed row per client (reuse `buildVideoPostRow` with its `ctx`), each with its own token'd button. Explicit empty state when nothing is pending — **gate on the toggle, never on data presence** (the digest's established rule).
- Send to `DIGEST_TO`.
- **Double-send guard:** a client whose digest `recipientEmail` resolves to `DIGEST_TO` has its video row **claimed by the roll-up** and suppressed in its own per-client digest email. Client-recipient emails are untouched. Implement as one shared helper so both renders read the same decision.
- Tokens are per-post and single-use, so even if a row appears twice the second click reports *already posted*.

**Edit** `vercel.json` — add `{"path": "/api/worker/approval-rollup", "schedule": "20 13 * * *"}` (after the `0 13` digest fan-out completes; the fan-out has a 270s budget).

**Acceptance:** with 2+ clients pending, one email arrives listing both, each button posts to the correct handle; with none pending, the empty state renders.

---

### P8 — Fixes, safety, docs

**a. `pre-digest-video` fan-out (required for UE to have a video at all)**
`app/api/worker/pre-digest-video/route.js` — loop `[homeClientId, ...listCronEnrolledClientIds()]` instead of resolving one client. Move `strictSourceFolders` out of the frozen `DAILY_EMAIL_VIDEO_PRODUCTION` into per-client config (`digest_config.dailyVideo.sourceFolders`), defaulting to `['skyline']` so today's behavior is preserved exactly. Keep the `await triggerWorker()` — it must not become fire-and-forget (documented Vercel freeze trap).

**b. `process-due` cron**
Add `{"path": "/api/social-posting/process-due", "schedule": "*/30 * * * *"}` to `vercel.json`.
⚠️ **Staleness guard first:** in `readDuePosts`, skip and mark `expired` any post whose `scheduledAt` is more than **12h** old. Without this, the first cron run flushes the entire historical backlog of never-sent scheduled posts to the live account. This guard is not optional.
Note: approval clicks publish **inline**, so the approval flow never depends on this cron.

**c. Spend visibility**
Log every X write into `usage_events` with `provider:'x-api'` — **call counts only, no fabricated dollar rate** (X spend genuinely is not knowable from the API; only `developer.x.com` has it). Add a line to the Operating Cost card's *Cost sources* coverage table saying X writes are counted but not priced.

**d. Docs**
- New SSOT `docs/source-of-truth/SOCIAL-AUTO-PUBLISH.md` — data model, the three modes, the approval-token contract, the roll-up double-send guard, and the "how to add a platform" recipe.
- Update `X-API-AND-PROFILE-OPERATIONS.md` §2 — this is a **4th** X API surface (per-client publishing) and it writes to accounts other than @bai_ee.
- Add a `CLAUDE.md` card-features bullet pointing at the new SSOT.

---

## 5. Risks and traps

| Risk | Handling |
|---|---|
| **Forwarded email = publish rights** (accepted decision) | 48h TTL, single-use burn, dashboard revoke, audit row (IP/UA/time), approval page names the live account before the button |
| **Email scanners prefetch links** | Publishing is POST-only; GET on the API is 405; the button lands on a page, never on an action |
| `v2.uploadMedia` is untested here and tier-gated | Per-client OAuth 1.0a override (P1/P2) is the fallback with zero rework |
| Adding `media.write` | Requires one @bai_ee reconnect; card shows a "reconnect required for video" notice |
| **`process-due` cron flushes a stale backlog** | 12h staleness guard ships in the same commit as the cron |
| Stale video republished | Hard gate on `!videoItems.remix.stale` |
| Dead EditVideos media URL at publish time | Re-probe immediately before upload; fail that row only |
| X spend invisible on the Operating Cost card | Counted in `usage_events`; card table states it is counted-not-priced |
| Roll-up + per-client double send | Shared claim helper + per-post single-use tokens |
| Fast Refresh during a run | Never edit `DashboardPage.jsx` while a terminal run is active |

---

## 6. Operator runbook — `undergroundexistence.info`

1. Provision the client in HITLOOP.
2. **Social Accounts** card → select the client → Connect X → authorize as `@UDExistence`.
3. Confirm the connection shows `media.write` in scope.
4. Email Digest card → set `recipientEmail`, enable the daily schedule, enable `videoPosts`.
5. Set `dailyVideo.sourceFolders` for the client (or accept `skyline`).
6. Set X publish mode to **Approval**.
7. Run & Send once. Verify: video attaches, attribution reads `→ @UDExistence`, button opens the approval page.
8. Click Post. Verify the tweet lands on `@UDExistence`, the post row flips to `posted`, and a second click reports *already posted*.
9. Only after that passes, consider switching to **Auto**.

---

## 7. Definition of done

- [ ] `npm test` and `npm run build` clean after every phase
- [ ] Every existing client still defaults to `off`; no behavior change without an explicit toggle
- [ ] X Command Center still manages @bai_ee
- [ ] Copywriter + Schedule Posts publish exactly as before
- [ ] A second X account publishes as itself
- [ ] Approval token: verifies, expires, burns once, revocable
- [ ] Roll-up lists every pending client; no double send
- [ ] Instagram row visible and disabled; adapter registered and throwing `not-implemented`
- [ ] SSOT written, `X-API-AND-PROFILE-OPERATIONS.md` §2 updated, `CLAUDE.md` bullet added
