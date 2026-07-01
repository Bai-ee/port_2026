# Copywriter Card — Source of Truth

As-built reference for the **Copywriter** card (`cardId: 'copywriter'`) in the **Social Media Manager** bucket. A quick tweet notepad: draft, score live, edit, AI-enhance, and save / schedule / post — all on top of the existing social-posting backend, so drafts flow between it and the **Schedule Posts** card.

> If anything here conflicts with [`SOURCE-OF-TRUTH.md`](SOURCE-OF-TRUTH.md), that wins. Read this before touching the `copywriter` card, `CopywriterCard.jsx`, or the `score` / `update` / `enhance` actions in `app/api/social-posting/route.js`.

---

## 1. What it is

- **Bucket:** Social Media Manager (`category: 'social'`). The Copywriter tile **leads** the bucket, ahead of `social-media-posting` (Schedule Posts).
- **Purpose:** low-friction "notepad" for X/Twitter posts. Distinct from Schedule Posts (the fuller queue manager) — but they **share the same store**, so a draft saved here shows up there and vice-versa.
- **Card object:** defined in the `intakeCapabilityCards` array in `DashboardPage.jsx` (`id: 'copywriter'`, `number: 'CW'`, `label: 'DRAFT'`, `title: 'Copywriter'`, `placeholderLabel: 'QUICK\nDRAFTS'`).
- **Modal is a single top panel only** — `copywriter` is in `CUSTOM_DETAIL_CARD_IDS` (`DashboardPage.jsx` ~line 1472), which suppresses the generic `REPORT / SOLUTIONS / PROBLEMS / DATA` tabs that otherwise stack below every capability card. Removing it from that set brings the extra container back.

## 2. UI (component)

`components/dashboard/CopywriterCard.jsx` — dynamic import (`ssr: false`), mounted by the `activeTileModal.cardId === 'copywriter'` branch in `DashboardPage.jsx` inside the standard `tile-detail-tabbed-container` → `tile-detail-tab-content` → `tile-detail-tab-pane`, as `<CopywriterCard getIdToken={brandSystemGetIdToken} />`.

Single-column vertical stack, **white theme** per [`docs/dashboard-modal-component-style-guide.html`](../../public/docs/dashboard-modal-component-style-guide.html) (white glassy panels, ink `#2a2420`, hairlines `rgba(42,36,32,0.12)`, pill buttons, mono kickers). Sections top→bottom:

1. **Composer** (`#copywriter-composer`) — textarea, char count `/280`, action pills (Save/Update Draft · AI Enhance · Copy · New · **Post Now**), a Schedule control (datetime + Schedule button), notice/error line.
2. **Live Score** (`#copywriter-score`) — deterministic X-algo score as you type (see §4). Meter + type/action chips, full-width bar, up to 2 recommendations + warnings.
3. **Analyzed Posts** (`#copywriter-enhance`) — **always rendered** as two placeholder cards (**Brand Voice**, **Best for X**). AI Enhance fills them in place (a pulsing "Analyzing…" state while running); each becomes a full-width scored card with **Copy** + **Use this** (loads it into the composer). **Clear** resets to placeholders.
4. **Saved Drafts** (`#copywriter-saved-list`) — non-published rows from the store; click one to edit it in place.

Presentation-only; all data flows through the API in §3. No direct Firestore listener.

## 3. Backend — shared social-posting API + store

Everything routes through **`app/api/social-posting/route.js`** and Firestore top-level collection **`social_posts`** (one doc per post, `clientId` is a field). Producer/consumer logic = `features/social-posting/twitter-service.js`. Posts written from this card carry `source: 'copywriter'`.

Actions used by the card:

| Action | Handler | Notes |
|---|---|---|
| `GET` | `readSocialQueue` | loads drafts + Twitter credential status on mount |
| `score` | `scoreXPost` (inline) | **new** — deterministic, no LLM, no KB fetch; powers the live score (debounced). Short-circuits **before** the KB-retrieval block. |
| `enhance` | `enhancePost` (inline) | **new** — AI Enhance; see §5. Short-circuits before the KB block; uses Client Brain voice, not KB retrieval. |
| `draft` | `createSocialPost` | Save Draft (new doc) |
| `update` | `updateSocialPost` | **new** — edit a draft/scheduled post in place (see §6); ownership-checked; re-scores |
| `schedule` | `schedulePost` | writes `scheduledAt` + status `scheduled`/`queued` |
| `post-now` | `postNow` | publishes immediately |
| `optimize` | `runPostingAgents` | legacy deterministic reshape (kept; not surfaced by the card after the AI Enhance swap) |

New exports in `twitter-service.js`: `updateSocialPost`, `enhancePost` (both documented below).

## 4. Live score (evaluate) — free & deterministic

- Module: **`features/x-growth/`** — `scoreXPost(text, { mediaType, objective, kind })` returns `{ xGrowthScore (0..1), postType, targetAction, scores, warnings, recommendations, … }`. Pure pattern-matching against `algorithm-profiles/x-2026-05-15.json`; **no LLM, no network cost**.
- The card debounces (~500 ms, race-safe via a request-id ref) and POSTs `{action:'score', content}`. Scoring runs on the **raw** composer text (not the hashtag-stripped `optimize` output).
- ⚠️ `scoreXPost` can't run client-side (`algorithm-profile.js` uses `createRequire`), so the `score` server action is the single source. Keep it ahead of the KB-context fetch in the route or every keystroke triggers an expensive retrieval.

## 5. AI Enhance — two spelling-corrected rewrites

`enhancePost(content, { clientBrainContext })` in `twitter-service.js` (mirrors `generatePromoCopy`: `createAnthropicClient` from `features/not-the-rug-brief/anthropic-client.js`, model **`claude-sonnet-4-6`**). One Claude call returns strict JSON `{ voice, algo }`:

- **`voice`** — the post rewritten in the brand's established voice (Client Brain), meaning preserved.
- **`algo`** — the post rewritten to score best on the X algorithm (hook, specificity, invites replies; no engagement-bait, no hashtag stuffing, no link-only CTA).
- Both are spelling/grammar-corrected and ≤280 chars. Robust parse (strips ``` fences, isolates the `{…}`). **On any failure both fall back to the normalized original** — never throws.

Route `enhance` action:
1. Loads Client Brain voice via `loadClientBrainContext(clientId, { useFor: 'socialPosts', maxChars: 1500 })` (`features/client-brain/store.cjs`). Absent/unapproved ⇒ `''` ⇒ brand-only tone.
2. Calls `enhancePost`, then scores **each** rewrite with `scoreXPost`.
3. Returns `{ candidates: [{ id:'voice', label:'Brand Voice', text, score }, { id:'algo', label:'Best for X', text, score }] }`.

Card maps candidates onto the two fixed **Analyzed Posts** slots by `id`.

⚠️ Requires `ANTHROPIC_API_KEY` (same as Copy & Creative's `generate-copy`). If unset, `enhancePost` degrades gracefully but both cards show the unchanged original.

## 6. Update in place

`updateSocialPost(clientId, postId, payload)` in `twitter-service.js` — mirrors `attachMediaToPost`: ownership check via `getPost` (client-scoped), 280-char guard, optional `scheduledAt` re-arm/clear, re-attaches `agents` (re-scored), `savePost`. Blocks editing already `posted`/`posting` rows (409). Used by the `update` action so editing a saved draft **patches the same doc** instead of duplicating.

## 7. Scheduling caveat

Same model as Schedule Posts: schedule = a field on the draft (`scheduledAt` + status) swept by `processDuePosts`. ⚠️ **`/api/social-posting/process-due` is NOT in `vercel.json` crons** — scheduled posts only fire via the Schedule Posts card's manual "process-due" button or an external caller until that cron is added. The Copywriter card writes `scheduledAt` correctly; auto-publish depends on that gap being closed.

## 8. Files

- Card + modal wiring, `CUSTOM_DETAIL_CARD_IDS`: `DashboardPage.jsx`
- Component: `components/dashboard/CopywriterCard.jsx`
- Route: `app/api/social-posting/route.js` (`score`, `enhance`, `update` actions)
- Producer/consumer + new exports: `features/social-posting/twitter-service.js` (`updateSocialPost`, `enhancePost`)
- Scoring: `features/x-growth/` (`scoreXPost`)
- Voice: `features/client-brain/store.cjs` (`loadClientBrainContext`)
- Store: Firestore `social_posts`

## 9. Known gaps / next

- **Data formatting polish** (the current top item): tighten how saved-draft rows, scores, and candidate bodies render — text truncation, score/status alignment, empty-state copy.
- Auto-publish cron (§7).
- Consider bumping `enhancePost` to `claude-opus-4-8` for stronger rewrites at higher cost (currently matches the repo's `claude-sonnet-4-6` social-copy convention).
