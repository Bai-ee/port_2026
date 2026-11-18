// preview.js - the cost preview + single-use confirm token for PAID run_refresh. Pure: secret, clock and stores injected.
//
// Flow: run_refresh without confirm -> {needsConfirm, estimate, effects, previewToken, expiresAt} (nothing invoked).
// run_refresh {confirm:true, previewToken} -> the token is verified, then consumed, then the run starts.
// The token is an HMAC (MCP_OAUTH_SECRET) over {jti, email, clientId, refreshId, params hash, estimate hash, expiry}, so it
// cannot be forged, reused for another client/refresh/params, or used after 10 minutes. Single use is enforced by
// .create() of mcp_ops_previews/{sha256(jti)}: only the HASH is stored, never the token. The previewToken argument is
// redacted in mcp_audit (REDACT_KEY_RE matches "token"; pinned by a test).

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ToolError } from '../jsonrpc.js';

export const PREVIEW_TTL_MS = 10 * 60_000;

const sha256hex = (s) => createHash('sha256').update(String(s)).digest('hex');

/** Canonical JSON (sorted keys) so equal params always hash equal. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
export const hashOf = (v) => sha256hex(canonical(v)).slice(0, 32);

// The MAC key is DERIVED from the signing secret (domain separation), never the secret itself.
const macKey = (secret) => createHmac('sha256', secret).update('mcp-ops-preview-v1').digest();
const mac = (secret, data) => createHmac('sha256', macKey(secret)).update(data).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)); const y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export function issuePreview({ secret, email, clientId, refreshId, params, estimate, now, jti = randomBytes(12).toString('base64url') }) {
  if (!secret) throw new ToolError('Paid refreshes are not available: the MCP signing secret is not configured.');
  const payload = { j: jti, e: String(email || '').toLowerCase(), c: clientId, r: refreshId, p: hashOf(params), h: hashOf(estimate), x: now + PREVIEW_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { previewToken: `${body}.${mac(secret, body)}`, expiresAt: new Date(payload.x).toISOString() };
}

/** Verify signature + every binding + expiry. Throws a ToolError with the reason; does NOT consume. */
export function verifyPreview(token, { secret, email, clientId, refreshId, params, estimate, now }) {
  if (!secret) throw new ToolError('Paid refreshes are not available: the MCP signing secret is not configured.');
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !safeEq(sig, mac(secret, body))) throw new ToolError('previewToken is not valid. Call run_refresh without confirm to get a fresh preview.');
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new ToolError('previewToken is not valid.'); }
  if (p.x <= now) throw new ToolError('previewToken expired (10 minutes). Call run_refresh without confirm for a new preview and ask the owner again.');
  if (p.e !== String(email || '').toLowerCase()) throw new ToolError('previewToken was issued to a different user.');
  if (p.c !== clientId) throw new ToolError('previewToken is for a different client.');
  if (p.r !== refreshId) throw new ToolError('previewToken is for a different refresh.');
  if (p.p !== hashOf(params)) throw new ToolError('previewToken does not match these params. Request a new preview.');
  if (p.h !== hashOf(estimate)) throw new ToolError('The estimate changed since the preview. Request a new preview and show the owner the new estimate.');
  return { jti: p.j, expMs: p.x };
}

/** Single use: .create() of the hashed id. A second consume of the same token (or a race) fails. */
export async function consumePreview(stores, { jti, expMs, email, clientId, refreshId, now }) {
  try {
    await stores.previews.create(sha256hex(jti), { clientId, refreshId, email: String(email || '').toLowerCase(), consumedAt: new Date(now).toISOString(), expiresAt: expMs });
  } catch (err) {
    // Only ALREADY_EXISTS means "used"; any other store error still fails closed, with a generic message.
    const exists = err?.code === 6 || /ALREADY_EXISTS|already exists/i.test(String(err?.message || err?.code || '')) || err?.alreadyExists === true;
    throw new ToolError(exists ? 'previewToken was already used. Request a new preview.' : 'Could not record the confirmation (nothing ran). Request a new preview and try again.');
  }
}
