# LEADGEN ONBOARD BUTTON — Master Implementation Prompt

> **Give this entire file to Claude Code.** It contains everything needed to implement the ONBOARD feature — exact file paths, function signatures, data shapes, UI placement, and wiring instructions.

---

## What We're Building

An **ONBOARD** button in the lead generation dashboard's expanded prospect row. When clicked, it runs four existing analysis modules against the prospect's website and pulls the results into the expanded row — giving the operator enough intelligence to decide whether to proceed with automated website generation for that prospect.

**The four modules to run (all already implemented):**

1. **Cross-Device Layouts** (`multi-device-view`) — Browserless screenshots at desktop/tablet/mobile + composited device mockup
2. **SEO + Performance Snapshot** (`seo-performance`) — PageSpeed Insights scores + SEO depth audit skill
3. **AI Agent Readiness** (`agent-readiness`) — 11-probe agent accessibility check + AI SEO visibility audit + Cloudflare bot intelligence
4. **Social Preview Check** (`social-preview`) — OG tags, Twitter cards, social meta extraction

**The ONBOARD button is only visible when the prospect has a website URL.** Prospects without `website` show no button.

---

## Existing Code You Must Read First

Before writing any code, read these files to understand the interfaces:

### Module Implementations (what ONBOARD invokes)
- `features/scout-intake/modules/multi-device-view.js` — `runMultiDeviceView({ clientId, runId, websiteUrl, onProgress })`
- `features/scout-intake/modules/seo-performance.js` — `runSeoPerformance({ clientId, runId, websiteUrl, onProgress })`
- `features/scout-intake/modules/agent-readiness.js` — `runAgentReadinessModule({ clientId, runId, websiteUrl, onProgress })`
- `features/scout-intake/modules/social-preview.js` — `runSocialPreview({ websiteUrl, onProgress })`

### Module Orchestrator (how modules get dispatched)
- `features/scout-intake/runner.js` — lines 944–1012 contain `MODULE_RUNNERS` dispatch table and `runModules()` function. This is the existing orchestration pattern. Your new API route should follow the same pattern.

### Module Registry (metadata about each module)
- `features/scout-intake/module-registry.js` — defines dependencies, tech stack, caching policies per module

### Shared Utilities (used by all modules)
- `features/scout-intake/modules/shared/site-fetch.js` — HTTP fetch + HTML parsing
- `features/scout-intake/modules/shared/screenshots.js` — Browserless screenshot capture
- `features/scout-intake/modules/shared/device-mockup.js` — Device frame compositing
- `features/scout-intake/modules/shared/pagespeed.js` — PageSpeed Insights wrapper
- `features/scout-intake/modules/shared/ai-seo.js` — AI SEO audit wrapper
- `features/scout-intake/modules/shared/site-meta.js` — OG/meta tag extraction

### Existing API Pattern (how the dashboard currently calls modules)
- `app/api/dashboard/modules/run/route.js` — POST handler that authenticates, resolves modules, calls `runModules()`, persists results. **Your new leadgen onboard route should mirror this pattern** but write to `leadgen_prospects/{placeId}` instead of `dashboard_state/{clientId}`.

### Lead Gen Dashboard (where the button goes)
- `components/dashboard/LeadGenDashboard.jsx` — the full dashboard component. The expanded row starts at line ~621 (`{isOpen ? (...)`). The ONBOARD button goes inside the expanded row's detail panel.

### Existing Prospect Schema
- `features/leadgen/prospector.js` — see the schema for `leadgen_prospects/{placeId}` documents

### Firestore Rules
- `firestore.rules` — lines 57-65 define read/write rules for `leadgen_prospects` and `leadgen_configs`

---

## Implementation Plan

### Step 1: New API Route — `/api/leadgen/onboard/route.js`

Create `app/api/leadgen/onboard/route.js`

```
POST /api/leadgen/onboard
Body: { placeId: string }
Auth: Bearer token (same pattern as /api/leadgen/discover)
```

**What it does:**

1. Authenticate the request (reuse auth pattern from `app/api/leadgen/discover/route.js`)
2. Read the prospect doc from `leadgen_prospects/{placeId}` — extract `website` URL
3. Validate that `website` exists and is non-empty. Return 400 if missing.
4. Generate a `runId` (crypto.randomUUID)
5. Set `prospect.stage = 'onboarding'` and `prospect.onboardStartedAt = new Date().toISOString()` in Firestore immediately (so the UI can show a loading state)
6. Run the four modules. Use the same parallel orchestration pattern as `runModules()` in runner.js. The modules to run are:

```js
const ONBOARD_MODULES = ['multi-device-view', 'seo-performance', 'agent-readiness', 'social-preview'];
```

Each module runner receives:
```js
{
  clientId: `leadgen_${placeId}`,   // namespace to avoid collision with real clients
  runId,
  websiteUrl: prospect.website,     // normalize with the same normalizeUrl() from runner.js
  onProgress: null                  // no streaming for V1 — can add later
}
```

7. Collect results from all four modules. Each returns `{ ok, cardId, status, result, warningCodes, artifacts }`.
8. Write the aggregated results to the prospect document:

```js
await updateDoc(doc(db, 'leadgen_prospects', placeId), {
  stage: 'audited',
  onboardCompletedAt: new Date().toISOString(),
  onboardRunId: runId,
  onboard: {
    multiDeviceView: {
      status: mdvResult.status,      // 'succeeded' | 'failed'
      mockupUrl: mdvResult.result?.mockupUrl || null,
      desktopUrl: mdvResult.result?.desktopUrl || null,
      tabletUrl: mdvResult.result?.tabletUrl || null,
      mobileUrl: mdvResult.result?.mobileUrl || null,
      artifacts: mdvResult.artifacts || [],
      warnings: mdvResult.warningCodes || [],
    },
    seoPerformance: {
      status: seoResult.status,
      pagespeed: seoResult.result?.pagespeed || null,    // { performance, accessibility, seo, bestPractices }
      skillOutput: seoResult.result?.skillOutput || null,
      skillDoc: seoResult.result?.skillDoc || null,
      warnings: seoResult.warningCodes || [],
    },
    agentReadiness: {
      status: arResult.status,
      score: arResult.result?.agentReadiness?.score ?? null,
      verdict: arResult.result?.agentReadiness?.verdict || null,
      dimensions: arResult.result?.agentReadiness?.dimensions || null,
      checks: arResult.result?.agentReadiness?.checks || [],
      findings: arResult.result?.agentReadiness?.findings || [],
      customFixes: arResult.result?.agentReadiness?.customFixes || [],
      warnings: arResult.warningCodes || [],
    },
    socialPreview: {
      status: spResult.status,
      siteMeta: spResult.result?.siteMeta || null,       // { ogTitle, ogDescription, ogImage, twitterCard, ... }
      warnings: spResult.warningCodes || [],
    },
  }
});
```

9. Return the full onboard result as JSON in the response.

**Timeout consideration:** This route runs 4 modules in parallel. Multi-device-view (Browserless screenshots) is the slowest — typically 20-40s. SEO performance with PageSpeed can take 15-30s. Agent readiness with AI SEO is 10-20s. Social preview is fast (2-5s). Running in parallel, worst case is ~45s which fits within Vercel's 60s function timeout on Pro. If you're concerned, use `maxDuration` export:

```js
export const maxDuration = 60; // seconds — Vercel Pro allows up to 300
```

### Step 2: Update Firestore Rules

Add write access for the `onboard` field. The existing rules at `firestore.rules` lines 57-65 should already allow admin SDK writes. If the route uses the admin SDK (which it should), no rule changes needed. Verify this.

### Step 3: UI — ONBOARD Button in Expanded Row

In `components/dashboard/LeadGenDashboard.jsx`, inside the expanded row section (the `{isOpen ? (...)` block starting around line 621):

**Add the ONBOARD button to the `leadgen-row-details-side` div**, after the existing meta cells and before the closing `</div>`:

```jsx
{/* ONBOARD button — only when prospect has a website and hasn't been onboarded yet */}
{p.website && !p.onboard ? (
  <button
    type="button"
    className="leadgen-btn leadgen-btn--primary leadgen-onboard-btn"
    disabled={onboardBusy[p.placeId]}
    onClick={(e) => {
      e.stopPropagation();
      handleOnboard(p.placeId);
    }}
  >
    {onboardBusy[p.placeId] ? (
      <>
        <Loader2 size={13} strokeWidth={2.4} className="leadgen-spin" />
        <span>Onboarding…</span>
      </>
    ) : (
      <>
        <Radar size={13} strokeWidth={2.4} />
        <span>ONBOARD</span>
      </>
    )}
  </button>
) : null}
```

**Add state for onboard busy tracking:**

```js
const [onboardBusy, setOnboardBusy] = useState({}); // { [placeId]: true }
```

**Add the handler:**

```js
async function handleOnboard(placeId) {
  setOnboardBusy((b) => ({ ...b, [placeId]: true }));
  try {
    const token = await getIdToken();
    const res = await fetch('/api/leadgen/onboard', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ placeId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('[leadgen] onboard failed:', data?.error || res.status);
      // Optionally show error in campaignNotice
    }
    // No need to manually update state — Firestore onSnapshot listener
    // will pick up the changes automatically and re-render the row.
  } catch (err) {
    console.error('[leadgen] onboard request failed:', err);
  } finally {
    setOnboardBusy((b) => {
      const next = { ...b };
      delete next[placeId];
      return next;
    });
  }
}
```

### Step 4: UI — Onboard Results Display in Expanded Row

When `p.onboard` exists on the prospect, render the onboard results inside the expanded row. Replace or augment the existing `leadgen-row-details-side` section.

**Add a new section below the existing score breakdown bars (the `leadgen-row-details-bars` div):**

```jsx
{p.onboard ? (
  <div className="leadgen-onboard-results">
    <h4 className="leadgen-onboard-results-title">Onboard Intelligence</h4>

    {/* ── Cross-Device Layouts ─────────────────────────── */}
    <div className="leadgen-onboard-module">
      <div className="leadgen-onboard-module-head">
        <span className={`leadgen-onboard-status leadgen-onboard-status--${p.onboard.multiDeviceView?.status || 'pending'}`} />
        <span className="leadgen-onboard-module-label">Cross-Device Layouts</span>
      </div>
      {p.onboard.multiDeviceView?.mockupUrl ? (
        <div className="leadgen-onboard-screenshots">
          <a href={p.onboard.multiDeviceView.mockupUrl} target="_blank" rel="noopener noreferrer">
            <img
              src={p.onboard.multiDeviceView.mockupUrl}
              alt={`${p.name} device mockup`}
              className="leadgen-onboard-mockup-img"
              loading="lazy"
            />
          </a>
          <div className="leadgen-onboard-screenshot-thumbs">
            {['desktopUrl', 'tabletUrl', 'mobileUrl'].map((key) => (
              p.onboard.multiDeviceView[key] ? (
                <a key={key} href={p.onboard.multiDeviceView[key]} target="_blank" rel="noopener noreferrer">
                  <img
                    src={p.onboard.multiDeviceView[key]}
                    alt={`${key.replace('Url', '')} screenshot`}
                    className="leadgen-onboard-thumb"
                    loading="lazy"
                  />
                </a>
              ) : null
            ))}
          </div>
        </div>
      ) : (
        <span className="leadgen-onboard-na">Screenshots unavailable</span>
      )}
    </div>

    {/* ── SEO + Performance ────────────────────────────── */}
    <div className="leadgen-onboard-module">
      <div className="leadgen-onboard-module-head">
        <span className={`leadgen-onboard-status leadgen-onboard-status--${p.onboard.seoPerformance?.status || 'pending'}`} />
        <span className="leadgen-onboard-module-label">SEO + Performance</span>
      </div>
      {p.onboard.seoPerformance?.pagespeed ? (
        <div className="leadgen-onboard-psi">
          {['performance', 'accessibility', 'seo', 'bestPractices'].map((metric) => {
            const val = p.onboard.seoPerformance.pagespeed[metric];
            const color = val >= 90 ? '#0cce6b' : val >= 50 ? '#ffa400' : '#ff4e42';
            return (
              <div key={metric} className="leadgen-onboard-psi-metric">
                <span className="leadgen-onboard-psi-val" style={{ color }}>{val ?? '—'}</span>
                <span className="leadgen-onboard-psi-label">{metric}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <span className="leadgen-onboard-na">PageSpeed data unavailable</span>
      )}
    </div>

    {/* ── AI Agent Readiness ───────────────────────────── */}
    <div className="leadgen-onboard-module">
      <div className="leadgen-onboard-module-head">
        <span className={`leadgen-onboard-status leadgen-onboard-status--${p.onboard.agentReadiness?.status || 'pending'}`} />
        <span className="leadgen-onboard-module-label">AI Agent Readiness</span>
      </div>
      {p.onboard.agentReadiness?.score != null ? (
        <div className="leadgen-onboard-agent">
          <div className="leadgen-onboard-agent-score">
            <span className="leadgen-onboard-agent-score-val">{p.onboard.agentReadiness.score}</span>
            <span className="leadgen-onboard-agent-score-label">/100</span>
          </div>
          <span className="leadgen-onboard-agent-verdict">{p.onboard.agentReadiness.verdict}</span>
          {Array.isArray(p.onboard.agentReadiness.findings) && p.onboard.agentReadiness.findings.length > 0 ? (
            <ul className="leadgen-onboard-agent-findings">
              {p.onboard.agentReadiness.findings.slice(0, 5).map((f, i) => (
                <li key={i}>{typeof f === 'string' ? f : f.message || f.id}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <span className="leadgen-onboard-na">Agent readiness data unavailable</span>
      )}
    </div>

    {/* ── Social Preview ───────────────────────────────── */}
    <div className="leadgen-onboard-module">
      <div className="leadgen-onboard-module-head">
        <span className={`leadgen-onboard-status leadgen-onboard-status--${p.onboard.socialPreview?.status || 'pending'}`} />
        <span className="leadgen-onboard-module-label">Social Preview</span>
      </div>
      {p.onboard.socialPreview?.siteMeta ? (
        <div className="leadgen-onboard-social">
          {p.onboard.socialPreview.siteMeta.ogImage ? (
            <img
              src={p.onboard.socialPreview.siteMeta.ogImage}
              alt="OG image preview"
              className="leadgen-onboard-og-img"
              loading="lazy"
            />
          ) : (
            <span className="leadgen-onboard-social-missing">No OG image</span>
          )}
          <div className="leadgen-onboard-social-meta">
            <div className="leadgen-onboard-social-meta-row">
              <span className="leadgen-onboard-social-key">Title</span>
              <span className="leadgen-onboard-social-val">
                {p.onboard.socialPreview.siteMeta.ogTitle || '—'}
              </span>
            </div>
            <div className="leadgen-onboard-social-meta-row">
              <span className="leadgen-onboard-social-key">Description</span>
              <span className="leadgen-onboard-social-val">
                {p.onboard.socialPreview.siteMeta.ogDescription || '—'}
              </span>
            </div>
            <div className="leadgen-onboard-social-meta-row">
              <span className="leadgen-onboard-social-key">Twitter Card</span>
              <span className="leadgen-onboard-social-val">
                {p.onboard.socialPreview.siteMeta.twitterCard || 'none'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <span className="leadgen-onboard-na">No social meta found</span>
      )}
    </div>
  </div>
) : null}
```

### Step 5: CSS for Onboard Results

Add styles inside the existing `<style jsx>` block in `LeadGenDashboard.jsx`. Follow the existing visual language — mono numerics, glass surface, sharp grid, minimal color.

Key classes to style:
```
.leadgen-onboard-btn          — same as leadgen-btn--primary but slightly larger
.leadgen-onboard-results      — container for all onboard module results
.leadgen-onboard-module       — individual module card within results
.leadgen-onboard-module-head  — module header with status dot + label
.leadgen-onboard-status       — colored dot (green for succeeded, red for failed, grey for pending)
.leadgen-onboard-screenshots  — mockup image + thumbnail strip
.leadgen-onboard-mockup-img   — main device mockup image (max-width: 100%, rounded)
.leadgen-onboard-thumb        — small screenshot thumbnails
.leadgen-onboard-psi          — 4-metric PageSpeed grid
.leadgen-onboard-psi-metric   — individual metric with colored value
.leadgen-onboard-agent        — agent readiness section
.leadgen-onboard-agent-findings — findings list
.leadgen-onboard-social       — social preview section with OG image + meta table
.leadgen-onboard-na           — "unavailable" fallback text
```

Visual approach for the onboard results:
- Use a 2-column grid for the 4 modules on desktop (2×2), stack to single column on mobile
- Each module card has a subtle border-bottom separator
- Status dot: `#0cce6b` (succeeded), `#ff4e42` (failed), `#666` (pending)
- Mockup image should be the visual hero of the section — make it prominent
- PageSpeed scores use the standard Lighthouse color coding: green ≥90, orange ≥50, red <50
- Keep the same font-family, color palette, and spacing as the existing dashboard

### Step 6: Update Pipeline Stage Constants

In `features/leadgen/constants.js`, add `'onboarding'` to `PIPELINE_STAGES` if it's not already there. This is the transitional stage while the onboard modules are running:

```js
// Add between 'scored' and 'audited' if needed:
'discovered', 'scored', 'onboarding', 'audited', 'ready', 'contacted'
```

Also update `STAGE_LABELS` in `LeadGenDashboard.jsx` to include:
```js
onboarding: 'Onboarding',
```

And add it to `VISIBLE_STAGES` if you want the stats bar to show the count.

### Step 7: Re-onboard Capability

If a prospect already has `p.onboard` data, show a "Re-onboard" button instead of "ONBOARD". This allows re-running the modules if something failed or if the prospect's website has changed. The handler is identical — it just overwrites the existing `onboard` field.

```jsx
{p.website ? (
  <button ...>
    {p.onboard ? 'RE-ONBOARD' : 'ONBOARD'}
  </button>
) : null}
```

---

## Data Flow Summary

```
User clicks ONBOARD on expanded row for prospect "Garcia & Associates"
  │
  ├─ UI sets onboardBusy[placeId] = true, shows spinner
  │
  ├─ POST /api/leadgen/onboard { placeId: "ChIJ..." }
  │    │
  │    ├─ Read prospect from Firestore → extract website URL
  │    ├─ Set stage = 'onboarding' in Firestore (UI updates via onSnapshot)
  │    │
  │    ├─ Promise.all([
  │    │    runMultiDeviceView({ clientId: 'leadgen_ChIJ...', websiteUrl, runId }),
  │    │    runSeoPerformance({ clientId: 'leadgen_ChIJ...', websiteUrl, runId }),
  │    │    runAgentReadinessModule({ clientId: 'leadgen_ChIJ...', websiteUrl, runId }),
  │    │    runSocialPreview({ websiteUrl }),
  │    │  ])
  │    │
  │    ├─ Write results to leadgen_prospects/{placeId}.onboard
  │    ├─ Set stage = 'audited'
  │    └─ Return 200 with results
  │
  ├─ Firestore onSnapshot fires → UI re-renders with onboard data
  ├─ UI clears onboardBusy[placeId]
  │
  └─ Expanded row now shows:
       ├─ Device mockup + desktop/tablet/mobile screenshots
       ├─ PageSpeed scores (performance, accessibility, SEO, best practices)
       ├─ AI Agent Readiness score + verdict + findings
       └─ Social preview (OG image, title, description, Twitter card)
```

---

## Environment Variables Required

These should already be in your `.env` / Vercel env from the existing pipeline:

- `BROWSERLESS_TOKEN` — for screenshot capture (multi-device-view)
- `ANTHROPIC_API_KEY` — for SEO depth audit skill + AI SEO audit
- `PAGESPEED_API_KEY` — for PageSpeed Insights (optional, works without key at lower rate limits)

No new environment variables needed.

---

## Testing Checklist

1. **Happy path:** Find a scored prospect with a website → click ONBOARD → verify all 4 modules return data → verify expanded row renders mockup, PSI scores, agent readiness score, social meta
2. **No website:** Verify ONBOARD button is hidden for prospects without a website URL
3. **Module failure:** Test with a website that returns 404 → verify graceful degradation (status: 'failed' per module, not a full crash)
4. **Re-onboard:** Click ONBOARD on an already-onboarded prospect → verify data refreshes
5. **Timeout:** Test with a very slow website → verify the route returns before Vercel timeout (check maxDuration)
6. **Firestore sync:** Verify that the dashboard updates in real-time via onSnapshot (no manual refresh needed)
7. **Stage transition:** Verify prospect moves from 'scored' → 'onboarding' → 'audited' and stats bar updates

---

## What NOT to Build (Scope Boundaries)

- **No cron automation.** ONBOARD is manual, clicked by the operator per-prospect.
- **No preview site generation.** That's a separate future step. ONBOARD just gathers intelligence.
- **No outreach generation.** That's also a separate future step.
- **No progress streaming.** V1 uses a simple spinner. Progress events via onProgress can be added later for real-time stage updates in the terminal.
- **No new Firestore collections.** Everything writes to the existing `leadgen_prospects/{placeId}` document under the `onboard` sub-object.
