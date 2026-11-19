// CQ-HowTo request intake (template v3). Pure validation + Firestore handlers with an injected db; the route
// app/api/dashboard/howto-requests/route.js wires auth. MCP/ChatGPT can only create or overwrite a request while its
// status is 'submitted'; building/approved/rejected are set by the owner script (scripts/cq-howto/approve-request.mjs).
import { HOWTO_REQUESTS } from './clients.js';
import { requestHash as computeRequestHash, effectiveNarration } from './howto.js';

export const HOWTO_ALLOWED_CLIENTS = Object.freeze(['paradice-dbBQCHUX']);
export const HOWTO_ID_RE = /^[a-z0-9-]{3,48}$/;
export const HOWTO_MAX_BYTES = 32 * 1024;
export const HOWTO_ACTION_RE = /^[a-zA-Z][a-zA-Z0-9]{1,40}$/;
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

  if (![3, 3.1, 3.2].includes(req.request_version)) errors.push(`request_version must be the number 3, 3.1 or 3.2 (got ${JSON.stringify(req.request_version)})`);
  const v32 = req.request_version === 3.2;
  if (!HOWTO_ID_RE.test(String(req.id ?? ''))) errors.push('id must match [a-z0-9-]{3,48}');
  const need = (path, v) => { if (!text(v)) errors.push(`${path} is required`); };
  if (!DAY_RE.test(String(req.review_on ?? ''))) errors.push('review_on must be YYYY-MM-DD');
  if (!['how-to', 'feature-promo'].includes(req.type)) errors.push('type must be how-to or feature-promo');
  // game_commit: provenance of hand-verified click handlers. Required for 3 / 3.1 (clicks carry handlers). Optional for 3.2:
  // clicks carry catalog action ids and the renderer never reads code refs. Never filled in server-side.
  if (!v32) need('game_commit', req.game_commit);
  else if (req.game_commit != null && req.game_commit !== '' && !/^[0-9a-f]{7,40}$/i.test(String(req.game_commit))) errors.push('game_commit, when given, must be a 7-40 character hex git hash');
  need('goal', req.goal);
  need('audience', req.audience);
  need('public_copy', req.public_copy);
  if (text(req.public_copy).length > 280) errors.push('public_copy must be 280 characters or fewer');
  need('hook', req.hook);
  need('banner', req.banner);
  if (!v32) need('host.name', req.host?.name); // 3.2: defaults to mayor
  need('arrival.say', req.arrival?.say);
  // Optional: narration (voice-over). Default is ON for 3.2 requests, OFF for 3 / 3.1 unless true.
  if (req.narration !== undefined && typeof req.narration !== 'boolean') errors.push('narration must be true or false');

  // 3.2: the hub requestToSpec needs these; reject at submit instead of failing at render.
  if (v32 && !Number.isInteger(req.season)) errors.push(`season must be an integer number, e.g. 3 (got ${JSON.stringify(req.season)})`);
  // 3.2 renders only rebuilt panels; a request that needs a new screen cannot be automatic.
  if (v32 && Array.isArray(req.new_panels) && req.new_panels.some((p) => isObj(p) && Object.values(p).some((v) => v != null && v !== '' && !(Array.isArray(v) && !v.length)))) errors.push('new_panels must be empty for 3.2 (automatic renders use only rebuilt panels; see the template catalog)');

  const steps = req.steps;
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 4) errors.push('steps must be an array of 2 to 4 items');
  else {
    steps.forEach((s, i) => {
      const p = `steps[${i}]`;
      if (!isObj(s)) { errors.push(`${p} must be an object`); return; }
      need(`${p}.say`, s.say);
      need(`${p}.panel`, s.panel);
      if (!v32) need(`${p}.surface`, s.surface); // 3.2: informational only
      if (!Array.isArray(s.clicks) || s.clicks.length < 1) errors.push(`${p}.clicks needs at least 1 click`);
      else if (v32 && s.clicks.length > 3) errors.push(`${p}.clicks allows at most 3 clicks`);
      if (Array.isArray(s.clicks) && s.clicks.length >= 1) s.clicks.forEach((c, j) => {
        if (v32) {
          // 3.2: `action` (a catalog action id for the step's panel) is what the renderer needs; target/handler stay optional notes.
          if (!HOWTO_ACTION_RE.test(String(c?.action ?? ''))) errors.push(`${p}.clicks[${j}].action must match [a-zA-Z][a-zA-Z0-9]{1,40}`);
        } else { need(`${p}.clicks[${j}].target`, c?.target); need(`${p}.clicks[${j}].handler`, c?.handler); }
      });
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

/** Create/overwrite howto_requests/{id}. A 3.2 request is auto-approved on submit; <=3.1 waits for the owner script. Locked once past that. */
export async function submitHowtoRequest(db, { clientId, request, by = null, now = () => new Date().toISOString() }) {
  if (!HOWTO_ALLOWED_CLIENTS.includes(clientId)) return fail(403, `client-not-allowed:${clientId || 'none'}`);
  const { errors, warnings } = validateHowtoRequest(request);
  if (errors.length) return { ok: false, status: 400, error: 'invalid-request', errors, warnings };
  const id = request.id;
  const ref = db.collection(HOWTO_REQUESTS).doc(id);
  const stamp = now();
  let locked = null;
  const auto = request.request_version === 3.2;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists ? snap.data() : null;
    // MCP may overwrite while submitted, or approved by auto-approval; never an owner-approved / building / rejected one.
    if (cur && !(cur.status === 'submitted' || (cur.status === 'approved' && cur.autoApproved === true))) { locked = String(cur.status); return; }
    if (cur && cur.clientId && cur.clientId !== clientId) { locked = 'other-client'; return; }
    const base = { id, clientId, request, submittedAt: cur?.submittedAt || stamp, submittedBy: by, updatedAt: stamp };
    if (auto) tx.set(ref, { ...base, requestVersion: 3.2, status: 'approved', autoApproved: true, requestHash: computeRequestHash(request), approvedAt: stamp, approvedBy: 'auto' });
    else tx.set(ref, { ...base, requestVersion: 3, status: 'submitted' });
  });
  if (locked) return fail(409, `request-locked:${locked}`);
  const briefLine = briefLineOf(id);
  if (auto) {
    return {
      ok: true, id, status: 'approved', autoApproved: true, narration: effectiveNarration(request), warnings, briefLine,
      next: `Now create the draft with queue.draft.create: content = public_copy + "\\n\\n" + briefLine (exactly "${briefLine}"). The video renders from this request automatically (or immediately with video.render.now); a request that needs panels, actions or art that do not exist fails with a visible reason on the draft.`,
    };
  }
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
    briefLine: briefLineOf(id), request: d.request, specHash: d.specHash || null, autoApproved: d.autoApproved === true, requestHash: d.requestHash || null, submittedAt: d.submittedAt || null, updatedAt: d.updatedAt || null,
  };
}
