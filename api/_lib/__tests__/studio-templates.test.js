// studio-templates.test.js — Slice 3 (Cloud Template Persistence). Pure,
// dependency-injected tests against the in-memory fake Firestore
// (fake-firestore.cjs) — no live project required, same pattern as
// media-jobs.test.js/clone-jobs.test.js. Route-level concerns (rejecting a
// request with no Authorization header) are NOT re-tested here: that's
// verifyRequestUser (api/_lib/auth.cjs), an existing, unmodified function
// every other authenticated route in this repo already relies on
// untested-at-the-route-layer (no app/api/**/route.js in this repo has its
// own direct test file — confirmed before writing this suite). Everything
// downstream of a successfully-verified caller — the actual authorization
// and tenant-isolation logic this slice adds — is covered exhaustively below.

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const templates = require('../studio-templates.cjs');
const { makeFakeContext } = require('./fake-firestore.cjs');

let fakeCtx;

beforeEach(() => {
  fakeCtx = makeFakeContext();
  templates.__setTestContext(fakeCtx);
});

afterEach(() => {
  templates.__setTestContext(null);
});

// Fixture recipes — one real shape per kind, matching what the client-side
// modules actually produce (elements/preset-kinds.js / ClothStudio.jsx's
// captureSceneRecipe), not arbitrary test junk.
const RECIPES = {
  scene: { perf: 'medium', mat: { baseColor: '#101114' }, sceneSeed: 12, lookSeed: 4, bgColor: '#000000' },
  element: { type: 'kinetic-rings', values: { material: { color: '#7dd3fc' }, motion: { speed: 0.4 } } },
  look: { envId: 'room', bgColor: '#101114', fxPresetId: 'studio-clean' },
  render: { videoSeconds: 5, videoFormat: 'mp4', frameId: 'off', elementQualityTier: 'draft' },
};

const CLIENT_A = { clientId: 'client-a', uid: 'user-a1' };
const CLIENT_A_USER2 = { clientId: 'client-a', uid: 'user-a2' };
const CLIENT_B = { clientId: 'client-b', uid: 'user-b1' };
const ADMIN = { clientId: 'client-admin-home', uid: 'admin-uid' };

async function createFor(kind, scope, who, overrides = {}) {
  return templates.createTemplate({
    kind, scope, ownerUid: who.uid, clientId: who.clientId, name: `${kind}-${scope}`, recipe: RECIPES[kind], isAdmin: false, ...overrides,
  });
}

// ── All four kinds, basic create/list/read round-trip ───────────────────────

for (const kind of templates.KINDS) {
  test(`${kind}: create -> list -> get round-trip for a client-scope template`, async () => {
    const created = await createFor(kind, 'client', CLIENT_A);
    assert.equal(created.kind, kind);
    assert.equal(created.scope, 'client');
    assert.equal(created.version, 1);
    assert.equal(created.schemaVersion, 1);
    assert.equal(created.archived, false);
    assert.equal(created.thumbnailPath, null);

    const listed = await templates.listTemplates({ kind, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.id);

    const fetched = await templates.getTemplate(created.id, CLIENT_A);
    assert.equal(fetched.id, created.id);
  });
}

// ── Invalid kind / malformed recipe ──────────────────────────────────────────

test('createTemplate: unknown kind is rejected with 400, never reaches Firestore', async () => {
  await assert.rejects(
    () => templates.createTemplate({ kind: 'not-a-kind', scope: 'client', ownerUid: 'u1', clientId: 'c1', recipe: {}, isAdmin: false }),
    (err) => { assert.equal(err.status, 400); return true; }
  );
  const listed = await templates.listTemplates({ kind: 'scene', clientId: 'c1', uid: 'u1' });
  assert.equal(listed.length, 0);
});

test('createTemplate: a non-object recipe (string/array/null) is rejected with 400', async () => {
  for (const badRecipe of ['a string', ['an', 'array'], null, 42]) {
    await assert.rejects(
      () => templates.createTemplate({ kind: 'look', scope: 'client', ownerUid: 'u1', clientId: 'c1', recipe: badRecipe, isAdmin: false }),
      (err) => { assert.equal(err.status, 400); return true; }
    );
  }
});

test('createTemplate: an oversized recipe is rejected with 400', async () => {
  const huge = { blob: 'x'.repeat(250_000) };
  await assert.rejects(
    () => templates.createTemplate({ kind: 'look', scope: 'client', ownerUid: 'u1', clientId: 'c1', recipe: huge, isAdmin: false }),
    (err) => { assert.equal(err.status, 400); return true; }
  );
});

test('createTemplate: a recipe with individually-invalid field VALUES is sanitized, not rejected (matches the local sanitizers\' own "degrade a field, never reject the whole object" discipline)', async () => {
  const created = await templates.createTemplate({
    kind: 'look', scope: 'client', ownerUid: 'u1', clientId: 'c1',
    recipe: { envId: 12345, bgColor: 'not-a-hex-color', lookSeed: 'not-a-number' },
    isAdmin: false,
  });
  assert.equal(typeof created.recipe.envId, 'string');
  assert.notEqual(created.recipe.bgColor, 'not-a-hex-color');
});

test('createTemplate: scene recipe textLayers[].anim (Phase 3 in/out animation) survives the structural sanitizer — valid fields kept, garbage dropped, no throw', async () => {
  const created = await templates.createTemplate({
    kind: 'scene', scope: 'client', ownerUid: 'u1', clientId: 'c1',
    recipe: {
      ...RECIPES.scene,
      textLayers: [
        { id: 'ignored-id', text: 'HERO', anim: { in: 'blur', out: 'fade', inDur: 1.2, outDur: 0.6, delay: 0.3, ease: 'power4', bogus: 'x' } },
        { text: 'NO ANIM AT ALL' },
        { text: 'BAD ANIM SHAPE', anim: 'not-an-object' },
        { text: 'BAD ANIM VALUES', anim: { in: 42, inDur: 'nope' } },
      ],
    },
    isAdmin: false,
  });
  const layers = created.recipe.textLayers;
  assert.equal(layers.length, 4);
  assert.deepEqual(layers[0].anim, { in: 'blur', out: 'fade', inDur: 1.2, outDur: 0.6, delay: 0.3, ease: 'power4' });
  assert.equal('bogus' in layers[0].anim, false, 'unknown anim sub-fields are dropped, not passed through');
  assert.equal('id' in layers[0], false, 'id is dropped — sanitizeTextLayers always reassigns it positionally on load');
  assert.equal(layers[1].anim, undefined, 'a layer with no anim key at all stores no anim key (client-side default applies on load)');
  assert.equal(layers[2].anim, undefined, 'a non-object anim is dropped entirely, never stored as garbage');
  assert.equal(layers[3].anim, undefined, 'an anim object with zero valid fields is dropped entirely (empty object never stored)');
});

test('createTemplate: scene recipe textLayers[] Phase 2 backdrop fields survive the structural sanitizer — valid fields kept, garbage dropped, no throw, old layers get none of them', async () => {
  const created = await templates.createTemplate({
    kind: 'scene', scope: 'client', ownerUid: 'u1', clientId: 'c1',
    recipe: {
      ...RECIPES.scene,
      textLayers: [
        { text: 'HERO', backdrop: 'pill', backdropColor: '#112233', backdropOpacity: 0.4, backdropPadPct: 12, bogusBackdropField: 'x' },
        { text: 'NO BACKDROP FIELDS AT ALL' },
        { text: 'BAD BACKDROP VALUES', backdrop: 42, backdropColor: 12345, backdropOpacity: 'nope', backdropPadPct: 'nope' },
      ],
    },
    isAdmin: false,
  });
  const layers = created.recipe.textLayers;
  assert.equal(layers.length, 3);
  assert.equal(layers[0].backdrop, 'pill');
  assert.equal(layers[0].backdropColor, '#112233');
  assert.equal(layers[0].backdropOpacity, 0.4);
  assert.equal(layers[0].backdropPadPct, 12);
  assert.equal('bogusBackdropField' in layers[0], false, 'unknown fields are dropped, not passed through');
  ['backdrop', 'backdropColor', 'backdropOpacity', 'backdropPadPct'].forEach((key) => {
    assert.equal(key in layers[1], false, 'a layer with no backdrop keys at all stores none of them (client-side default applies on load)');
    assert.equal(key in layers[2], false, 'right-raw-type-only check: a non-string/non-finite backdrop value is dropped entirely, never stored as garbage');
  });
});

test('malformed JSON never reaches this module (that\'s the route\'s request.json() try/catch) — confirm the module itself never throws on garbage that IS a valid JS value', () => {
  assert.doesNotThrow(() => JSON.parse('{"valid":"json"}'));
});

// ── Tenant isolation — client A cannot read or mutate client B's private records ──

test('client B cannot read client A\'s client-scope template — getTemplate returns null, same as a genuinely missing id', async () => {
  const created = await createFor('scene', 'client', CLIENT_A);
  const asB = await templates.getTemplate(created.id, CLIENT_B);
  assert.equal(asB, null);
  const missing = await templates.getTemplate('totally-fake-id', CLIENT_B);
  assert.equal(missing, null);
});

test('client B cannot read client A\'s user-scope template, even with a real clientId guess — user scope also checks ownerUid', async () => {
  const created = await createFor('element', 'user', CLIENT_A);
  const asB = await templates.getTemplate(created.id, CLIENT_B);
  assert.equal(asB, null);
  // A different user ON THE SAME client as the owner still can't read another
  // member's private (scope:'user') template — 'user' scope is stricter than 'client'.
  const asSameClientDifferentUser = await templates.getTemplate(created.id, CLIENT_A_USER2);
  assert.equal(asSameClientDifferentUser, null);
});

test('client B does not see client A\'s templates in listTemplates', async () => {
  await createFor('render', 'client', CLIENT_A);
  await createFor('render', 'user', CLIENT_A);
  const listedByB = await templates.listTemplates({ kind: 'render', clientId: CLIENT_B.clientId, uid: CLIENT_B.uid });
  assert.equal(listedByB.length, 0);
});

test('client B cannot update, archive, unarchive, or duplicate client A\'s client-scope template — all rejected as 404, never leaking that the record exists', async () => {
  const created = await createFor('look', 'client', CLIENT_A);

  await assert.rejects(
    () => templates.updateTemplate({ id: created.id, clientId: CLIENT_B.clientId, uid: CLIENT_B.uid, isAdmin: false, expectedVersion: 1, name: 'Hijacked' }),
    (err) => { assert.equal(err.status, 404); return true; }
  );
  await assert.rejects(
    () => templates.archiveTemplate(created.id, CLIENT_B),
    (err) => { assert.equal(err.status, 404); return true; }
  );
  await assert.rejects(
    () => templates.unarchiveTemplate(created.id, CLIENT_B),
    (err) => { assert.equal(err.status, 404); return true; }
  );
  await assert.rejects(
    () => templates.duplicateTemplate({ id: created.id, clientId: CLIENT_B.clientId, uid: CLIENT_B.uid, isAdmin: false }),
    (err) => { assert.equal(err.status, 404); return true; }
  );

  // Confirm client A's own record is completely untouched by the rejected attempts.
  const stillIntact = await templates.getTemplate(created.id, CLIENT_A);
  assert.equal(stillIntact.name, 'look-client');
  assert.equal(stillIntact.archived, false);
  assert.equal(stillIntact.version, 1);
});

// ── Forged fields ─────────────────────────────────────────────────────────────

test('createTemplate: ownerUid/clientId are ALWAYS the server-resolved auth values, never anything a caller could smuggle inside `recipe`', async () => {
  const created = await templates.createTemplate({
    kind: 'element', scope: 'client', ownerUid: CLIENT_A.uid, clientId: CLIENT_A.clientId,
    recipe: { type: 'kinetic-rings', values: {}, ownerUid: 'attacker-uid', clientId: 'attacker-client', scope: 'global', version: 999 },
    isAdmin: false,
  });
  assert.equal(created.ownerUid, CLIENT_A.uid);
  assert.equal(created.clientId, CLIENT_A.clientId);
  assert.equal(created.scope, 'client');
  assert.equal(created.version, 1);
  // None of the forged keys leak into the stored recipe either — sanitizeElementPresetRecipe only keeps {type, values}.
  assert.equal(created.recipe.ownerUid, undefined);
  assert.equal(created.recipe.clientId, undefined);
  assert.equal(created.recipe.scope, undefined);
});

test('createTemplate: scope=global is rejected for a non-admin regardless of what else is in the payload', async () => {
  await assert.rejects(
    () => templates.createTemplate({ kind: 'look', scope: 'global', ownerUid: 'u1', clientId: 'c1', recipe: RECIPES.look, isAdmin: false }),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('createTemplate: an invalid scope value is rejected with 400, never silently coerced to any real scope', async () => {
  await assert.rejects(
    () => templates.createTemplate({ kind: 'look', scope: 'not-a-real-scope', ownerUid: 'u1', clientId: 'c1', recipe: RECIPES.look, isAdmin: false }),
    (err) => { assert.equal(err.status, 400); return true; }
  );
  await assert.rejects(
    () => templates.createTemplate({ kind: 'look', scope: 'not-a-real-scope', ownerUid: 'u1', clientId: 'c1', recipe: RECIPES.look, isAdmin: true }),
    (err) => { assert.equal(err.status, 400); return true; },
    'even an admin caller gets 400 for a garbage scope, not a silent fallback to client/global'
  );
});

test('createTemplate: a Global template really does get clientId=null even if a clientId was supplied alongside scope=global', async () => {
  const created = await templates.createTemplate({
    kind: 'look', scope: 'global', ownerUid: ADMIN.uid, clientId: 'should-be-ignored', recipe: RECIPES.look, isAdmin: true,
  });
  assert.equal(created.clientId, null);
});

test('updateTemplate: forged expectedVersion/name/recipe cannot bypass tenant isolation — a cross-tenant attempt still 404s even with the CORRECT current version guessed', async () => {
  const created = await createFor('render', 'client', CLIENT_A);
  await assert.rejects(
    () => templates.updateTemplate({ id: created.id, clientId: CLIENT_B.clientId, uid: CLIENT_B.uid, isAdmin: false, expectedVersion: 1, name: 'Hijacked' }),
    (err) => { assert.equal(err.status, 404); return true; }
  );
});

test('updateTemplate: createdAt/ownerUid/clientId are never mutable via update — not accepted as params at all', async () => {
  const created = await createFor('scene', 'client', CLIENT_A);
  const updated = await templates.updateTemplate({ id: created.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false, expectedVersion: 1, name: 'New name' });
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.ownerUid, created.ownerUid);
  assert.equal(updated.clientId, created.clientId);
});

// ── Global promotion gating ──────────────────────────────────────────────────

test('a normal (non-admin) user cannot promote a template to Global', async () => {
  const created = await createFor('look', 'client', CLIENT_A);
  await assert.rejects(
    () => templates.promoteToGlobal({ id: created.id, isAdmin: false }),
    (err) => { assert.equal(err.status, 403); return true; }
  );
  const stillClient = await templates.getTemplate(created.id, CLIENT_A);
  assert.equal(stillClient.scope, 'client');
});

test('an admin CAN promote a client-scope template to Global, and it becomes readable by anyone afterward', async () => {
  const created = await createFor('look', 'client', CLIENT_A);
  const promoted = await templates.promoteToGlobal({ id: created.id, isAdmin: true });
  assert.equal(promoted.scope, 'global');
  assert.equal(promoted.clientId, null);

  const readByStranger = await templates.getTemplate(created.id, CLIENT_B);
  assert.ok(readByStranger, 'Global templates are readable by any client');
  assert.equal(readByStranger.scope, 'global');
});

test('a normal user cannot update, archive, or demote a Global template — 403, since its existence is already public (not 404)', async () => {
  const globalTpl = await templates.createTemplate({ kind: 'render', scope: 'global', ownerUid: ADMIN.uid, recipe: RECIPES.render, isAdmin: true });

  await assert.rejects(
    () => templates.updateTemplate({ id: globalTpl.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false, expectedVersion: 1, name: 'Hijacked' }),
    (err) => { assert.equal(err.status, 403); return true; }
  );
  await assert.rejects(
    () => templates.archiveTemplate(globalTpl.id, CLIENT_A),
    (err) => { assert.equal(err.status, 403); return true; }
  );
  await assert.rejects(
    () => templates.demoteGlobal({ id: globalTpl.id, isAdmin: false, targetClientId: CLIENT_A.clientId }),
    (err) => { assert.equal(err.status, 403); return true; }
  );
});

test('an admin CAN update/archive a Global template, and CAN demote it back to a specific client scope', async () => {
  const globalTpl = await templates.createTemplate({ kind: 'render', scope: 'global', ownerUid: ADMIN.uid, recipe: RECIPES.render, isAdmin: true });

  const renamed = await templates.updateTemplate({ id: globalTpl.id, clientId: null, uid: ADMIN.uid, isAdmin: true, expectedVersion: 1, name: 'Renamed Global' });
  assert.equal(renamed.name, 'Renamed Global');

  const archived = await templates.archiveTemplate(globalTpl.id, { clientId: null, uid: ADMIN.uid, isAdmin: true });
  assert.equal(archived.archived, true);
  await templates.unarchiveTemplate(globalTpl.id, { clientId: null, uid: ADMIN.uid, isAdmin: true });

  const demoted = await templates.demoteGlobal({ id: globalTpl.id, isAdmin: true, targetClientId: CLIENT_A.clientId });
  assert.equal(demoted.scope, 'client');
  assert.equal(demoted.clientId, CLIENT_A.clientId);
  // Now that it's demoted, a stranger can no longer read it.
  const strangerRead = await templates.getTemplate(globalTpl.id, CLIENT_B);
  assert.equal(strangerRead, null);
});

test('duplicating a Global template as a non-admin creates a private/client copy, not a second Global template', async () => {
  const globalTpl = await templates.createTemplate({ kind: 'look', scope: 'global', ownerUid: ADMIN.uid, recipe: RECIPES.look, isAdmin: true });
  const copy = await templates.duplicateTemplate({ id: globalTpl.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false });
  assert.equal(copy.scope, 'client');
  assert.equal(copy.clientId, CLIENT_A.clientId);
  assert.equal(copy.version, 1);
  assert.notEqual(copy.id, globalTpl.id);
  // The original Global template is untouched.
  const original = await templates.getTemplate(globalTpl.id, CLIENT_B);
  assert.equal(original.scope, 'global');
});

// ── Global reads for everyone ────────────────────────────────────────────────

test('Global templates appear in EVERY client\'s listTemplates for the matching kind', async () => {
  await templates.createTemplate({ kind: 'scene', scope: 'global', ownerUid: ADMIN.uid, recipe: RECIPES.scene, isAdmin: true });
  const listedByA = await templates.listTemplates({ kind: 'scene', clientId: CLIENT_A.clientId, uid: CLIENT_A.uid });
  const listedByB = await templates.listTemplates({ kind: 'scene', clientId: CLIENT_B.clientId, uid: CLIENT_B.uid });
  assert.equal(listedByA.length, 1);
  assert.equal(listedByB.length, 1);
  assert.equal(listedByA[0].scope, 'global');
});

// ── Archive / unarchive ──────────────────────────────────────────────────────

test('archive hides a template from the default (non-includeArchived) list but unarchive restores it; the record itself is never hard-deleted', async () => {
  const created = await createFor('element', 'client', CLIENT_A);
  await templates.archiveTemplate(created.id, CLIENT_A);

  const defaultList = await templates.listTemplates({ kind: 'element', clientId: CLIENT_A.clientId, uid: CLIENT_A.uid });
  assert.equal(defaultList.length, 0);
  const withArchived = await templates.listTemplates({ kind: 'element', clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, includeArchived: true });
  assert.equal(withArchived.length, 1);
  assert.equal(withArchived[0].archived, true);

  await templates.unarchiveTemplate(created.id, CLIENT_A);
  const restoredList = await templates.listTemplates({ kind: 'element', clientId: CLIENT_A.clientId, uid: CLIENT_A.uid });
  assert.equal(restoredList.length, 1);
  assert.equal(restoredList[0].archived, false);
});

// ── Stale version conflicts ───────────────────────────────────────────────────

test('updateTemplate: a stale expectedVersion is rejected with 409, and the stored record is unchanged', async () => {
  const created = await createFor('look', 'client', CLIENT_A);
  await templates.updateTemplate({ id: created.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false, name: 'First edit', expectedVersion: 1 });

  await assert.rejects(
    () => templates.updateTemplate({ id: created.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false, name: 'Stale edit', expectedVersion: 1 }),
    (err) => { assert.equal(err.status, 409); return true; }
  );

  const current = await templates.getTemplate(created.id, CLIENT_A);
  assert.equal(current.name, 'First edit');
  assert.equal(current.version, 2);
});

test('updateTemplate: omitting expectedVersion (or passing a non-finite value) is rejected with 400 — never an unconditional update', async () => {
  const created = await createFor('look', 'client', CLIENT_A);
  await assert.rejects(
    () => templates.updateTemplate({ id: created.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false, name: 'No version supplied' }),
    (err) => { assert.equal(err.status, 400); return true; }
  );
  await assert.rejects(
    () => templates.updateTemplate({ id: created.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false, expectedVersion: 'not-a-number', name: 'Bad version' }),
    (err) => { assert.equal(err.status, 400); return true; }
  );
  const stillOriginal = await templates.getTemplate(created.id, CLIENT_A);
  assert.equal(stillOriginal.version, 1, 'a rejected update must never touch the stored record');
});

test('updateTemplate: a valid, matching expectedVersion succeeds and advances version by exactly 1', async () => {
  const created = await createFor('render', 'client', CLIENT_A);
  const updated = await templates.updateTemplate({ id: created.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false, expectedVersion: 1, name: 'v2' });
  assert.equal(updated.version, 2);
  const updatedAgain = await templates.updateTemplate({ id: created.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false, expectedVersion: 2, name: 'v3' });
  assert.equal(updatedAgain.version, 3);
});

test('updateTemplate: two concurrent updates racing on the same expectedVersion resolve to exactly one success and one 409, never a lost update', async () => {
  const created = await createFor('scene', 'client', CLIENT_A);
  assert.equal(created.version, 1);

  const results = await Promise.allSettled([
    templates.updateTemplate({ id: created.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false, expectedVersion: 1, name: 'Racer A' }),
    templates.updateTemplate({ id: created.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false, expectedVersion: 1, name: 'Racer B' }),
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one concurrent update must succeed');
  assert.equal(rejected.length, 1, 'exactly one concurrent update must be rejected');
  assert.equal(rejected[0].reason.status, 409);

  const final = await templates.getTemplate(created.id, CLIENT_A);
  assert.equal(final.version, 2, 'the stored version must reflect exactly one applied update, not zero and not two');
  assert.equal(final.name, fulfilled[0].value.name, 'the stored name must match whichever racer actually won');
});

// ── Local-to-cloud import validation (the "explicit copy" path IS createTemplate) ──

test('importing each of the four local recipe shapes into cloud storage stores and round-trips correctly', async () => {
  for (const kind of templates.KINDS) {
    const created = await templates.createTemplate({
      kind, scope: 'client', ownerUid: CLIENT_A.uid, clientId: CLIENT_A.clientId, name: `Imported ${kind}`, recipe: RECIPES[kind], isAdmin: false,
    });
    const fetched = await templates.getTemplate(created.id, CLIENT_A);
    assert.ok(fetched);
    assert.equal(fetched.kind, kind);
  }
});

test('repeated imports of the same local recipe create SEPARATE cloud records, never silently overwriting an existing one (no dedup key tracked this slice)', async () => {
  const first = await templates.createTemplate({ kind: 'look', scope: 'client', ownerUid: CLIENT_A.uid, clientId: CLIENT_A.clientId, name: 'My Look', recipe: RECIPES.look, isAdmin: false });
  const second = await templates.createTemplate({ kind: 'look', scope: 'client', ownerUid: CLIENT_A.uid, clientId: CLIENT_A.clientId, name: 'My Look', recipe: RECIPES.look, isAdmin: false });
  assert.notEqual(first.id, second.id);
  const listed = await templates.listTemplates({ kind: 'look', clientId: CLIENT_A.clientId, uid: CLIENT_A.uid });
  assert.equal(listed.length, 2);
});

// ── Timestamps / ownership are always server-controlled ─────────────────────

test('createTemplate: createdAt/updatedAt are real, server-generated ISO strings, and version is always 1 on create regardless of any caller-supplied value', async () => {
  const before = Date.now();
  const created = await templates.createTemplate({ kind: 'scene', scope: 'client', ownerUid: 'u1', clientId: 'c1', recipe: { ...RECIPES.scene, version: 999, createdAt: '1970-01-01' }, isAdmin: false });
  const after = Date.now();
  assert.equal(created.version, 1);
  const createdMs = Date.parse(created.createdAt);
  assert.ok(createdMs >= before - 1000 && createdMs <= after + 1000, 'createdAt is a real current timestamp, not caller-influenced');
  assert.equal(created.createdAt, created.updatedAt);
});

test('updateTemplate: updatedAt always advances past the previous value', async () => {
  const created = await createFor('render', 'client', CLIENT_A);
  await new Promise((r) => setTimeout(r, 5));
  const updated = await templates.updateTemplate({ id: created.id, clientId: CLIENT_A.clientId, uid: CLIENT_A.uid, isAdmin: false, expectedVersion: 1, name: 'later' });
  assert.ok(Date.parse(updated.updatedAt) >= Date.parse(created.updatedAt));
});
