# Underground Existence artists.json integrity and missing-mix recovery

> **2026-10-04 status update — read first:** current state, the Google Drive master mix folder, the 53-mix not-on-site backlog, staged fixes, the Firestore write-path trap and the wallet budget live in `arweave-video-generator/docs/audits/integrity-2026-10-04/README.md`. The defect list below is partly stale (Akila is fixed locally; Blue Jay/Bernard resolved by evidence — the shared file is Blue Jay's).


**Status:** implementation-ready plan  
**Target repository:** `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator`  
**Primary data file:** `artists.json` (canonical mix records; mirrored to Firestore)  
**Companion doc:** `reviews-vs-arweave-crosswalk.md` (Bballi Portfolio / UndergroundExistence project) — 67 Cesar Ramirez reviews cross-referenced against artists.json  
**Decision date:** 2026-09-09

## Executive decision

Fix the record-level data errors in `artists.json` first, then use the Arweave wallet's own transaction history (read-only) to find the correct transaction IDs for mixes that are currently mis-pointed, truncated, or missing. Do not re-upload any audio until the wallet audit proves the file is not already on Arweave.

Outcome required:

- every mix record in `artists.json` points at a unique, resolvable, playable Arweave transaction that is actually that mix;
- no two different mixes share a transaction ID;
- every mix that has a published Cesar Ramirez review either has a hosted MP3 or is on a named, prioritized upload list;
- a machine-checkable validation script exists so this cannot regress silently.

Do **not** change the schema of `artists.json`, rename artist pages, or touch `website/js/player.js` (the streaming remediation plan owns that file). Do **not** move, spend from, or export the wallet. Read-only queries only.

## Problem statement

A 2026-09-08 cross-reference of `artists.json` against the 67 published reviews found these defects. Each is a confirmed, reproducible data error, not a guess.

### A. Shared transaction IDs (two different mixes, one file)

| txid | Records that share it | What's actually wrong |
|---|---|---|
| `FoiSNjnR_NNyrGj_t_TnxVC1P5A4RNsk7UpsxDcNHDg` | AKILA / `...Head Ass!!!` **and** AKILA / `A drink and a smoke on the veranda` | Two distinct mixes (both reviewed separately, 6/24 and '24). One of them is pointing at the other's file. The second MP3 is either uploaded under a different txid or never uploaded. |
| `pk_RLPfAbytba0bMwTh4u5Xx2Bz1Sw-SeW-dZ8T0SMg` | BLUE JAY / `Live at Studio409 New York (2024)` **and** BERNARD BADIE / `Live at UE (B2B Sean Smith)` | Completely unrelated artists and eras (2024 NYC vs. 2009 UE party). One is wrong. Blue Jay's duration is listed as `2:58`, which suggests a placeholder. |
| `5lOnZSh458XC-wk1xTkLimE-L-g0vnKejInB834VAEA` | Chicago Skyway / `For Hakim` (listed twice, once bare `arweave.net/` and once subdomain) **and** Chicago Skyway / `Little White Earbuds Mix` | `For Hakim` is a pure duplicate row. `Little White Earbuds Mix` is a different mix pointing at the wrong file. |

Intentional cross-listings that are **not** defects and must be preserved as-is: VIVA ACID's four entries (mirrors of Bai-ee, Andrew Emil, Sassmouth, Tyrel Viva Acid '24 sets) and RED EYE's entry (mirror of Andrew Emil's Viva Acid '24 set, presumably a b2b). Leave these alone unless the owner says otherwise. But see defect C for a typo inside one of them.

### B. Invalid or truncated transaction ID

| Record | URL | Problem |
|---|---|---|
| BAI-EE / `HPIT Promo Mix` (2022) | `https://arweave.net/neH-PrcWXd71JCZayTX` | 19 characters. Arweave txids are 43. This can never resolve. The real txid must be recovered from the wallet history or the file re-uploaded. |

### C. Malformed URL

| Record | Problem |
|---|---|
| VIVA ACID / entry 4 (Tyrel mirror) | Subdomain is `nbdlqhjegffe2b43r4pz5db2nnluh6b6osbilcbqrlsc7e3ecxasq` but the correct base32 subdomain for txid `aEa4HSQxSk0Hm48fnowtauh_B86QULEGEVyF8myCuCU` (from the TYREL WILLIAMS record) is `nbdlqhjegffe2b43r4pz5dbnnluh6b6osbilcbqrlsc7e3ecxasq`. An extra `2` was typed in. The sandboxed-subdomain host will fail DNS. |

### D. Field hygiene

- CESAR RAMIREZ / `Let Yourself Go`: `mixDateYear` is `'01'` (trailing stray quote). Should be `'01`.
- TYREL WILLIAMS / `Live at Podlasie`: `mixDateYear` is `2024h` (stray `h`).
- STAR TRAXX: `artistImageFilename` is on `ardrive.net`, every other image is on `arweave.net`. Not broken, but inconsistent; normalize to the `arweave.net` gateway form of the same txid.
- Eleven records carry `mixDuration: "0:00"` and several carry `??` for year. These are unknowns, not errors. Fill them only from verifiable sources (the MP3's own duration via the wallet audit below, or the review text); otherwise leave.
- Chicago Skyway `For Hakim` duplicate row: delete one (keep the subdomain form, which is what the player prefers).

### E. Reviewed mixes with no hosted file (45)

Forty-five of the 67 published reviews have no corresponding record in `artists.json`. The full list is in the crosswalk doc. These are candidates for the wallet audit: some may already be on Arweave under a txid nobody recorded. Anything not found becomes the upload backlog.

Highest-value gaps (multiple reviews, or the artist already has a page): Bai-ee (12 reviewed mixes with no record: 303 Day, Live @ Podlasie, A Love Hate Relationship, Live @ Fame, Barack, Live @ 7/20 Underground, Gusto, Loft Livin' Vol. 2, plus others), Cesar Ramirez (Destination, Old School Chicago House Vol. 1, The Return, Keep On Going), Mark Farina (3), Specter (3), Stephen P (2), Derrick Carter (2), Blue J `Shuffle Like This`, Jevon Jackson `Live @ TFU 2009`, and the whole UndergroundExistence 2005–2008 live series (Phil Free Art, Jimmy Krok, BRC, Ryan Tinsley, Pipeline, DJ Automoton, Billy O & K-Squared).

## Non-negotiable product contract

1. A txid in `artists.json` appears at most once, except inside the VIVA ACID and RED EYE mirror pages.
2. Every `mixArweaveURL` is either `https://arweave.net/<43-char txid>` or `https://<base32(txid)>.arweave.net/<txid>` and the subdomain, when present, is the correct base32 encoding of the path txid.
3. Every txid resolves with HTTP 200 and `Content-Type: audio/*` (or the file's magic bytes identify MP3) on at least one gateway.
4. No audio is re-uploaded if the wallet audit finds an existing transaction for the same file (match by filename tag, `Content-Type`, and size within 1%).
5. The wallet is never written to. No `arweave` upload, `ardrive upload-file`, or Turbo call runs from this plan. Recovery finds txids; uploads are a separate, owner-approved step.
6. The keyfile is never printed, copied, committed, or read into a log. Agents only need the **public address**; derive it once with `arweave` or `ardrive get-address`, then work from the address.

## Scope and constraints

- Work only in `arweave-video-generator`. The Bballi Portfolio repo is reference-only.
- Keep `artists.json` valid JSON with the existing key names and ordering.
- Firestore holds a mirror. Do not write to Firestore in this plan; produce a diff the owner can apply, and note in the summary which records changed so the Firestore sync can be run afterward.
- Network calls are read-only: Arweave GraphQL (`https://arweave.net/graphql`, `https://arweave-search.goldsky.com/graphql`), gateway HEAD/GET, ArDrive CLI list/info commands.
- If the wallet keyfile is not available on the machine, the agent reports that and completes everything that does not need it (defects A–D are all fixable without the wallet, except recovering the *second* file behind each shared txid).

## Recommended architecture

Three independent workstreams that can run as parallel Sonnet agents, then one integration pass.

**Agent 1 — Validator and mechanical fixes (no wallet needed).**
Build `scripts/validate-artists-json.mjs`, apply defects C and D, delete the `For Hakim` duplicate, and produce a report of every txid's live status.

**Agent 2 — Wallet and ArDrive audit (read-only).**
Enumerate every transaction ever posted by the wallet address, build an inventory (txid, filename tag, content type, size, timestamp, ArDrive drive/folder path if any), and match it against (a) the three shared-txid conflicts, (b) the truncated HPIT txid, and (c) the 45 un-hosted reviewed mixes.

**Agent 3 — Review-to-record reconciliation.**
From the crosswalk and Agent 2's inventory, propose the exact `artists.json` records to add or repair, with the review text as the source for title, artist, and year where the file's tags are missing.

**Integration pass (one agent, after 1–3 finish).**
Merge, re-run the validator, run the site build, verify the player loads each changed record, write the summary.

## Implementation work breakdown

### Agent 1: validator and mechanical fixes

1. Read `artists.json`. Confirm the schema matches the reference copy (top-level array of `{artistName, artistFilename, artistImageFilename, artistGenre, mixes[]}`, each mix `{mixTitle, mixArweaveURL, mixDateYear, mixDuration, mixImageFilename}`).
2. Write `scripts/validate-artists-json.mjs` that:
   - parses every `mixArweaveURL`, extracts the txid, and asserts it is exactly 43 chars of `[A-Za-z0-9_-]`;
   - when the host is a `*.arweave.net` subdomain, recomputes base32 (RFC 4648, lowercase, no padding) of the base64url-decoded txid and asserts it equals the subdomain;
   - flags any txid used by more than one record, with an allowlist for `VIVA ACID` and `RED EYE` mirrors;
   - flags `mixDateYear` values that do not match `^('\d{2}|\d{4}|\d{1,2}/\d{2}(/\d{2})?|Circa .+|\?\?|20\?\?)$`;
   - with `--live`, issues a HEAD (fall back to a ranged GET of the first 2 KB) against `https://arweave.net/<txid>` and reports status, `Content-Type`, and `Content-Length`;
   - exits non-zero on any structural failure; live failures are reported but non-fatal (gateways flake).
3. Apply the mechanical fixes:
   - VIVA ACID entry 4 subdomain: replace with the correct base32 (or, simpler and equally valid, the bare `https://arweave.net/aEa4HSQxSk0Hm48fnowtauh_B86QULEGEVyF8myCuCU` form).
   - `mixDateYear` `'01'` → `'01`; `2024h` → `2024`.
   - Remove the bare-URL `For Hakim` duplicate under Chicago Skyway.
   - STAR TRAXX image: rewrite to `https://arweave.net/_Sa6yaXr7XxUxzMw9WWCqz0lUeSj-iT1xhgwanY5TMQ/img/artists/startraxxthumb.jpg`, then verify it loads; revert if it does not.
4. Add `"validate:artists": "node scripts/validate-artists-json.mjs"` to `package.json` and wire it into whatever the existing pre-build or test script is.
5. Run `--live` once and save the output to `docs/audits/artists-json-live-status-<date>.md`. This tells Agent 3 which shared-txid file is which (a 2:58 file vs. a 120:00 file are trivially distinguishable by `Content-Length`).

### Agent 2: wallet and ArDrive audit (read-only)

1. Locate the wallet **without reading the key into context**:
   - check `.env*`, `config/`, `wallet*.json`, `arweave-keyfile*.json`, `ARWEAVE_WALLET`, `ARWEAVE_KEYFILE`, `ARDRIVE_WALLET` references in the repo and in `~/.ardrive` or similar; also check the `mix-range-proxy/` and any upload scripts for how the site was deployed;
   - derive the public address only: `npx ardrive get-address -w <path>` or `node -e` using `arweave.wallets.jwkToAddress` from the keyfile path. Print **only** the address. Never `cat` the keyfile.
   - if there is more than one wallet, do this for each.
2. Enumerate transactions by owner via GraphQL (paginate with `after` cursors until `hasNextPage` is false; use both `arweave.net/graphql` and the Goldsky endpoint, union the results, since neither is guaranteed complete):
   ```graphql
   query($owners:[String!], $after:String) {
     transactions(owners:$owners, first:100, after:$after, sort:HEIGHT_DESC) {
       pageInfo { hasNextPage }
       edges { cursor node {
         id block { height timestamp } data { size type }
         tags { name value } bundledIn { id }
       } }
     }
   }
   ```
   Also query `tags:[{name:"Content-Type", values:["audio/mpeg","audio/mp3","audio/wav","audio/x-wav"]}]` with the owner filter, to catch bundled items whose owner is the bundler.
3. Enumerate ArDrive holdings, which carry folder structure and original filenames that raw L1 queries lose:
   - `npx ardrive list-all-drives -w <path>` (or `--wallet-file`), then for each drive `npx ardrive list-drive -d <driveId>` (add `-p <password>` prompt handling only if a private drive exists; do not hardcode passwords);
   - every file entry has `dataTxId`, `name`, `size`, `lastModifiedDate`, `path`. `dataTxId` is what belongs in `artists.json`.
   - If the ArDrive CLI is not installed, `npx ardrive-cli@latest`; if network is refused, report and fall back to GraphQL only.
4. Build `docs/audits/wallet-inventory-<date>.json`: one row per data transaction with `txid, size, contentType, filenameTag, ardrivePath, blockTimestamp, bundledIn`. Sort by timestamp. Also write a human-readable `.md` table filtered to audio only.
5. Resolve the four hard cases:
   - **Akila**: find every audio tx whose filename or ArDrive name contains `akila`, `head`, `drink`, `smoke`, `veranda`. Expect two files. Report which txid is which; if only one exists, say so plainly — that means one Akila mix was never uploaded.
   - **Blue Jay Studio409 vs. Bernard Badie/Sean Smith UE**: same approach with `zeitler`, `blue`, `409`, `badie`, `smith`. Use `Content-Length` from Agent 1's live report to identify which file the shared txid actually is.
   - **Chicago Skyway Little White Earbuds**: search `skyway`, `lwe`, `earbuds`, `hakim`.
   - **HPIT Promo Mix**: search `hpit`, `promo`, and any 2022 Bai-ee audio tx whose txid **starts with** `neH-PrcWXd71JCZayTX` (the truncated string is very likely the prefix of the real txid).
6. Match the remaining 45 un-hosted reviews against the inventory by fuzzy filename (normalize: lowercase, strip punctuation, compare artist and 2–3 title keywords). Output three lists: `found_on_arweave` (txid ready to add), `ambiguous` (needs a human ear), `not_on_arweave` (upload backlog).
7. Do not upload anything. Do not delete anything. Do not run `ardrive` subcommands other than `get-address`, `list-*`, `file-info`, `folder-info`, `drive-info`.

### Agent 3: review-to-record reconciliation

1. Load `cesar-ramirez-mix-reviews.json` (67 reviews, each with an `arweave` block or `null`) and the crosswalk. Treat review text as authoritative for artist name, mix title, and era; treat Agent 2's inventory as authoritative for txid, size, and duration.
2. For each of the four hard cases, write the corrected record(s). Example target state for Akila:
   ```json
   { "mixTitle": "...Head Ass!!!", "mixArweaveURL": "https://arweave.net/<txid-A>", "mixDateYear": "6/24", "mixDuration": "<from file>", "mixImageFilename": "<existing>" },
   { "mixTitle": "A Drink & A Smoke On The Veranda", "mixArweaveURL": "https://arweave.net/<txid-B>", "mixDateYear": "'24", "mixDuration": "<from file>", "mixImageFilename": "<existing>" }
   ```
   If Agent 2 found only one Akila file, keep the record that matches it and mark the other `"mixArweaveURL": ""` with a `// TODO upload` note in the PR description (not in the JSON, which must stay valid). Do the same for the other conflicts.
3. For every review in Agent 2's `found_on_arweave` list, draft a new mix record under the correct artist page (create the artist entry if none exists, following the existing pattern: `artistFilename` slug, `artistGenre` from the review's described style, image reused from an existing cover only if genuinely the same artist; otherwise leave `artistImageFilename` pointing at the shared placeholder used by the site, and list it as a needed asset).
4. Where `mixDuration` is `0:00` and Agent 2 has the file size, compute an estimate only if the bitrate is known from the file header; otherwise leave `0:00`. Do not invent durations.
5. Produce `docs/audits/artists-json-proposed-changes-<date>.md` with a before/after diff per record and the evidence line (review id, txid, ArDrive path) for each change.
6. Produce the upload backlog `docs/audits/upload-backlog-<date>.md` ordered by: (1) mixes that resolve a broken record, (2) Bai-ee and Cesar Ramirez reviewed mixes, (3) everything else, with the review's Asana link on each row so the owner can find the source file.

### Integration pass

1. Apply Agent 1's mechanical fixes and Agent 3's proposed records to `artists.json`.
2. Run `npm run validate:artists -- --live`. Zero structural failures required. Any live failure on a *changed* record blocks; live failures on untouched records are logged.
3. Build the site the way the repo already does (check `package.json` scripts and the existing deploy notes). Open the local build, load each changed artist page, click play on each changed mix, confirm audio starts and the waveform draws. Do not deploy to Arweave and do not change the GoDaddy forward.
4. If Firestore mirroring code exists, run it in dry-run mode only and include its diff in the summary.
5. Write `docs/audits/ARTISTS_JSON_INTEGRITY_SUMMARY.md`: what changed, what was recovered from the wallet, what remains on the upload backlog, and the exact files touched.

## Acceptance criteria

- [ ] `scripts/validate-artists-json.mjs` exists, runs in `npm test` or pre-build, and passes.
- [ ] No txid appears in more than one record outside the VIVA ACID / RED EYE allowlist.
- [ ] Both Akila mixes point at distinct, live txids, or exactly one is marked for upload with evidence that the other file does not exist on the wallet.
- [ ] Blue Jay Studio409 and Bernard Badie/Sean Smith point at distinct, live txids, or one is on the backlog with evidence.
- [ ] Chicago Skyway has one `For Hakim` record and `Little White Earbuds Mix` is either fixed or on the backlog.
- [ ] HPIT Promo Mix has a 43-char txid that resolves, or is on the backlog.
- [ ] VIVA ACID entry 4 URL resolves.
- [ ] `mixDateYear` values all pass the validator pattern.
- [ ] `docs/audits/wallet-inventory-<date>.json` exists and lists every audio transaction under the wallet address, with ArDrive paths where available.
- [ ] `docs/audits/upload-backlog-<date>.md` accounts for every one of the 45 un-hosted reviews (found, ambiguous, or not on Arweave).
- [ ] No file was uploaded, no wallet operation beyond `get-address` and `list`/`info` ran, and the keyfile contents never appear in any log, doc, or commit.
- [ ] `git diff --stat -- website/js/player.js` is empty.

## Rollout plan

1. Land Agent 1 (validator + mechanical fixes) as its own commit; it is safe regardless of what the wallet audit finds.
2. Land the audit docs as a second commit (no `artists.json` changes).
3. Land the reconciled `artists.json` as a third commit with the proposed-changes doc as the PR description.
4. Owner reviews the upload backlog and decides what to upload; that is a separate plan.
5. Only after the reviews site content (the 67 reviews) is wired up does a new Arweave manifest get deployed, following the streaming remediation plan's deploy steps.

## Claude assignment prompt

> Work in `/Users/bballi/Documents/Repos/EditVideos/arweave-video-generator`. Follow `docs/plans/UNDERGROUND_EXISTENCE_ARTISTS_JSON_INTEGRITY_MASTER_PLAN.md`. Run three Sonnet subagents in parallel, one per workstream (Agent 1: validator and mechanical fixes; Agent 2: read-only wallet and ArDrive audit; Agent 3: review-to-record reconciliation), then a single integration pass once all three return. Inputs: `artists.json` in the repo, `cesar-ramirez-mix-reviews.json` and `reviews-vs-arweave-crosswalk.md` (copy them into `docs/audits/inputs/` first). Hard rules for every agent: never print, copy, or commit the wallet keyfile, only derive the public address from it; never upload, delete, or spend, read-only ArDrive and GraphQL calls only; never edit `website/js/player.js`; keep `artists.json` valid JSON with the current schema; do not deploy to Arweave or touch the GoDaddy forward. The two Akila mixes, the Blue Jay / Bernard Badie collision, the Chicago Skyway Little White Earbuds collision, and the truncated HPIT Promo Mix txid must each end in one of exactly two states: fixed with a distinct live txid, or on the upload backlog with evidence the file is not on the wallet. Return: the exact files changed, validator output, the wallet inventory row count (audio only), the four hard-case resolutions with evidence, the upload backlog count, and remaining risks.

## First action

Agent 1 starts immediately (no wallet needed). Agent 2's first step is locating the keyfile path and printing only the derived address; if it cannot find a keyfile, it says so and proceeds with GraphQL against any address found in the repo's deploy history or `.env` references. Agent 3 waits for Agent 1's `--live` report before resolving the shared-txid cases, and works the 45-review reconciliation in the meantime.
