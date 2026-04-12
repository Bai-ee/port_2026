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

# Worker auth — required for automated worker invocations
WORKER_SECRET=your_worker_secret_here
```

You can also start from `.env.example`.

## 5. What the app writes

On sign up or sign in, the app creates or updates:

- `users/{uid}`
- `clients/{clientId}`
- `clients/{clientId}/members/{uid}`
- `brief_runs/{runId}`
- `clients/{clientId}/brief_runs/{runId}`

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
   - `FIREBASE_ADMIN_PROJECT_ID`, `FIREBASE_ADMIN_CLIENT_EMAIL`, `FIREBASE_ADMIN_PRIVATE_KEY`
   - `WORKER_SECRET` (generate a strong random string, e.g. `openssl rand -hex 32`)
   - `ANTHROPIC_API_KEY` (required for worker pipeline execution)
   - Scout-specific vars if using the Not The Rug pipeline: `INSTAGRAM_ACCESS_TOKEN`, `NOT_THE_RUG_INSTAGRAM_USER_ID`, `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USER_AGENT`, `NWS_USER_AGENT`

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
