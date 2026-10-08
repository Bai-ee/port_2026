# Brain ⇄ Content Library retrieval — parked idea (2026-10-08)

**Status:** PARKED (now P6 of the broader `LIVING-TIMELINE-ARCHIVE-PLAN.md`; index in `ELEVATION-LIST.md`). Nothing here is built. Revisit after the first real Batch-mode run and a first full NAS analysis.
**Owner intent:** the Client Brain should be able to *access and draw tone and understanding from* the content library, and the owner should be able to *search all the content from the Brain*. Retrieval, not a second copy.

## Where the data lives today

| Place | What | Notes |
|---|---|---|
| `~/.archive-analyzer/cache/<sha>.<hash>.json` (Mac) | Full analysis per image: facets, flyer text (`ocrText`), summary, event-date fields | Re-sendable to the bucket for free (cache hit). |
| Firestore `x_content_packages/nas-<sha16>` | Sanitized facets, summary, story, event dates | What the Buckets tab searches. |
| `HITLOOP-ARCHIVE/content/_meta/<sha>.json` (NAS) | Analysis + original path sidecar | Survives a database wipe. |
| Facebook export `facebook-HousepitCHI/{posts,events,page_profile_information,...}` | Past event text, descriptions, dates | Possibly a better Brain source than the photos. |

## Facts verified when this was written

- The **Content Engine does not call the Client Brain** today.
- `loadClientBrainContext` is read by nine places: strategy builder, brief summary runner, Not The Rug runtime, email digest route, recipe-run (reply targets), Proof Builder, pre-digest refresh, the social-posting route, and the digest route. See `docs/company-brain/DOWNSTREAM_CONTEXT_USAGE.md`.
- `loadClientBrainContext` returns `''` when the Brain is not approved. At last check the HITLOOP Brain was a draft, so Enhance would get no brand voice. **Re-verify in the card.**

## Division of labor (keep)

- **Client Brain:** how to sound (approved voice, positioning, proof).
- **Content Engine / NAS catalog:** which real piece of content, and when. The catalog is the **single source of truth for facts, dates and lineups.**
- **Market Signals:** what to talk about right now.

## Proposed approach (one-way, retrieval)

### Phase 1 — small, no data copy
1. `searchContent(clientId, query)` on top of the existing Buckets search index. Understands `date:`, people, venues, `vibe:` and free text. Returns summary, story, event date and confidence, flyer text. **Read-only**; the Brain can never write to the catalog.
2. Brain card gets a **Content library** tab: same search box, results open the flyer and its details.
3. `loadClientBrainContext(clientId, { topic })`: when a topic is passed, append the 3–5 most relevant catalog items (not the whole catalog). With no topic, behavior is unchanged, so the nine consumers do not change.

### Phase 2 — semantic search (when the catalog is bigger)
Meaning-based search ("flyers that feel like early Housepit"). The app already has a vector index configured; embedding ~1,300 items costs well under a dollar.

### Phase 3 — voice suggestions
A job reads the owner's approved posts and stories and *proposes* updates to the Brain's tone section for the owner to approve. Never writes to the Brain on its own.

## Rules to bake in

- Only content cleared for use: rights not never-public or third-party; a confirmed story for owner posts.
- **Face-derived names are excluded** until the owner confirms them (see "Face recognition" below).
- Dates keep their confidence label: `printed`, `inferred from Thursday`, `month and day only`. A post must never present a guess as a fact. Pass event facts to Enhance as **do-not-change**, and run `features/x-content-guard` afterward.
- Dates come **only from flyer text**, never file metadata (`capturedAt` is the Facebook download time).
- The generated timeline (if exported to `CONTENT_LIBRARY.md`) is marked **generated** and rebuilt on demand, so it cannot go stale.

## Known conflicts / risks

1. **Two copies of the facts** if the timeline is copied into the Brain. Avoid with retrieval or a generated, marked export.
2. **A rewrite could change a date.** Mitigate with do-not-change facts + the content guard.
3. **Unreviewed data reaching emails and posts.** Gate by approval and rights.
4. **Unapproved Brain is silent** (returns `''`).
5. **Open question:** which client owns the Housepit CHI archive? The owner's own brand voice, HITLOOP, or its own client with its own Brain? This decides which voice Enhance uses on throwback posts.

## Escalation: could the content system replace the Brain?

Plausible for the owner's own account, risky as a product move. The Brain is multi-client, has an approval step, and holds decided things (positioning, proof, banned phrases) that an archive cannot supply.

**Strangler path if pursued:**
1. Keep `loadClientBrainContext` as the stable interface.
2. Make the content system the *producer* for the fact, example-post and people sections.
3. Leave positioning, proof and rules human-decided.
4. After a few weeks, audit what is left in the Brain that the content system does not cover. If thin, collapse it then.

**Read-only audit that would settle it:** compare the Bai-ee Brain, section by section, against what the content system could already supply.

## Related parked item: face recognition

Not built. Claude does not name people from faces; the analyzer takes `people` only from visible text or folder names. Options discussed: (A) local face grouping + owner names each group (recommended; install needs owner approval; fingerprints stay on the Mac), (B) cloud face search, (C) mine names from Facebook export captions/tags and flyer lineups (do this first, it is free). Dark, neon-lit, small-in-crowd faces will match poorly. Illinois BIPA applies to face data of Illinois residents; keep everything local, never publish a face-derived name unconfirmed.

## Triggers to revisit

- First real Batch-mode run completed and cost confirmed.
- First full folder analyzed (so the catalog has real volume).
- The owner asks for Brain-side search, or a throwback post needs Brain voice plus catalog facts.

## Related docs

- `docs/company-brain/DOWNSTREAM_CONTEXT_USAGE.md`
- `docs/plans/CONTENT-ENGINE-V2-MASTER-PLAN.md`
- `assetManager/docs/archive/ANALYZER.md` (batch mode, live estimate, event dates)
