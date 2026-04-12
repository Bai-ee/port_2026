# Firebase Setup

This project now includes:

- Firebase client initialization in `firebase.js`
- Auth state and Firestore profile sync in `AuthContext.jsx`
- Public auth page at `/login`
- Protected dashboard route at `/dashboard`
- Per-user Firestore documents at `users/{uid}`
- Server-side provisioning APIs under `api/`
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

## 4. Add local environment variables

Create `.env.local` in the project root:

```bash
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id

FIREBASE_ADMIN_PROJECT_ID=your_project_id
FIREBASE_ADMIN_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your_project_id.iam.gserviceaccount.com
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
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

## 7. Vercel setup

Add all `VITE_FIREBASE_*` variables and the three `FIREBASE_ADMIN_*` variables to Vercel before testing the API routes in production.

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
