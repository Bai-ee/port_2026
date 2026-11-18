// owner-session.js — the owner's own dashboard authorization, for MCP chat turns.
//
// OWNER RULE (2026-11-17): the MCP Strategy chat (chat_send) acts like the dashboard Strategy chat: tier-1 calendar
// changes (draft text, creative, dates, tracks) run directly, with the same Undo in the action log. Approving,
// scheduling, posting and spending stay confirm cards in the dashboard (the action runtime's gates, unchanged).
//
// The action runtime calls the dashboard routes in-process and needs the owner's Firebase ID token, exactly as the
// dashboard sends it. The MCP caller is already a verified admin (OAuth + isAdminEmail on every call); this mints a
// real ID token for THAT admin's Firebase user (custom token -> signInWithCustomToken), so every route keeps its own
// checks (verifyIdToken, admin, pilot owner uid, client readiness). Nothing here widens who can do what.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fbLazy = () => require('../../api/_lib/firebase-admin.cjs');

const SIGN_IN_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken';
const REUSE_MARGIN_MS = 5 * 60_000;
const cache = new Map(); // uid -> { authorization, expiresAt }

/**
 * `Bearer <idToken>` for the verified MCP admin, or null when it cannot be minted (the chat then falls back to cards).
 * deps (tests): { auth, fetch, apiKey, now }
 */
export async function ownerAuthorization({ email, uid } = {}, deps = {}) {
  const doFetch = deps.fetch || globalThis.fetch;
  const apiKey = deps.apiKey ?? process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const now = (deps.now || Date.now)();
  if (!apiKey || typeof doFetch !== 'function') return null;
  const auth = deps.auth || fbLazy().adminAuth;
  let id = uid || null;
  if (!id) {
    if (!email) return null;
    try { id = (await auth.getUserByEmail(String(email)))?.uid || null; } catch { return null; }
  }
  if (!id) return null;
  const hit = cache.get(id);
  if (hit && hit.expiresAt - REUSE_MARGIN_MS > now) return hit.authorization;
  try {
    const customToken = await auth.createCustomToken(id, { via: 'mcp-chat' });
    const res = await doFetch(`${SIGN_IN_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j?.idToken) return null;
    const authorization = `Bearer ${j.idToken}`;
    cache.set(id, { authorization, expiresAt: now + (Number(j.expiresIn) || 3600) * 1000 });
    return authorization;
  } catch {
    return null;
  }
}

export const _resetOwnerSessionCache = () => cache.clear();
