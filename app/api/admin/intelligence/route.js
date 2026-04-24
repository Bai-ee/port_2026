import { NextResponse } from 'next/server';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildAuthRequestShim, verifyAdminRequest } = require('../../../../api/_lib/auth.cjs');
const fb                         = require('../../../../api/_lib/firebase-admin.cjs');
const { getMaster, listSources, listRecentEvents, setSourceSetting } = require('../../../../features/intelligence/_store');
const { normalizeSourceSetting } = require('../../../../api/_lib/intelligence-bootstrap-utils.cjs');

function deepSerialize(v) {
  if (v == null) return v;
  if (typeof v.toDate === 'function') return v.toDate().toISOString();
  if (typeof v === 'object' && typeof v._seconds === 'number') {
    return new Date(v._seconds * 1000).toISOString();
  }
  if (Array.isArray(v)) return v.map(deepSerialize);
  if (typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = deepSerialize(val);
    return out;
  }
  return v;
}

function json(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'cache-control': 'no-store, max-age=0' },
  });
}

/**
 * Load and shape intelligence for one client.
 * Normalizes + persists any empty ({}) source settings as a side-effect.
 */
async function loadClientIntelligence(clientId, websiteUrl, companyName) {
  const [master, sources, recentEvents] = await Promise.all([
    getMaster(clientId),
    listSources(clientId),
    listRecentEvents(clientId, 50),
  ]);

  const rawSettings = master?.sourceSettings || {};
  const normalizedSettings = {};
  const persistJobs = [];

  for (const src of sources) {
    const raw = rawSettings[src.id];
    const normalized = normalizeSourceSetting(raw);
    normalizedSettings[src.id] = normalized;
    // Persist if setting was absent or empty — Phase 4 requirement
    if (raw == null || (typeof raw === 'object' && Object.keys(raw).length === 0)) {
      persistJobs.push(setSourceSetting(clientId, src.id, normalized));
    }
  }

  if (persistJobs.length > 0) {
    await Promise.allSettled(persistJobs);
  }

  return {
    clientId,
    companyName,
    websiteUrl,
    intelligence: deepSerialize({
      master,
      sources,
      sourceSettings: normalizedSettings,
      recentEvents,
    }),
  };
}

export async function GET(request) {
  try {
    await verifyAdminRequest(buildAuthRequestShim(request));
  } catch (err) {
    return json(
      { error: err instanceof Error ? err.message : 'Forbidden.' },
      403
    );
  }

  const url      = new URL(request.url);
  const clientId = url.searchParams.get('clientId');

  try {
    if (clientId) {
      const snap = await fb.adminDb.collection('clients').doc(clientId).get();
      if (!snap.exists) {
        return json({ error: 'Client not found.' }, 404);
      }
      const d      = snap.data();
      const result = await loadClientIntelligence(clientId, d.websiteUrl || '', d.companyName || '');
      return json({ clients: [result] });
    }

    // List mode
    const clientsSnap = await fb.adminDb
      .collection('clients')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const results = await Promise.all(
      clientsSnap.docs.map((doc) => {
        const d = doc.data();
        return loadClientIntelligence(doc.id, d.websiteUrl || '', d.companyName || '');
      })
    );

    return json({ clients: results });
  } catch (err) {
    console.error('[admin/intelligence] GET error:', err.message);
    return json({ error: err.message }, 500);
  }
}
