# Agent Readiness — Implementation Plan (for Sonnet)

**Status:** Approved plan. Execute phases in the order listed. **Stop after each phase for review.**

This plan integrates an isitagentready.com-style audit into the existing `seo-performance` module. It does **not** add a new card. All output renders inside the existing **Data tab** of the SEO Snapshot card.

---

## Operating rules (read first)

1. Work in **explicit phases**. After each phase, stop and wait for approval.
2. Do **not** broaden scope. Only edit files listed in the current phase.
3. Do **not** introduce new libraries. Use built-in `fetch`, existing helpers.
4. Preserve desktop behavior. No CSS changes outside the mini-brief renderer.
5. Do **not** touch blockchain logic, auth, or unrelated module code.
6. New DOM ids must follow repo convention (kebab-case, descriptive, not generic).
7. After each edit, report:
   - Files changed
   - Exact behavior changed
   - What stayed untouched
   - Verification run (tests / manual)
   - Risks / not verified

---

## Source-of-truth references (do not re-derive)

- Module pattern → `features/scout-intake/modules/seo-performance.js`
- Module registry → `features/scout-intake/module-registry.js`
- Mini-brief data adapter (Data tab) → `features/scout-intake/mini-briefs/seo-performance-adapter.mjs`
- Mini-brief renderer → `features/scout-intake/mini-brief-renderer.mjs`
- Data tab host → `components/dashboard/TileDetailAnalysisContent.jsx` (line 121, `seoMiniBriefHtml` iframe)
- Module run lifecycle → `app/api/dashboard/modules/run/route.js`
- Persisted state shape → `dashboard_state.seoAudit`, `analyzerOutputs['seo-performance'].skills`
- Skill aggregator → `features/scout-intake/skills/_aggregator.js`
- Existing tests dir → `features/scout-intake/__tests__/`

---

## Dimension spec (mirrors isitagentready.com)

Each check returns:
```js
{
  id: 'string-kebab',          // unique check id
  dimension: 'discoverability' | 'accessibility' | 'botAccess' | 'capabilities',
  status: 'pass' | 'fail' | 'warn' | 'na',
  weight: number,              // contribution to dimension score
  evidence: { ... },           // raw signal observed (status code, header value, file body excerpt)
  fixId: 'string-kebab' | null // key into fix-library; null if pass or no fix
}
```

| Dimension | Checks |
|---|---|
| **discoverability** | `robots-txt-present`, `robots-txt-parseable`, `sitemap-xml-reachable`, `link-header-sitemap` (RFC 8288), `api-catalog-wellknown` (RFC 9727 at `/.well-known/api-catalog`) |
| **accessibility** | `llms-txt-present` (root `/llms.txt`), `markdown-content-negotiation` (GET `/` with `Accept: text/markdown` returns markdown), `structured-data-present` (any JSON-LD on homepage) |
| **botAccess** | `robots-content-signal` (parses `Content-Signal:` directives in robots.txt), `web-bot-auth-supported` (server accepts/responds to `Signature-Agent` per HTTP Message Signatures) |
| **capabilities** | `mcp-discovery` (`/.well-known/mcp.json` reachable + valid JSON), `agent-skills-manifest` (`/.well-known/agent-skills.json` or referenced from mcp.json), `x402-payment-supported` (server returns `402` with `WWW-Authenticate: x402` on a probe), `oauth-discovery` (RFC 9728 at `/.well-known/oauth-authorization-server`) |

**Scoring:** each dimension = weighted sum of its passing checks ÷ total weight × 100. Overall score = simple average of the four dimensions, rounded.

**Verdict thresholds:**
- ≥ 80 → `Agent-ready`
- 50–79 → `Partially ready`
- < 50 → `Not agent-ready`

---

## Phase 1 — Check library (pure, testable, no Firestore, no UI)

**Goal:** stand up the engine. No integration yet.

**Create:**
- `features/scout-intake/agent-ready/index.js` — exports `runAgentReady({ websiteUrl, evidence })` → returns:
  ```js
  {
    ok: true,
    score: 72,
    dimensions: { discoverability: 90, accessibility: 50, botAccess: 75, capabilities: 60 },
    verdict: 'Partially ready',
    checks: [ /* per-check results */ ],
    findings: [ /* mapped to existing severity scale: critical|warning|info */ ],
    highlights: [ /* 1–3 short summary strings */ ]
  }
  ```
- `features/scout-intake/agent-ready/checks/discoverability.js`
- `features/scout-intake/agent-ready/checks/accessibility.js`
- `features/scout-intake/agent-ready/checks/bot-access.js`
- `features/scout-intake/agent-ready/checks/capabilities.js`
- `features/scout-intake/agent-ready/scoring.js` — pure functions: `scoreDimension(checks)`, `overallScore(dimensions)`, `verdictFor(score)`.
- `features/scout-intake/agent-ready/fix-library.js` — static map keyed by `fixId`:
  ```js
  {
    'add-llms-txt': {
      title: 'Add /llms.txt at site root',
      why:   'AI agents look for /llms.txt as a curated reading list.',
      prompt: 'Copy-paste into Cursor/Claude Code prompt string…',
      snippet: '# llms.txt\n# ...file body to drop in...'
    },
    // ...one entry per check that can fail
  }
  ```
- `features/scout-intake/__tests__/agent-ready.test.js` — fixtures for each check (pass + fail). Use the existing test runner (check `package.json` scripts for the project's runner — match what other tests in `features/scout-intake/__tests__/` use; do not introduce a new framework).

**Implementation notes:**
- All HTTP probes via `fetch`, with `AbortController` timeout of 5s per request.
- Run all probes in parallel via `Promise.all`.
- Reuse passed-in `evidence` (from `runSiteFetch`) when it already contains robots/sitemap/headers. Only refetch what's missing.
- Network failures → `status: 'na'`, not `'fail'`. Only mark `'fail'` when the probe completed and the signal was absent/wrong.
- Do **not** import any Firestore code in this phase.

**Verification:**
- `node --test features/scout-intake/__tests__/agent-ready.test.js` (or whatever the repo uses) passes.
- Add a tiny script-style check in the test file: feed in a fixture site that passes everything → score = 100; one that fails everything → score = 0.

**Stop. Report. Wait for approval.**

---

## Phase 2 — Mini-brief renderer: add `code-block` section type

**Goal:** give the renderer a way to display copy-paste fix prompts.

**Edit:** `features/scout-intake/mini-brief-renderer.mjs`

- Add a new section handler for `type: 'code-block'`:
  - Renders `<pre><code>{body}</code></pre>` inside a styled container.
  - Adds a "Copy" button (inline `<script>` already runs in the iframe; reuse the same pattern as any other interactive section if one exists, otherwise add a minimal inline script that uses `navigator.clipboard.writeText`).
  - Section accepts: `{ type: 'code-block', eyebrow, title, body, language? }`.
- Style: monospace, dark background, top-right Copy button. Match the existing visual rhythm — do not introduce a new color palette.

**Verification:**
- Render a fixture sections array containing one `code-block` and confirm the HTML output via a small unit test or by writing the HTML to a temp file and opening it.

**Stop. Report. Wait for approval.**

---

## Phase 3 — Wire engine into `seo-performance` module

**Goal:** persist agent-readiness output alongside existing skills.

**Edit:** `features/scout-intake/modules/seo-performance.js`

- After the existing `Promise.all([runPagespeed(...), runAiSeo(...)])` block, add a third parallel call:
  ```js
  const agentReadyResult = await runAgentReady({ websiteUrl, evidence });
  ```
  (Or add to the same `Promise.all` for true parallelism — preferred.)
- Persist the result so the aggregator picks it up. Place it under:
  ```
  analyzerOutputs['seo-performance'].skills['agent-readiness'] = {
    score, dimensions, verdict, checks, findings, highlights
  }
  ```
  Match the exact shape the existing aggregator + adapter consume (see `_aggregator.js` and `seo-performance-adapter.mjs:53` where it reads `.skills['ai-seo-audit']`).
- On agent-ready failure: push to `warningCodes`, do **not** fail the module (parity with `runAiSeo` behavior).
- Emit a progress event between PSI and skill stages: `await emit('agent-ready', 'Probe agent-readiness signals…');`

**Do not change:** PSI logic, AI SEO logic, skill-doc renderer, error paths.

**Verification:**
- Trigger a module run via `app/api/dashboard/modules/run/route.js` for a real client and confirm the new skill block appears in `dashboard_state.analyzerOutputs['seo-performance'].skills['agent-readiness']`.
- Confirm warning codes propagate when agent-ready fails (test by mocking websiteUrl to an unreachable host).

**Stop. Report. Wait for approval.**

---

## Phase 4 — Surface in Data tab adapter

**Goal:** render the new sections inside the existing SEO Snapshot mini-brief.

**Edit:** `features/scout-intake/mini-briefs/seo-performance-adapter.mjs`

After the existing AI Visibility prose block (around line 179), append:

1. **Score block** — overall + per-dimension tiles:
   ```js
   sections.push({
     type: 'score-block',
     eyebrow: 'Agent Readiness · Overall',
     scores: [
       { label: 'Agent Readiness', value: ar.score, status: scoreStatus(ar.score) },
       { label: 'Discoverability', value: ar.dimensions.discoverability, status: scoreStatus(ar.dimensions.discoverability) },
       { label: 'Accessibility',   value: ar.dimensions.accessibility,   status: scoreStatus(ar.dimensions.accessibility) },
       { label: 'Bot Access',      value: ar.dimensions.botAccess,       status: scoreStatus(ar.dimensions.botAccess) },
       { label: 'Capabilities',    value: ar.dimensions.capabilities,    status: scoreStatus(ar.dimensions.capabilities) },
     ],
   });
   ```

2. **Readiness block** — verdict pill mirroring existing readiness section:
   ```js
   sections.push({
     type: 'readiness',
     label: ar.verdict.toUpperCase(),
     verdict: verdictFrom(ar.verdict),
     title: ar.verdict,
     description: ar.highlights?.[0],
   });
   ```

3. **Finding list** — per failed check, mapped through the existing `mapFindings()`:
   ```js
   sections.push({
     type: 'finding-list',
     eyebrow: 'Agent Readiness · Failed Checks',
     title: `${failed.length} agent-readiness gap${failed.length !== 1 ? 's' : ''}`,
     items: failed.map(c => ({
       severity: c.weight >= 3 ? 'high' : c.weight >= 2 ? 'medium' : 'low',
       text: fixLibrary[c.fixId]?.title || c.id,
       detail: fixLibrary[c.fixId]?.why,
     })),
   });
   ```

4. **Code-block per failed check** — copy-paste fix prompt:
   ```js
   for (const c of failed) {
     const fix = fixLibrary[c.fixId];
     if (!fix) continue;
     sections.push({
       type: 'code-block',
       eyebrow: `Fix · ${fix.title}`,
       title: 'Copy into Cursor or Claude Code',
       body: fix.prompt,
     });
   }
   ```

**Import the static fix library at top of the adapter** (the adapter is `.mjs`, the library should be `.mjs` too — convert if needed in Phase 1, or re-export). Do **not** import Node-only modules into the adapter; it must stay browser-safe because it runs inside `TileDetailAnalysisContent.jsx`.

**Read** the agent-ready block as:
```js
const agentReady = seoCard?.skills?.['agent-readiness'] || null;
```
Skip all four sections if `agentReady` is null. Add to the `hasData` check so an agent-ready-only run still reports `status: 'ready'`.

**Do not edit:** `TileDetailAnalysisContent.jsx`. The iframe already re-renders when `analyzerOutputs` changes.

**Verification:**
- Open the SEO Snapshot card → Data tab in a running dashboard. Confirm new sections render at the bottom. Confirm Copy buttons work in the iframe.

**Stop. Report. Wait for approval.**

---

## Phase 5 — Card label + onboarding copy

**Goal:** reflect the expanded scope in the registry and static copy.

**Edit:**
- `features/scout-intake/module-registry.js` — change `seo-performance.label` to `'SEO + Agent Readiness Snapshot'`. Append `'agent-readiness'` to its `dependencies` array. Append `'agent-ready-checks'` to `tech` array.
- `features/scout-intake/card-static-copy.js` — update the description string for `seo-performance` to mention agent readiness in one short sentence.

**Search for any other UI strings** that hardcode the old card label and update them. Use grep:
```
grep -rn "SEO + Performance Snapshot\|SEO Performance Snapshot" --include="*.js" --include="*.jsx" --include="*.mjs" .
```

**Verification:**
- Card title updates everywhere. No broken imports.

**Stop. Report. Wait for approval.**

---

## Phase 6 (OPTIONAL — defer until prior phases approved) — Public scan endpoint

**Goal:** allow scanning *any* URL outside a logged-in client context.

**Create:** `app/api/intelligence/agent-ready/route.js`

- POST `{ url }` → returns the same payload as `runAgentReady`.
- No auth required (or gated behind admin — confirm with user before building).
- Reuse `runAgentReady` from `features/scout-intake/agent-ready/index.js` directly. No Firestore writes.
- `maxDuration = 30`.

**Stop and confirm with user before starting Phase 6.**

---

## Out of scope (do not implement)

- New dashboard card or new tab.
- Cloudflare MCP `scan_site` cross-check (Phase 7, future).
- LLM-generated custom fix prompts (Phase 8, future). v1 uses the static fix-library only.
- Any change to the design-evaluation, social-preview, multi-device, or style-guide modules.
- Any change to authentication, billing, or worker code.

---

## Final checklist before declaring done

- [ ] Phase 1 tests pass.
- [ ] Phase 2 renderer handles `code-block` with working Copy button.
- [ ] Phase 3 module persists `skills['agent-readiness']` shape correctly.
- [ ] Phase 4 Data tab shows score block, readiness pill, failed checks, and one code-block per failed check.
- [ ] Phase 5 label updated in registry and any UI string that referenced the old name.
- [ ] No regressions in PSI scores, AI Visibility, or existing readiness verdict on a clean re-run.
- [ ] No new dependencies in `package.json`.
- [ ] No edits to files outside the lists above.
