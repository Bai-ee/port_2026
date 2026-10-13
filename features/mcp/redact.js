// redact.js - what the MCP server may show. Pure. Two layers:
//   1. DENY: collections/paths that are never readable (credentials, PII, the MCP's own auth state).
//   2. REDACT: any field that looks like a secret is replaced before it leaves the server.

// Collections that hold credentials, billing/PII or the MCP's own auth state. Matched case-insensitively on EVERY
// collection segment of a path (so a subcollection of the same name is denied too).
export const DENY_COLLECTIONS = Object.freeze([
  'users', 'admins', 'subscriptions', 'social_accounts', 'account_deletions', 'deleted_account_emails', '_rate_limits',
  'mcp_oauth_clients', 'mcp_oauth_codes', 'mcp_oauth_refresh', 'mcp_pending_actions', 'mcp_rate_limits',
  // Found by grepping where tokens live:
  'system_flags',            // x_oauth_tokens (X access + refresh tokens), x_oauth_pending, other flags
  'social_oauth_pending',    // per-client X OAuth PKCE state
  'calendar_connections',    // Google Calendar refresh tokens (plaintext by design)
  'social_approvals',        // single-use approval tokens
  'telegram_bindings',       // chat ids + binding secrets
  '_stripe_events',          // billing events
  // Personal data of third parties (people who signed up, were emailed, were prospected, or messaged the bot):
  'records_waitlist', 'digest_deliveries', 'leadgen_prospects', 'telegram_updates',
]);

// Subcollections that are denied only under a specific parent collection (clients/<id>/members = people's emails).
const DENY_SUBCOLLECTIONS = Object.freeze({ members: 'clients' });

const DENY_SET = new Set(DENY_COLLECTIONS.map((s) => s.toLowerCase()));
export const DENY_NAME_RE = /token|secret|oauth|credential/i;
export const REDACT_KEY_RE = /token|secret|password|passwd|api[_-]?key|app[_-]?key|consumer[_-]?key|private[_-]?key|credential|authorization|cookie|session|refresh|oauth|jwt|webhook|verifier|signature|dsn/i;

const SECRET_VALUE_RES = [
  /-----BEGIN [A-Z ]*-----[\s\S]*/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT-shaped
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,       // Stripe secret / restricted keys
  /\bre_[A-Za-z0-9]{10,}/g,                       // Resend API keys
  /\b\d{6,}:[A-Za-z0-9_-]{30,}/g,                // Telegram bot tokens
  /\b1\/\/[A-Za-z0-9_-]{20,}/g,                  // Google OAuth refresh tokens
];

export const REDACTED = '[redacted]';
const MAX_DEPTH = 10;

/** Replace secret-looking substrings of a string value. */
export function redactString(s) {
  let out = s;
  for (const re of SECRET_VALUE_RES) out = out.replace(re, REDACTED);
  return out;
}

const isTimestamp = (v) => v && typeof v === 'object' && typeof v.toDate === 'function';
const isRawTimestamp = (v) => v && typeof v === 'object' && typeof v._seconds === 'number' && typeof v._nanoseconds === 'number';
const isDocRef = (v) => v && typeof v === 'object' && typeof v.path === 'string' && typeof v.collection === 'function';

/**
 * Recursively convert a Firestore value to plain JSON and redact it.
 * `opts.keys:false` skips the key-name rule (value patterns and type conversion still apply): used for the strategy
 * agent's own tool output, whose field names (e.g. lastRefreshAt) are not credentials.
 * Keys that look secret are redacted when their value is a string/object/array; numbers and booleans pass
 * (a count named "inputTokens" is not a credential, and a number cannot carry one).
 */
export function redactValue(value, opts = {}) {
  return walk(value, 0, '', opts.keys !== false);
}

function walk(value, depth, key, keys) {
  if (value === null || value === undefined) return value ?? null;
  const keyHit = keys && key && REDACT_KEY_RE.test(key);
  const t = typeof value;
  if (t === 'number' || t === 'boolean') return value;
  if (keyHit) return REDACTED;
  if (t === 'string') return redactString(value);
  if (t === 'bigint') return String(value);
  if (t !== 'object') return undefined;
  if (isTimestamp(value)) { try { return value.toDate().toISOString(); } catch { return null; } }
  if (isRawTimestamp(value)) return new Date(value._seconds * 1000 + Math.floor(value._nanoseconds / 1e6)).toISOString();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (isDocRef(value)) return `ref:${value.path}`;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return '[binary]';
  if (value instanceof Uint8Array) return '[binary]';
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number' && Object.keys(value).length <= 4) return { latitude: value.latitude, longitude: value.longitude };
  if (depth >= MAX_DEPTH) return '[max depth]';
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1, '', keys));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const r = walk(v, depth + 1, k, keys);
    if (r !== undefined) out[k] = r;
  }
  return out;
}

export class PathError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'PathError'; this.status = status; }
}

const SEGMENT_RE = /^[A-Za-z0-9_\-.:@=+~ ]{1,200}$/;

/** Split + validate a Firestore path. Even index = collection, odd = document id. */
export function parsePath(raw) {
  const path = String(raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!path) throw new PathError('path is required');
  const segs = path.split('/');
  if (segs.length > 12) throw new PathError('path is too deep');
  for (const s of segs) {
    if (!SEGMENT_RE.test(s) || s === '.' || s === '..' || s.includes('..') || s.startsWith('__')) throw new PathError(`invalid path segment: ${JSON.stringify(s.slice(0, 60))}`);
  }
  return { path: segs.join('/'), segments: segs, isDocument: segs.length % 2 === 0 };
}

/** Is a single collection NAME readable? */
export function isDeniedCollectionName(name) {
  const n = String(name).toLowerCase();
  return DENY_SET.has(n) || DENY_NAME_RE.test(n) || (n.startsWith('mcp_') && n !== 'mcp_audit');
}

/** Is any part of this path off-limits? Checks every collection segment, and every document id for secret-ish names. */
export function isDeniedPath(raw) {
  const { segments } = parsePath(raw);
  return segments.some((s, i) => (i % 2 === 0
    ? isDeniedCollectionName(s) || isDeniedSubcollection(s, segments[i - 2])
    : DENY_NAME_RE.test(s)));
}

/** A subcollection that is private only under its usual parent (e.g. members under clients). */
export function isDeniedSubcollection(name, parentCollection) {
  const parent = DENY_SUBCOLLECTIONS[String(name).toLowerCase()];
  return Boolean(parent) && String(parentCollection ?? '').toLowerCase() === parent;
}

export function assertReadablePath(raw) {
  const parsed = parsePath(raw);
  if (isDeniedPath(parsed.path)) throw new PathError('That collection holds credentials or private account data and is not readable through MCP.', 403);
  return parsed;
}

/** Cap + stringify a tool result for the model. Returns {text, truncated}. */
export function capText(value, max = 40000) {
  let text;
  try { text = JSON.stringify(value, null, 1); } catch { text = String(value); }
  if (text === undefined) text = 'null';
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n...[truncated: ${text.length} chars total, showing ${max}. Narrow the query (limit, where, fields) to see the rest.]`, truncated: true };
}
