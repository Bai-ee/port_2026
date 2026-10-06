# Instagram Channel Strategy (Active Content System, Phase 5)

Status: adapter built behind the flag; Instagram stays NOT LIVE (`platforms.js` `live:false`). Going live is an owner decision. Parent plan: `ACTIVE-CONTENT-SYSTEM-PLAN.md` §3g.

Code: `features/social-posting/adapters/instagram.js` (Graph API container flow), `features/social-posting/instagram-caption.js` (pure caption builder). Tests in `features/social-posting/__tests__/instagram-adapter.test.js`.

## 1. Why Instagram is not an X mirror

- X rewards the story as text; the artifact is an attachment. Instagram is media-first: the artifact is the post, the caption is secondary.
- Format is gated: Reels (9:16 video), single image, carousel (2-10). Text-only posts do not exist.
- Captions allow 2200 chars but links are not clickable; credits and links become "link in bio" text.
- No reply-guy / quote-react growth lever like X. Reach mechanics differ and are UNKNOWN for this account (no data).
- Cadence and audience differ; a cross-post of the X schedule would be wrong on both.
- Owner rules still apply: no emoji; 9:16 is the full portrait frame (no letterbox crops).

## 2. Formats per engine

| Engine | Primary | Secondary |
|---|---|---|
| Records | Reel from the existing `publish-staging/discogs/<id>/video-9x16.*` render | Carousel: label, sleeve, back sleeve (from `image-9x16.*` plus extra stills) |
| Underground Existence | Reel with a mix excerpt (needs the later excerpt render, >10 s, beat-synced) | Single image of the artist/mix art |
| Client work | Carousel: before / after / decision / result | Short reel only when a screen recording exists |

Rule: nothing publishes without a written story (caption builder refuses placeholders). Client work additionally needs the existing per-client approval record and rights.

## 3. Starting cadence (proposal, owner to confirm)

- Ceiling: 1 reel per day. Start at 3 posts per week (e.g. 2 records reels + 1 carousel or UE reel), raise to 5 only if the pipeline sustains quality.
- Rationale: the content supply is the constraint (stories are hand-written), not the API. Instagram's own publishing cap is documented as a rolling-24h per-account limit (exact current number: UNKNOWN here, verify in Meta docs before go-live; the adapter maps limit errors to a non-retryable `ig-rate-limited`).
- Scheduling: reuse the quota layer with a separate per-platform config. Do NOT reuse the X once-daily `process-due` slot assumption without checking (X cron is `40 13 * * *`, Vercel Hobby).
- Any "best time to post" claim: UNKNOWN until insights exist.

## 4. What we lack

- No Instagram account data: follower count, existing audience, past performance are all unknown.
- No insights path built: reach, plays, saves, shares, profile visits are not read anywhere.
- No verified link between records / UE / client audiences and Instagram interests.
- No stored token or account: nothing is connected.

## 5. Prerequisites to go live (owner / ops)

1. Instagram Business or Creator account (not personal).
2. Meta developer app; if using Facebook Login, the account linked to a Facebook Page.
3. Permissions: `instagram_business_content_publish` (Instagram Login) or `instagram_content_publish` plus `pages_show_list` / `pages_read_engagement` (Facebook Login). App Review / Business verification may be required for use beyond app-role testers: status UNKNOWN.
4. Long-lived token (about 60 days) with a refresh job and expiry alert; stored through the existing `social-accounts` store (platform-generic), never in the repo or logs.
5. Media must be a PUBLIC https URL that Instagram's servers can fetch (it pulls the file itself). Use public or long-lived signed Firebase Storage URLs; the signed URL must outlive the poll window. Local NAS paths cannot be used.
6. Media constraints to verify against current Meta docs before go-live: reel length/size/codec, aspect ratio, image JPEG only, carousel item rules.
7. OAuth connect flow (new route + UI row; the Social Accounts card already has a generic row). Not built.
8. Flip `platforms.js` instagram `live:true` only after a supervised test post on a throwaway account.

## 6. Owner decisions

- Go/no-go, and which account is first (personal brand vs a HITLOOP account; plan defers HITLOOP account until audience data justifies it).
- Hashtag policy: default is 3-5 relevant tags from the package (none invented; fewer if the package has fewer). Alternatives: zero tags, or a fixed per-engine set.
- Auto vs approval mode (recommend approval for the first month).
- Login type: Instagram Login vs Facebook Login (changes host/permissions; adapter uses `graph.facebook.com` via one constant).
- First-comment strategy and whether to cross-link X handle in bio.
- Whether client work may appear on a personal Instagram at all (rights).

## 7. Feedback loop hooks (not built)

- After publish, store `instagramMediaId` on the post and `package.metrics.instagram`.
- Later insights reader (`/{media-id}/insights`: plays, reach, saves, shares) writes to `package.metrics.instagram`, same shape principle as X metrics, so the existing scorer can learn per-channel. Free of the X spend gate, but still rate-limited: UNKNOWN limits.
- Until then the strategy above is a hypothesis, not a measured plan.

## 8. Wiring still needed (later phase, other agents' files)

- `twitter-service.js` / `app/api/social-posting/route.js`: route by `post.platform` through `getAdapter`, carry `variants.instagram` and 9:16 asset URLs, call `buildInstagramCaption`, resolve `accessToken`/`igUserId` from `social-accounts`, and persist the error flags (`retryable`, `ambiguous`, `stage`). `ambiguous:true` must park the post as `needs_review`, never auto-retry (same as the X stale-claim rule).
- The sweep must treat `ig-poll-timeout` / `ig-transient` as retryable with the existing 3-attempt cap, and `ig-publish-ambiguous` as never.
