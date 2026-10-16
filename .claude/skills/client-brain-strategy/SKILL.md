---
name: client-brain-strategy
description: "Distill a client's business goals (offers + where each converts: site, cart, booking page), their content buckets, and one successful model X account per bucket into a positioned, evidence-backed strategy, written as a draft of the client's CLIENT_BRAIN.md (Strategy Document, Content Tracks, Track Targets, Benchmark Accounts, positioning, voice). Decides which buckets blend into one account, which are the edge, and which belong on their own account. Use when the user says 'fill out the client brain', 'build the strategy for <client>', 'position this account', 'which content should go on which account', 'blend these content buckets', or 'brain strategy'. Client-agnostic. Keeps a durable working copy filled in as answers land (optionally saved as a draft Brain with owner OK); never approves a Brain, posts, or spends."
metadata:
  version: 1.0.0
---

# Client Brain strategy

Purpose: turn **what the client wants** + **what only they have** + **who already won that game** into the strategy fields of their Client Brain, positioned and backed by measured evidence.

This is a strategy-authoring skill, not a posting coach (that is `x-strategy`) and not market/lead research (Market Signals, Lead Gen). Nothing in here is specific to one client; the HITLOOP case in `references/positioning.md` is a worked example only.

## Intake — start from scratch, ask in this order

Assume nothing. Do **not** pre-fill answers from the existing Brain, inventory, or earlier conversation; those are read later (step 1) to check volume and contradictions, not to choose for the client. Ask open questions in plain text (no pre-baked multiple choice), one step at a time, and wait for the answer.

| Step | Ask | Notes |
|---|---|---|
| 1 | **"What are your business goals, and where does each one convert?"** e.g. client work → contact/booking page, gigs → booking link, records → shop/cart, designs → store. Ask for the offer, the link, and the order of priority. | The business comes first; X is a channel that feeds these destinations. Up to 4 goals. Each = `offer · destination URL · priority`. Ask which one is #1 if they don't rank. |
| 1b | **"Where does every path finally end — the one page you want people to land on — and what should they do there?"** | The final landing page (e.g. the main site, which then leads to booking). Can differ from the per-goal links. The category and positioning are judged against this page, not against a job title. |
| 2 | **"Which client id and X handle(s) is this for?"** | |
| 3 | **"How many content buckets do you have — up to 4? Name each one and describe what's in it."** | A bucket = a body of content they can keep supplying (their work, an archive, a scene, tools, a side passion). If they have more than 4, ask them to merge or drop. |
| 4 | **"Which goal does each bucket feed — or does it feed none directly?"** | Map bucket → goal(s). A bucket that feeds no goal is still valid (reach or differentiation) but must earn its place in the blend. |
| 5 | **"For each bucket: is there an account that already grew posting that kind of content, in the community you want? One per bucket."** | Only if they don't know one: propose 2–3 candidates for that bucket with a one-line reason each; they pick. One model per bucket. |
| 6 | **"How much time per day can you give X, and is anything off-limits?"** | Optional. Default: Tier 1 (~25 min), no extra limits — say the default when asking. |

## Working copy — track and fill as you go (required)

Progress must survive an interrupted session. From the first intake answer on, keep one **working copy** of the draft Brain and update it after every intake answer and every procedure step, not only at step 8.

- **Location** (durable, outside the session scratchpad): `~/.claude/threads/data/client-brain-strategy/<clientId>/` with
  - `CLIENT_BRAIN.draft.md` — built from a **blank form**, holding **only settled answers** (`formToMarkdown(fields, {frontmatter})`, no `preserved`). Never start from the existing Brain: it is read in step 1 for contradictions only. No shares, targets, models or rules until the owner or the analysis has settled them; open choices go in `Strategy Document › Open questions` as plain text. Validate after each update: every filled field parses back to the same value (list fields split on commas — avoid commas inside a list item).
  - `build-draft.cjs` — the settled answers as a field map + build/validate/save; edit the map as answers land and re-run it.
  - `corpora/<handle>.json` — every corpus pull (`--out` straight here).
  - `progress.md` — intake table, step status, findings so far (each with n + source), pending pulls, provisional values.
- **Provisional values** (shares, mixes, a benchmark still under review) go in the draft marked PROVISIONAL in `Strategy Document › Open questions`, so the draft is always complete enough to view.
- **Viewable copy (owner OK once per client):** after the first update, ask whether to save the working copy as a **draft** Brain version so the owner can see it at `/dashboard/brain?as=<clientId>`. On yes: save through `compileAndSaveClientBrainMarkdown` with frontmatter `clientId: <clientId>` and `status: draft`; abort if the client's stored Brain is approved or was edited outside this run (compare against the last saved copy) — ask instead. Re-save after each later update under that same OK. Never approve, never change status.
- **Owner edits on the open page win.** Before reloading the page, check it for unsaved edits (a "Leave site?" guard means there are some): compare each field on the page with the last saved copy, merge the owner's changes into `build-draft.cjs`, confirm anything ambiguous (e.g. a cleared field), save, and only then reload. If the owner clicked Save on the page, the edited-outside-run guard stops the next save: re-read the stored Brain and merge it into the field map first.
- If a thread registry is in use (`/save`, `/open`), link the working-copy folder from the thread file.

Do not start analysis until 1–5 are answered. Business goals are the point; X is the channel that drives traffic to their destinations. Echo the settled inputs back as a short table before step 1 of the procedure.

## Procedure

1. **Read the current Brain + inventory** — `docs/company-brain/clients/<client>/CLIENT_BRAIN.md` if it exists, else the live Brain via the Brain card export; content inventory counts per bucket if the client has one. Note which strategy fields are filled, contradictory, or empty, and anything that conflicts with the intake answers (raise conflicts, don't silently override the intake).
2. **Pull corpora (free)** — own account + each model, ~65 days. `references/bucket-analysis.md` §1 has the commands. Never the X API. Views are optional and metered — ask before any backfill.
3. **Evaluate every handle the owner names** (not only the one per bucket) against its content *and the client's*: does the client have that kind of material (inventory, own best posts), and does it fit the chosen lane? Verdict per handle: **model** (benchmark for a bucket) · **borrow** (name the specific parts worth using, not the account) · **don't model** (with the reason: thin sample, impersonal format the client can't or shouldn't copy, wrong lane, low ceiling). A handle can land in a different bucket than the owner filed it under. Only **model** handles go into Benchmark Accounts; borrow notes go into Formats.
   **Analyze each model** — `references/bucket-analysis.md` §2: reach driver, conversion driver, format/media effects, caption bands, cadence, what never works. Apply every check in `references/evidence-rules.md` before stating a number.
4. **Diagnose the client** — same measures on the own corpus, split by bucket (`references/bucket-analysis.md` §3). Is the gap distribution or content?
5. **Decide the blend** — one verdict per bucket using `references/blend-decision.md`: **core / edge / own account / park**, with the signals that decided it.
6. **Position** — `references/positioning.md`: first the **category decision** (3–4 candidates scored against the final landing page, model proof, own proof; never assume the client's current label), then one positioning line, the edge the models cannot copy, each kept bucket's job (reach, conversion, differentiation) tied to a business goal and its destination link.
7. **Size cadence** — tier from the time budget; split posts/day across kept buckets; type mix per bucket from its model, adjusted by own-account lift.
8. **Write the draft** — fill only the fields in `references/brain-field-map.md` §1–2, in the exact row formats. Keep every untouched section byte-for-byte.
9. **Validate** — round-trip the draft through the Brain form converter (`references/brain-field-map.md` §5). Fix until it parses with zero diff on unchanged fields.
10. **Hand over** (format below) and stop.

## Output

Write the draft to the scratchpad (or `docs/company-brain/clients/<client>/CLIENT_BRAIN.draft.md` if the user asks for a repo file). Never overwrite `CLIENT_BRAIN.md` without an explicit OK.

Reply with, compactly:

- **Positioning** — the one line + the edge.
- **Blend** — table: bucket · model · verdict · deciding evidence.
- **Fields filled** — list, with what changed vs the current Brain.
- **Owner questions** — facts the skill cannot know (`references/brain-field-map.md` §3).
- **Decided but no Brain home** — written into Strategy Document text (`references/brain-field-map.md` §4).
- **Caveats** — thin samples, unmeasured figures, model-only rules.
- **Next step** — owner reviews → Brain card inject/import → approve (owner-only; approving syncs to the live cards and overwrites the Strategy doc).

## Hard rules

- **Read-only**, except the owner-approved draft save of the working copy (see Working copy). No other Firestore writes, no Brain approve, no `client_configs` edits, no posts/replies/follows. `bird` is logged in as a live account — read commands only.
- **No spend** without a per-batch OK: no X API, no ScrapeCreators view backfill, no paid model batch.
- **Every number cites its source** (corpus file + filter, or doc). Unmeasured = say so; never fill from memory.
- **Model-only findings stay labelled** as lane-specific. One account's habit is not a law (see `references/evidence-rules.md` §3).
- **The client's unique content is the strategy's edge** — never drop it silently; a bucket is parked or split only with stated evidence.
- Respect existing owner decisions in the Brain's `Decisions` section; contradict one only with new data, and say so.
