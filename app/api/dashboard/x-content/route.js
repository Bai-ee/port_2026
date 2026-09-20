import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import { buildDayPlan } from '../../../../features/x-content-inventory/plan-day.js';
import { projectDayPlan } from '../../../../features/x-content-inventory/day-plan-projection.js';
import { SERIES, REPLY_QUOTA_PER_DAY } from '../../../../features/x-content-inventory/categories.js';

// Corpora and inventory are imported, not read with fs. A computed readFileSync
// path is invisible to the Next tracer, so the files would be absent from the
// deployed function and the route would 500 in production while passing locally.
// A static import is bundled by construction.
import ownCorpus from '../../../../docs/audits/bai-ee-x-corpus.json';
import benchmarkCorpus from '../../../../docs/audits/seb-design-x-corpus.json';
import packages from '../../../../features/x-content-inventory/content-packages.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const require = createRequire(import.meta.url);
const { verifyRequestUser, isAdminEmail } = require('../../../../api/_lib/auth.cjs');

// X content engine — the day view, read-only.
//
// This is `scripts/x-content/day-view.mjs` behind auth: the same buildDayPlan
// over the same committed corpora and the same local inventory. Zero cost, no X
// API call, no bird call, no LLM, no network at all — pure computation over
// bundled JSON.
//
// It CANNOT POST, and it does not draft. Drafting spends (one Anthropic call per
// slot) and publishing is P4 and blocked; both stay in the terminal behind an
// explicit human action per X-CONTENT-ENGINE-HANDOFF.md §3 decision 7.
//
// Admin-only, same reasoning as the X Monitor route: this is one specific real
// account's strategy surface, not client-facing data.

const MAX_POSTS = 12;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

async function requireAdmin(request) {
  const decoded = await verifyRequestUser({
    headers: {
      authorization: request.headers.get('authorization'),
      Authorization: request.headers.get('authorization'),
    },
  });
  if (!(await isAdminEmail(decoded?.email))) {
    const err = new Error('Admin access required for the X content engine.');
    err.status = 403;
    throw err;
  }
  return decoded;
}

export async function GET(request) {
  // Auth and work are separated so their failure modes keep their own defaults:
  // a missing bearer token throws a plain Error, and folding it into the work
  // block below would report an unauthenticated caller as a 500.
  try {
    await requireAdmin(request);
  } catch (err) {
    return json({ error: err?.message || 'Unauthorized.' }, err?.status || 401);
  }

  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'day-plan';
    if (action !== 'day-plan') return json({ error: `Unknown action: ${action}` }, 400);

    const rawDate = url.searchParams.get('date');
    const date = DATE_RE.test(rawDate || '') ? rawDate : new Date().toISOString().slice(0, 10);
    // Clamped rather than trusted: `posts` sizes the slot array the matcher then
    // walks, so an unbounded query param is an unbounded loop.
    const posts = Math.min(MAX_POSTS, Math.max(1, Number(url.searchParams.get('posts')) || 5));

    const plan = buildDayPlan({
      corpusRows: ownCorpus,
      benchmarkRows: benchmarkCorpus,
      packages,
      date,
      posts,
      handle: url.searchParams.get('handle') || 'bai_ee',
    });

    return json({
      ...projectDayPlan(plan, { posts, replies: REPLY_QUOTA_PER_DAY }),
      // The card names the series behind a gap ("a VIDEO package from: C1, C2…"),
      // so it needs the labels without importing the module into the client bundle.
      series: Object.fromEntries(Object.entries(SERIES).map(([k, s]) => [k, s.label])),
    });
  } catch (err) {
    const status = err?.status || 500;
    return json({ error: err?.message || 'Failed to build the day plan.' }, status);
  }
}
