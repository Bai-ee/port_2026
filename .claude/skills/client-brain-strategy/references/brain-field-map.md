# Brain field map — what the skill writes, where it lands

Formats are from `docs/company-brain/CLIENT_BRAIN_MARKDOWN_STANDARD.md` (read it if anything here looks off; it wins). Ownership/sync: `features/client-brain/brain-sync.cjs`, `docs/source-of-truth/CLIENT-BRAIN-SOURCE-OF-TRUTH.md` §2.

## 1. Fields that change live settings on approve

| Brain field | Exact format | Lands in | Effect |
|---|---|---|---|
| `## Strategy Document` › `### Thesis` `Audience` `Tracks` `Formats` `Rules` `Algorithm` `Decisions` `Open questions` | prose or short bullets, ≤ 2,000 chars each | `x_strategy_docs/{clientId}` | Strategy card; Rules + Formats feed drafting. **Overwrites even a confirmed doc.** |
| Content › `### Content Tracks` | `- label: <name> \| share: <pct> \| topics: a; b \| benchmarks: h1; h2` (≤ 6 tracks, ≤ 3 benchmarks, no `@`) | plan `contentTracks` | tracks, shares, per-track benchmark evaluation |
| Content › `### Track Targets` | `- track: <label> \| postsPerDay: N \| original-showcase: % \| original-text: % \| reply: % \| quote: % \| self-quote: % \| video: %` (types sum 100; video is a cross-cut) | `postsPerDay` → plan `engineTargets` / `authoredPerDay`; type % Brain-only | daily slot count; type % only drives "behind target" checks |
| Market › `### Benchmark Accounts` | one handle per bullet (≤ 8) | `xGrowth.benchmarkHandles` | which corpora the Strategy tab compares against |
| Identity › `### X Handle` | handle without `@` | `xGrowth.ownHandle` + `brandXHandle` | measured account |
| Identity › `### Positioning`, `### Primary Audience` (bullets), `### Strategic One-Liner`, `### Mission` | prose / bullets | Brand Overview | positioning, audience, headline, summary |
| Content › `### Content Pillars` | one per bullet | Strategy Builder preferred narratives | Builder topics |
| Content › `### Topics To Avoid` | one per bullet | Strategy Builder avoid list | Builder exclusions |
| Content › `### Voice` | one paragraph | Scribe tone | drafting tone |
| Content › `### Voice Pillars` | `- name: .. \| description: .. \| do: .. \| dont: ..` | Scribe/Guardian | voice rules |
| Content › `### Example Posts` | `- type: .. \| label: .. \| post: ..` or bare bullet | few-shot examples | strongest "sound like me" lever — use the client's own best posts |
| Content › `### Formatting Rules` | `- key: value` with keys `short` `medium` `long` `caps` `emojis` `punctuation` `links` | Scribe + Guardian copy rules | caption length, links-in-reply, etc. |
| Content › `### Do Not Say` | one per bullet | banned words / hard constraints | Guardian |
| Content › `### Creators I Emulate` | one handle per bullet | Scribe instructions | style reference (use the models) |

## 1b. Filled from intake step 1 (business goals)

| Brain field | From |
|---|---|
| Identity › `### Offers` | each goal's offer, priority order |
| Content › `### Calls To Action` | one CTA per goal, #1 goal first (the first item syncs to Strategy Builder's CTA) |
| Content › `### CTA Url` | the #1 goal's destination |
| Identity › `### Primary Url` | the client's main site if given |
| Strategy Document › `### Formats` | per-track routing: which goal link goes in that track's first self-reply |

⚠️ A **new** track has no content engines (engines = inventory sources: record, ue, client, identity; owned by X Strategy). Its Track Targets row will not map (`trackTargets: track has no engines`), so its posts are manual until an engine exists. Say so in the handover.

Per-track links also exist as plan **promotions** (owned by X Strategy, not the Brain) — list them in Formats and tell the owner to set them in the Content tracks panel.

## 2. Context-only fields (read by copy tools, no settings change)

Identity › `Category To Own`, `Category To Avoid` (both **solved** by the category decision in `positioning.md`, never copied from the old Brain or bio; scored table goes in Decisions), `Differentiators`, `X-Oriented One-Liner`, `Safer Public One-Liner`, `Long-Term Positioning`, `Core Philosophy` · Content › `Recurring Series`, `Topics To Own` · Authority › `Proof Points` (only what public posts show).

## 3. Not the skill's to fill → owner question list

Name, Contact Url, Business Model, Industry (may propose), Metrics, Work History, Allowed Claims, Prohibited Claims, Email Tone, Email Instructions, Mission / Core Philosophy (may draft, owner confirms).
Other research (Market Signals / Lead Gen, not this skill): Discovery section, Opportunity section, Competitors, Adjacent Competitors, Thought Leaders.

## 4. Decided here but no Brain home → write into Strategy Document text

| Decision | Put it in |
|---|---|
| A bucket should run on its own account | Decisions (dated, with evidence) + Open questions (owner to decide) |
| Per-bucket quote-react watchlist (from model `quotedAuthor`) | Formats (top 10 handles per track); note that the quote scanner's watchlist (`xGrowth` priors) is set separately |
| Per-bucket type mix beyond postsPerDay | Track Targets row (stored) + Formats text (planner does not consume it) |
| Cadence tier + time budget + "hold 2 weeks before moving up" | Decisions |

## 5. Validate the draft (free, local)

Run from the repo root. `markdownToForm(md)` → `{fields, frontmatter}` (81 keys like `strategy.thesis`, `content.contentTracks`, `market.benchmarkAccounts`); `formToMarkdown(fields, {preserved: md})` edits `md` in place.

```bash
node -e '
const m = require("./features/client-brain/form-markdown.cjs");
const fs = require("fs");
const draft = fs.readFileSync(process.argv[1], "utf8");
const cur = fs.existsSync(process.argv[2]) ? fs.readFileSync(process.argv[2], "utf8") : "";
const d = m.markdownToForm(draft).fields;
console.log("draft self round-trip identical:", m.formToMarkdown(d, {preserved: draft}) === draft);
if (cur) { const c = m.markdownToForm(cur).fields;
  console.log("changed fields:", Object.keys(d).filter(k => JSON.stringify(d[k]) !== JSON.stringify(c[k]))); }
' <draft.md> <current CLIENT_BRAIN.md>
```

The changed-fields list must equal the fields the skill meant to fill. Also preview the sync read-only: `node scripts/client-brain/brain-sync-report.cjs <clientId>` (reads the live Brain, writes nothing). A draft is only ready when every `###` it touched parses into the expected field and no untouched section changed.
