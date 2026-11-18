// CQ-HowTo request intake (template v3). Pure validation + Firestore handlers with an injected db; the route
// app/api/dashboard/howto-requests/route.js wires auth. MCP/ChatGPT can only create or overwrite a request while its
// status is 'submitted'; building/approved/rejected are set by the owner script (scripts/cq-howto/approve-request.mjs).
import { HOWTO_REQUESTS } from './clients.js';

export const HOWTO_ALLOWED_CLIENTS = Object.freeze(['paradice-dbBQCHUX']);
export const HOWTO_ID_RE = /^[a-z0-9-]{3,48}$/;
export const HOWTO_MAX_BYTES = 32 * 1024;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const words = (s) => text(s).split(/\s+/).filter(Boolean).length;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** @returns {{errors: string[], warnings: string[]}} errors block the submit; warnings are the template section 3 copy budget. */
export function validateHowtoRequest(req) {
  const errors = [];
  const warnings = [];
  if (!isObj(req)) return { errors: ['request must be an object shaped like the v3 YAML'], warnings };
  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(req)); } catch { errors.push('request is not JSON-serialisable'); }
  if (size > HOWTO_MAX_BYTES) errors.push(`request is ${size} bytes; the limit is ${HOWTO_MAX_BYTES}`);

  if (req.request_version !== 3) errors.push('request_version must be 3');
  if (!HOWTO_ID_RE.test(String(req.id ?? ''))) errors.push('id must match [a-z0-9-]{3,48}');
  const need = (path, v) => { if (!text(v)) errors.push(`${path} is required`); };
  if (!DAY_RE.test(String(req.review_on ?? ''))) errors.push('review_on must be YYYY-MM-DD');
  if (!['how-to', 'feature-promo'].includes(req.type)) errors.push('type must be how-to or feature-promo');
  need('game_commit', req.game_commit);
  need('goal', req.goal);
  need('audience', req.audience);
  need('public_copy', req.public_copy);
  if (text(req.public_copy).length > 280) errors.push('public_copy must be 280 characters or fewer');
  need('hook', req.hook);
  need('banner', req.banner);
  need('host.name', req.host?.name);
  need('arrival.say', req.arrival?.say);
  // Optional, owner request only: narration (voice-over) is off unless this is true.
  if (req.narration !== undefined && typeof req.narration !== 'boolean') errors.push('narration must be true or false');

  const steps = req.steps;
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 4) errors.push('steps must be an array of 2 to 4 items');
  else {
    steps.forEach((s, i) => {
      const p = `steps[${i}]`;
      if (!isObj(s)) { errors.push(`${p} must be an object`); return; }
      need(`${p}.say`, s.say);
      need(`${p}.panel`, s.panel);
      need(`${p}.surface`, s.surface);
      if (!Array.isArray(s.clicks) || s.clicks.length < 1) errors.push(`${p}.clicks needs at least 1 click`);
      else s.clicks.forEach((c, j) => { need(`${p}.clicks[${j}].target`, c?.target); need(`${p}.clicks[${j}].handler`, c?.handler); });
      const n = words(s.say);
      if (text(s.say) && (n < 4 || n > 8)) warnings.push(`${p}.say has ${n} words (template budget 4-8)`);
    });
  }

  need('payoff.say', req.payoff?.say);
  need('payoff.spot_art', req.payoff?.spot_art);
  need('payoff.town.name', req.payoff?.town?.name);
  const level = req.payoff?.town?.level;
  if (!Number.isInteger(level) || level < 1 || level > 15) errors.push('payoff.town.level must be an integer 1-15');

  if (text(req.arrival?.say) && words(req.arrival.say) > 5) warnings.push(`arrival.say has ${words(req.arrival.say)} words (template budget <=5)`);
  const pn = words(req.payoff?.say);
  if (text(req.payoff?.say) && (pn < 4 || pn > 6)) warnings.push(`payoff.say has ${pn} words (template budget 4-6)`);
  if (text(req.banner)) {
    const bn = words(req.banner);
    if (bn < 2 || bn > 3) warnings.push(`banner has ${bn} words (template budget 2-3)`);
    if (text(req.banner) !== text(req.banner).toUpperCase()) warnings.push('banner should be UPPERCASE');
  }
  return { errors, warnings };
}

const briefLineOf = (id) => `INTERNAL VIDEO BRIEF: howto=${id}`;
const fail = (status, error) => ({ ok: false, status, error });

/** Create/overwrite howto_requests/{id}. Locked once the owner script moved it past 'submitted'. */
export async function submitHowtoRequest(db, { clientId, request, by = null, now = () => new Date().toISOString() }) {
  if (!HOWTO_ALLOWED_CLIENTS.includes(clientId)) return fail(403, `client-not-allowed:${clientId || 'none'}`);
  const { errors, warnings } = validateHowtoRequest(request);
  if (errors.length) return { ok: false, status: 400, error: 'invalid-request', errors, warnings };
  const id = request.id;
  const ref = db.collection(HOWTO_REQUESTS).doc(id);
  const stamp = now();
  let locked = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : null;
    if (cur && cur.status !== 'submitted') { locked = String(cur.status); return; }
    if (cur && cur.clientId && cur.clientId !== clientId) { locked = 'other-client'; return; }
    tx.set(ref, {
      id, clientId, requestVersion: 3, request, status: 'submitted',
      submittedAt: cur?.submittedAt || stamp, submittedBy: by, updatedAt: stamp,
    });
  });
  if (locked) return fail(409, `request-locked:${locked}`);
  const briefLine = briefLineOf(id);
  return {
    ok: true, id, status: 'submitted', warnings, briefLine,
    next: `Now create the draft with queue.draft.create: content = public_copy + "\\n\\n" + briefLine (exactly "${briefLine}"). The video renders only after the owner approves the request.`,
  };
}

/** Read howto_requests/{id} for the calling client (warnings recomputed). */
export async function getHowtoRequest(db, { clientId, id }) {
  if (!HOWTO_ALLOWED_CLIENTS.includes(clientId)) return fail(403, `client-not-allowed:${clientId || 'none'}`);
  if (!HOWTO_ID_RE.test(String(id ?? ''))) return fail(400, 'id must match [a-z0-9-]{3,48}');
  const snap = await db.collection(HOWTO_REQUESTS).doc(id).get();
  if (!snap.exists) return fail(404, 'request-not-found');
  const d = snap.data();
  if (d.clientId !== clientId) return fail(404, 'request-not-found');
  return {
    ok: true, id, status: d.status, note: d.note || null, warnings: validateHowtoRequest(d.request).warnings,
    briefLine: briefLineOf(id), request: d.request, specHash: d.specHash || null, submittedAt: d.submittedAt || null, updatedAt: d.updatedAt || null,
  };
}
