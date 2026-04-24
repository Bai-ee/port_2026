# Firebase Setup

This project now includes:

- Firebase client initialization in `firebase.js`
- Auth state and Firestore profile sync in `AuthContext.jsx`
- Public auth page at `/login`
- Protected dashboard route at `/dashboard`
- Per-user Firestore documents at `users/{uid}`
- Server-side provisioning APIs under `app/api/`
- Multi-tenant client records under `clients/{clientId}`
- Queued initial brief runs under `brief_runs/{runId}`

## 1. Create the Firebase project

In Firebase Console:

1. Create a project
2. Add a Web App
3. Copy the Web App config values

## 2. Enable Authentication

In `Authentication > Sign-in method`:

1. Enable `Email/Password`

## 3. Create Firestore

In `Firestore Database`:

1. Create database
2. Start in production or test mode
3. After creation, apply the rules from `firestore.rules`
4. Create composite indexes (required — queries will return 500 without them):

   - Collection: `brief_runs` | Fields: `status ASC, createdAt ASC`
     (used by worker `findNextQueuedRun`)
   - Collection: `brief_runs` | Fields: `status ASC, createdAt DESC`
     (used by admin brief-run listing)

   Create via Firebase Console → Firestore → Indexes → Add Index, or deploy with:
   ```
   firebase deploy --only firestore:indexes
   ```
   (uses `firestore.indexes.json` in the repo root)

## 4. Add local environment variables

Create `.env.local` in the project root:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=your_measurement_id

FIREBASE_ADMIN_PROJECT_ID=your_project_id
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your_project_id.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_ADMIN_STORAGE_BUCKET=your_project.firebasestorage.app

# Worker auth — required for automated worker invocations
WORKER_SECRET=your_worker_secret_here

# Intake artifact capture
BROWSERLESS_TOKEN=your_browserless_token_here
BROWSERLESS_BASE_URL=https://production-sfo.browserless.io

# LLM-backed intake stages
ANTHROPIC_API_KEY=your_anthropic_api_key_here
KIMI_API_KEY=your_kimi_api_key_here

# PageSpeed + analyzer skills
PAGESPEED_API_KEY=your_pagespeed_api_key_here
PAGESPEED_ENABLED=1
SCOUT_ANALYZER_SKILLS_ENABLED=1

# Optional external scout providers
NWS_USER_AGENT=YourApp/1.0 (your-email@example.com)
INSTAGRAM_ACCESS_TOKEN=your_meta_graph_access_token_here
NOT_THE_RUG_INSTAGRAM_USER_ID=your_instagram_business_account_id_here
REDDIT_CLIENT_ID=your_reddit_app_client_id_here
REDDIT_CLIENT_SECRET=your_reddit_app_client_secret_here
REDDIT_USER_AGENT=YourApp/1.0 (your-email@example.com)
```

You can also start from `.env.example`.

### Environment and Feature-Flag Matrix

| Name | Required | Default / fallback | Used by | Effect when missing / off |
|---|---|---|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | Yes | none | client auth + browser SDK | app cannot connect to Firebase from the browser |
| `FIREBASE_ADMIN_PROJECT_ID` | Yes | none | Admin SDK | server routes fail on first Admin SDK access |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Yes | none | Admin SDK | server routes fail on first Admin SDK access |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Yes | none | Admin SDK | server routes fail on first Admin SDK access |
| `FIREBASE_ADMIN_STORAGE_BUCKET` | Recommended | falls back to `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Storage artifact writers | artifact writes may target the wrong bucket if the public bucket var is absent or wrong |
| `WORKER_SECRET` | Yes for automatic pipeline triggers | none | `/api/worker/run-brief`, `/api/intelligence/run` | signup/reseed fanout requests return `401`; manual admin-token calls still work |
| `BROWSERLESS_TOKEN` | Recommended | none | screenshot + PDF artifact generation | screenshot and PDF artifact stages are skipped / warn non-fatally |
| `BROWSERLESS_BASE_URL` | Optional | Browserless production endpoint | Browserless client | only needed for a custom Browserless host |
| `ANTHROPIC_API_KEY` | Yes for free-tier intake | none | synth, style guide summary, scout-config, scribe, skills | AI-backed stages fail or degrade; pipeline still tries to complete with warnings |
| `KIMI_API_KEY` | Optional | none | skill LLM fallback | fallback path is unavailable when Anthropic credit errors occur |
| `PAGESPEED_API_KEY` | Recommended | none | PSI stage | PSI stage is skipped in the intake runner; direct PSI module can still hit the anonymous pool but is rate-limited |
| `PAGESPEED_ENABLED` | Optional | on unless set to `0` | intake PSI stage | set to `0` to force-skip PSI even if the key exists |
| `SCOUT_ANALYZER_SKILLS_ENABLED` | Optional | off when unset | analyzer skill fanout | no `analyzerOutputs` are produced; cards fall back to legacy analyzer + static/scribe behavior |
| `NWS_USER_AGENT` | Optional | none | weather scout | weather scout may not run correctly when enabled later |
| `INSTAGRAM_ACCESS_TOKEN` | Optional | none | Instagram scout | Instagram scout is not runnable |
| `NOT_THE_RUG_INSTAGRAM_USER_ID` | Optional | none | Instagram scout | Instagram scout is not runnable |
| `REDDIT_CLIENT_ID` | Optional | none | legacy Reddit OAuth scout | OAuth-based Reddit scout is not runnable; credential-free web-search path can still be used separately |
| `REDDIT_CLIENT_SECRET` | Optional | none | legacy Reddit OAuth scout | same as above |
| `REDDIT_USER_AGENT` | Optional | none | legacy Reddit OAuth scout | same as above |

## 5. What the app writes

On provision, bootstrap, intake runs, reseeds, and intelligence refreshes, the app writes to these Firestore paths:

| Path | Primary writer(s) | Purpose |
|---|---|---|
| `users/{uid}` | `AuthContext.jsx`, `api/_lib/client-provisioning.cjs` | user profile, auth-linked client binding |
| `clients/{clientId}` | `api/_lib/client-provisioning.cjs`, `api/_lib/run-lifecycle.cjs` | top-level client record and current run status |
| `clients/{clientId}/members/{uid}` | `api/_lib/client-provisioning.cjs` | membership / role record |
| `clients/{clientId}/system/onboarding` | `api/_lib/client-provisioning.cjs` | onboarding state and original intake request |
| `client_configs/{clientId}` | `api/_lib/client-provisioning.cjs`, `features/scout-intake/scout-config-store.js`, `features/scout-intake/external-scouts-store.js` | source inputs, onboarding answers, scout config, scout cache |
| `dashboard_state/{clientId}` | `api/_lib/client-provisioning.cjs`, `api/_lib/run-lifecycle.cjs` | dashboard bootstrap projection rendered by the UI |
| `brief_runs/{runId}` | `api/_lib/client-provisioning.cjs`, `api/_lib/run-lifecycle.cjs` | global admin-visible run queue + lifecycle state |
| `clients/{clientId}/brief_runs/{runId}` | `api/_lib/client-provisioning.cjs`, `api/_lib/run-lifecycle.cjs` | client-scoped mirror of run state |
| `clients/{clientId}/brief_runs/{runId}/events/{eventId}` | `api/_lib/run-lifecycle.cjs` | terminal/progress stream for the dashboard |
| `clients/{clientId}/intelligence/master` | `features/intelligence/_store.js` | intelligence digest, ledger, source settings, pipeline injection flag |
| `clients/{clientId}/intelligence/master/sources/{sourceId}` | `features/intelligence/_store.js`, `api/_lib/intelligence-runner.cjs` | canonical source records such as PSI |
| `clients/{clientId}/intelligence/master/events/{eventId}` | `features/intelligence/_store.js`, `app/api/dashboard/reseed-intake/route.js` | intelligence fetch ledger + trigger error events |

Notes:
- `dashboard_state` is still the dashboard projection layer; it is not the canonical store for external intelligence.
- intelligence source docs and events are nested under the `master` document, not sibling collections under `intelligence/`.
- external scout outputs are cached inside `client_configs/{clientId}.scoutCache`, not in a separate top-level collection.

Example shape:

```json
{
  "uid": "firebase-auth-uid",
  "email": "client@example.com",
  "displayName": "Client Name",
  "clientId": "client-slug-1234abcd",
  "role": "owner",
  "dashboardTitle": "Acme Dashboard",
  "dashboardDescription": "Initial discovery and dashboard setup is in progress.",
  "websiteUrl": "https://acme.com",
  "onboardingStatus": "brief_queued",
  "createdAt": "server timestamp",
  "lastLoginAt": "server timestamp",
  "updatedAt": "server timestamp"
}
```

Example `clients/{clientId}` shape:

```json
{
  "clientId": "acme-1234abcd",
  "companyName": "Acme",
  "websiteUrl": "https://acme.com",
  "normalizedHost": "acme.com",
  "dashboardTitle": "Acme Dashboard",
  "dashboardDescription": "Initial discovery and dashboard setup for acme.com is in progress.",
  "status": "provisioning",
  "onboardingStatus": "brief_queued",
  "ownerUid": "firebase-auth-uid",
  "latestRunId": "run-id",
  "latestRunStatus": "queued",
  "createdAt": "server timestamp",
  "updatedAt": "server timestamp"
}
```

## 6. Routes

- `/` public homepage
- `/login` auth page
- `/dashboard` protected dashboard
- `/api/clients/provision` authenticated provisioning endpoint
- `/api/dashboard/bootstrap` authenticated dashboard bootstrap endpoint
- `/api/admin/brief-runs` admin-only queue inspection endpoint
- `/api/admin/clients` admin-only client list endpoint
- `/api/admin/requeue` admin-only run requeue endpoint
- `/api/admin/client-configs` admin-only client config inspection endpoint
- `/api/worker/run-brief` worker endpoint — requires `WORKER_SECRET` header or admin token

## 7. Vercel setup

1. Add all env vars to Vercel project settings (Settings → Environment Variables):
   - All 7 `NEXT_PUBLIC_FIREBASE_*` client vars
   - `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`, `FIREBASE_ADMIN_STORAGE_BUCKET`
   - `WORKER_SECRET` (generate a strong random string, e.g. `openssl rand -hex 32`)
   - `BROWSERLESS_TOKEN` and optional `BROWSERLESS_BASE_URL` if you want screenshot / PDF artifacts
   - `ANTHROPIC_API_KEY` (required for synth / scribe / scout-config / skills)
   - `KIMI_API_KEY` if you want the LLM fallback path
   - `PAGESPEED_API_KEY` and optional `PAGESPEED_ENABLED`
   - `SCOUT_ANALYZER_SKILLS_ENABLED=1` if you want analyzer skill output active in that environment
   - Scout-specific vars if using the external scout paths: `INSTAGRAM_ACCESS_TOKEN`, `NOT_THE_RUG_INSTAGRAM_USER_ID`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`, `NWS_USER_AGENT`

2. **Plan requirement**: `/api/worker/run-brief` sets `maxDuration = 300` (5 minutes). This requires Vercel **Pro or Enterprise** plan. On the Hobby plan, the function is killed at 60 seconds — the pipeline will not complete.

## 8. Admin whitelist

To allow an email address to access `/api/admin/brief-runs`, create:

- `admins/{email}`

Example document:

```json
{
  "active": true,
  "createdAt": "server timestamp"
}
```
