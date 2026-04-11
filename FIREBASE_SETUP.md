# Firebase Setup

This project now includes:

- Firebase client initialization in `firebase.js`
- Auth state and Firestore profile sync in `AuthContext.jsx`
- Public auth page at `/login`
- Protected dashboard route at `/dashboard`
- Per-user Firestore documents at `users/{uid}`

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
```

You can also start from `.env.example`.

## 5. What the app writes

On sign up or sign in, the app creates or updates:

- `users/{uid}`

Example shape:

```json
{
  "uid": "firebase-auth-uid",
  "email": "client@example.com",
  "displayName": "Client Name",
  "dashboardTitle": "Custom Dashboard",
  "dashboardDescription": "Your client workspace is connected to Firebase Auth and Firestore.",
  "createdAt": "server timestamp",
  "lastLoginAt": "server timestamp",
  "updatedAt": "server timestamp"
}
```

## 6. Routes

- `/` public homepage
- `/login` auth page
- `/dashboard` protected dashboard
