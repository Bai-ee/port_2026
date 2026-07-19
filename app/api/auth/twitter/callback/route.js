// Alias for the X OAuth 2.0 callback. The X app already has
// https://hitloop.agency/api/auth/twitter/callback registered as a callback
// URL, so this path re-exports the real handler instead of registering a new
// URL in the portal. Set X_OAUTH_REDIRECT_URI to this URL so the authorize
// link and the token exchange use the same registered value.
export { GET } from '../../../social-posting/x-oauth/callback/route.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
