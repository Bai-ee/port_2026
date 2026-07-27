# Social Auto-Publish

**Status:** built (P1–P8 of `docs/plans/SOCIAL-AUTO-PUBLISH-PLAN.md`). Read that plan for the phase history; this doc is the as-built reference going forward.

Publishes each client's automatically-generated daily video (Video Remix) to **that client's own social account**, on that client's terms. X is adapter #1; Instagram is a registered stub (not implemented). Read [`X-API-AND-PROFILE-OPERATIONS.md`](./X-API-AND-PROFILE-OPERATIONS.md) §0 (spend gate) and §2e before touching any of this — it writes to accounts **other than @bai_ee**.

---

## 1. The three modes

Set per digest, per platform, in the **Email Digest card** → SETTINGS → `#digest-autopublish-section`:

- `off` (default, every client, every platform) — nothing publishes.
- `auto` — publishes at digest send, no human in the loop.
- `approval` — the digest email carries a **Post to X** button; nothing publishes until it's clicked (or the admin clicks Approve in the dashboard).

Config lives at `digest_config/{clientId}.autoPublish.platforms.{x,instagram}` = `{mode, delayMinutes, maxPerDay}` (`features/intelligence/_digest-config.js` — `DEFAULT_AUTO_PUBLISH`/`normalizeAutoPublish`; `AUTO_PUBLISH_PLATFORM_KEYS` is a plain local list mirroring `platforms.js`, not imported — this file is CJS, `platforms.js` is ESM, and Node can't `require()` an ESM module synchronously. Keep the two lists in sync by hand).

### Video-owner invariant

`dailyVideo.sourceClientId` is the publishing-ownership selector. Blank means
the digest client. `dailyVideo.assetSourceClientId` independently selects the
dashboard whose completed Remix file is attached; blank means the publishing
owner. This lets a centrally rendered Hitloop asset be piped into Underground's
publishing flow without routing the post through Hitloop's social account.
When Hitloop's email publishes for Underground, Underground
owns all of the following:

- Client Brain voice used for its caption;
- `autoPublish` mode, delay, and daily cap;
- the connected X account;
- the `social_posts` row and every approval token.

The selected asset source owns only the stored completed Video Remix file.

The sending digest owns only its email layout and `recipientEmail`. There is no
independent account destination. Legacy stored `accountClientId` values are
ignored by normalization and runtime routing. In a digest that borrows another
client's video, that owner's publish settings are displayed read-only; edit
them from the owner's Email Digest card.

## 2. Identity — the Social Accounts card

Card `x-profile` (renamed from "X Command Center" → **Social Accounts**; `components/dashboard/XProfileCard.jsx`, `DashboardPage.jsx:~9217`). Two concerns share one card:

- **New, per-client** (`#social-accounts-panel`, top of the card, scoped to `activeClientId`): one row per `features/social-posting/platforms.js` `SOCIAL_PLATFORMS` entry. X: Connect (OAuth 2.0 PKCE, HitLoop's app) / Disconnect / "Use own dev app keys" (OAuth 1.0a override, write-only fields). Instagram: disabled, "Coming soon".
- **Untouched, global** (`#x-profile-connection-panel` and below): the original bookmarks/profile/engagement/audience panels, still exclusively the `@bai_ee` account. Do not re-scope these.

Storage: `social_accounts/{clientId}.platforms.{x,instagram}` (`features/social-posting/social-accounts.js`):
```js
{ clientId, platforms: { x: {
  authMode: 'oauth2' | 'oauth1',
  username, userId, scope: [], connectedBy, updatedAt,
  // oauth2 (HitLoop's app, HitLoop's credits)
  accessToken, refreshToken, expiresAt,
  // oauth1 (client's OWN dev app, client's OWN credits) — mutually exclusive with the oauth2 fields above
  oauth1: { appKey, appSecret, accessToken, accessSecret } | undefined,
}, instagram: null } }
```
`toPublicAccount()` is the only shape ever sent to a client — never raw tokens.

**Resolution order** for who actually posts (`getPlatformClient(clientId, platform)` in `social-accounts.js`):
1. per-client `oauth1` override
2. per-client `oauth2` tokens — routed through `x-oauth.js`'s `getXOAuth2Client(clientId)` (not a raw client) so a near-expiry token refreshes and writes back first
3. **only** when `clientId` is the digest home client (`resolveDigestClientId()`) — the global `TWITTER_*` env (preserves pre-existing behavior for that one client)
4. else `409 account-not-connected`

`x-oauth.js`'s OAuth2 connect flow is shared between the legacy global flow (no `clientId` — untouched) and this per-client flow: a per-client connect signs `clientId` into the PKCE `state` itself (HMAC, same shape as `calendar-oauth.cjs`'s `signState`/`verifyState`) since the callback only receives `(code, state)` and needs to recover whose flow it is. Per-client pending state lives in `social_oauth_pending/{clientId}`; legacy pending state is unchanged in `system_flags/x_oauth_pending`.

## 3. Posting layer

`features/social-posting/twitter-service.js`'s `postToTwitter(content, media, {clientId, platform})`: a `clientId` delegates to `getAdapter(platform).publish(...)` (`features/social-posting/adapters/{x,instagram,index}.js`); **no `clientId` is the original env-credential path, byte-identical** — Copywriter and Schedule Posts keep working exactly as before. `postNow`/`postAndRecord` (due-sweep) now pass `{clientId: post.clientId, platform: post.platform || 'x'}` through, so every stored post resolves via the same client-aware path once it carries a `clientId`.

The X adapter (`adapters/x.js`): one `fetch()` doubles as the "is this EditVideos link still alive" re-probe and the content fetch (no separate HEAD — a video would otherwise download twice); same WebM guard + MP4/PNG/JPG/GIF/WEBP allowlist as the legacy path; `v1.uploadMedia` for oauth1, `v2.uploadMedia` for oauth2; every successful `v2.tweet`/`v1.tweet` (both this adapter and the legacy path) logs to `usage_events` with `provider:'x-api'`, `costUsd:0` — **counted, not priced** (X has no per-call price via the API; see the Operating Cost card's Cost-sources row `x_writes`).

`createSocialPost` persists `platform` (default `'x'`). New terminal statuses: `awaiting_approval` (approval-mode pending) and `rejected` — **neither is in `DUE_STATUSES`**, so the `process-due` sweep can never touch them.

## 4. Approval-token contract

`api/_lib/social-approval.cjs`. Same signed-payload shape as `calendar-oauth.cjs`'s `signState`/`verifyState`: `base64url(postId|clientId|platform|nonce|ts|hmacSig)`, secret `SOCIAL_APPROVAL_SECRET` (hard-fails in prod if unset — `code:'server'`, distinct from a bad/expired token; falls back to `CRON_SECRET` in dev only). TTL **48h**, checked both in the token's own timestamp and the Firestore doc's `expiresAt`.

The Firestore doc `social_approvals/{tokenId}` (`tokenId = apv_{nonce}`) is the actual single-use gate — the token is only a bearer credential that must also match live doc state:
- `signApprovalToken({postId, clientId, platform})` mints the token AND writes the doc (`redeemedAt/revokedAt/result: null`).
- `verifyApprovalToken(token)` — signature + TTL only, no Firestore read. Used by the read-only preview route and as step 1 of redeem.
- `redeemApprovalToken(token, {ip, ua})` — a Firestore **transaction**: rejects `not-found`/`revoked`/`already-posted` (`redeemedAt` set)/`expired`, else burns (`redeemedAt`, `redeemedIp`, `redeemedUa`) atomically. **Burn happens before publish.** A failed publish records `result:'failed'` but does **not** un-burn — re-approve from the dashboard, don't retry the link.
- `revokeApprovalsForPost(postId)` — called after a **dashboard** approve/reject so a still-unburned email token can't publish (or re-publish) the same post through the other channel. `revokeApprovalsForClient(clientId)` — bulk, e.g. when switching a platform back to `off`.

**`publishApprovedPost`/`rejectSocialPost` (`twitter-service.js`) both guard `post.status !== 'awaiting_approval'` → `409 not-pending`.** This is what makes minting more than one valid token for the same post safe (see §5) — only the first click through *either* link can ever publish; the second always hits the status guard, never a live double-post.

Public surface, `app/api/public/social-approve/`:
- `route.js` — **POST only** (`GET` → `405`); email scanners prefetching the link never publish. Rate-limited 30/hr/IP. Redeems, then `publishApprovedPost(...)`; success → `recordApprovalResult(tokenId,'posted')`; the `not-pending` race (dashboard beat this click by a hair) → recorded as anything-but-`'failed'` and reported as `already-posted`, not a false `failed`.
- `preview/route.js` — **read-only**, also rate-limited 30/hr/IP (a leaked link is otherwise unlimited Firestore reads). Never redeems, never publishes.
- `app/post-approval/[token]/page.jsx` — public, unauthenticated. States: `ready` (names the exact live account **above** the button — accepted product decision: anyone holding the link can publish, mitigated by 48h TTL + single-use + revoke + IP/UA audit) / `already-posted` / `expired` / `revoked` / `failed` / `server` (ops misconfig, not a bad link) / `not-found` / `invalid`.
  In `ready`, the generated post copy is an editable 280-character textarea.
  The edit is sent only with the explicit final POST, saved to the same
  `awaiting_approval` row, and then published. Loading or typing never writes
  or publishes.

Dashboard counterpart (`app/api/social-posting/route.js` actions `approve-post`/`reject-post`/`revoke-approvals`; `SocialPostingPanel.jsx` renders Approve/Reject on `awaiting_approval` rows) publishes/rejects directly, then revokes that post's token.

## 5. Email wiring + the roll-up

`app/api/admin/daily-digest/route.js`:
- The selected Video Remix publishing owner and file library are resolved
  independently before captioning or publishing.
  Its digest config and Client Brain drive the remix caption and X policy; its
  client id is passed to the social adapter. Video Promo remains owned by the
  email client. If a borrowed owner's config cannot be read, a real send fails
  closed instead of silently using the wrong account or policy.
- `enqueueAutoPublishVideoPost({clientId, platform, videoItems, timestamp, digestCfg, step})` — gates: `mode !== 'off'` → **hard** `!videoItems.remix.stale` (never republish yesterday's video — this is a block, not a warning) → account connected → dedupe on `source: daily-video:{platform}:{YYYY-MM-DD}` → under `maxPerDay`. Caption reuses `videoItems.remix.caption` (already generated upstream — zero extra LLM cost), falling back to `generatePromoCopy` only if empty. `auto` publishes inline (`postNow`); `approval` creates the post + mints a token + builds the approval URL. Never throws (the caller also wraps it) — a publish failure must never block the email.
- **This only runs when `isRealSend`.** Preview/template builds a read-only "dry" ctx instead (connected-account lookup only, no Firestore write, no token) — `isPreview` gates the *whole* enqueue, not just the publish call inside it.
- `buildVideoPostRow(item, kind, ctx)` / `buildAutoPublishRow(ctx)` render the attribution line (`CLIENT NAME → @handle`) + either the bulletproof-table `POST TO X` button (approval mode, table-based, no flex/JS — Outlook) or a passive `PUBLISHED · @handle · time` badge (auto mode). `ctx` is `undefined` for Video Promo and for any client with mode `off` → byte-identical to the pre-existing row.

Every per-client/destination email keeps its own approval button. The master
Hitloop roll-up also includes **all** pending client approvals, regardless of
recipient. Both emails may therefore hold separate tokens for the same post;
this is safe because token redemption and the post-status guard permit one
publish total.

`app/api/worker/approval-rollup/route.js` (cron `20 13 * * *`, after the `0 13` digest fan-out's 270s budget; worker-secret/cron-secret/admin-gated): queries all `social_posts` where `status == 'awaiting_approval'`, mints a **fresh** token per post (independent of the per-recipient token — safe, see §4), and renders one master email. It reuses `buildVideoPostRow`/`DT`/`dSection`/`sendEmail` exported from `daily-digest/route.js` rather than duplicating the HTML. Always sends, even with zero pending.

## 6. `pre-digest-video` fan-out + `process-due` staleness guard

- `app/api/worker/pre-digest-video/route.js` now loops `[homeClientId, ...listCronEnrolledClientIds()]` (was: one client) — required for any non-home enrolled client to have a video at all. Per-client `strictSourceFolders` comes from `digest_config/{clientId}.dailyVideo.sourceFolders` (`_digest-config.js` `DEFAULT_DAILY_VIDEO`/`normalizeDailyVideo`), defaulting to `['skyline']` — no config UI yet, Firestore-only (matches the plan's runbook step "Set `dailyVideo.sourceFolders` for the client (or accept `skyline`)"). `await triggerWorker()` is still awaited — Vercel can freeze the instance right after the response returns, so this must never become fire-and-forget.
- Interactive **Generate & Send does not start a render**. It reads the latest
  completed, still-downloadable Video Remix from
  `dailyVideo.assetSourceClientId` (blank = publishing owner). The publishing
  owner remains `dailyVideo.sourceClientId` (blank = digest/home client).
  Each email gets an approval button for the same owner-scoped post. Dedupe
  reuses that post and its stored caption while minting a fresh single-use
  token; the post-status guard guarantees that only the first approval
  publishes.
- `app/api/social-posting/process-due` cron added (`*/30 * * * *`). **The 12h staleness guard shipped in the same change**: `twitter-service.js`'s `readDuePosts` marks any due post whose `scheduledAt` is more than 12h in the past as `expired` (not in `DUE_STATUSES`) and skips it, instead of posting it — without this, the cron's first run would flush the entire historical backlog of never-sent scheduled posts to a live account. Approval-mode publishing never depends on this cron (it publishes inline on the click).

## 7. How to add a platform

1. Add an entry to `SOCIAL_PLATFORMS` in `features/social-posting/platforms.js` (`{key, label, live, handlePrefix}`).
2. Mirror the key into `AUTO_PUBLISH_PLATFORM_KEYS` in `features/intelligence/_digest-config.js` (CJS can't import the ESM list — see §1).
3. Write `features/social-posting/adapters/<platform>.js` exporting `publish({clientId, text, media})` / `getStatus({clientId})` / `disconnect({clientId})`; register it in `adapters/index.js`.
4. Extend `getPlatformClient` in `social-accounts.js` if the platform needs its own auth-resolution branch.
5. Set `live: true` once the adapter is real — the Social Accounts card row and the digest's `#digest-autopublish-<platform>-row` both un-disable automatically (they render from `SOCIAL_PLATFORMS`/the local mirror, not a hardcoded list).

Until then: ship the adapter as a stub throwing `Object.assign(new Error('... not implemented yet.'), {status: 501, code: 'not-implemented'})` for every method, `live: false` — proves the seam without doing the work (this is exactly what `adapters/instagram.js` is today).
