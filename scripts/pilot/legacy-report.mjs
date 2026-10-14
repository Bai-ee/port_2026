#!/usr/bin/env node
// READ-ONLY dry-run: finds legacy (non-lifecycleVersion-2) social_posts rows that bypass the new protections.
// Never writes to Firestore/Storage; never calls X or model APIs. Recommends parking only (never delete).
// Usage: node scripts/pilot/legacy-report.mjs --client <id>   (required; no owner default)
import { createRequire } from 'node:module';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const SCOPE = ['scheduled', 'queued', 'awaiting_approval', 'approved', 'failed', 'needs_review'];
const SCHEDULED = ['scheduled', 'queued'];
const AMBIGUOUS = ['server-error-ambiguous', 'network-ambiguous', 'unknown'];
const MIN_GAP_MS = 120 * 60_000;
const MAX_PER_DAY = 6;
const STALE_MS = 2 * 3600_000;

const toMs = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : Date.parse(v || ''));
const isV2 = (r) => Number(r?.lifecycleVersion) >= 2;
const excerpt = (r) => String(r?.content || '').replace(/\s+/g, ' ').trim().slice(0, 80);
const ctDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const hasReplyTarget = (r) => r?.replyTo && typeof r.replyTo === 'object' && Boolean(r.replyTo.url || r.replyTo.author || r.replyTo.text);
const pkgNeedsApproval = (pkg) => {
  const s = pkg?.approval?.state;
  return s ? s === 'needed' || s === 'rejected' : pkg?.rights === 'client-approval-needed';
};

/**
 * @param {object[]} rows social_posts rows (with id)
 * @param {{now?:number, packages?:Record<string,object>}} opts packages = map packageId -> package doc
 * @returns {{postId,status,scheduledAt,excerpt,rule,detail,action}[]}
 */
export function classifyLegacyRows(rows, { now = Date.now(), packages = {} } = {}) {
  const out = [];
  const add = (r, rule, detail, action = 'park for review') =>
    out.push({ postId: r.id, status: r.status, scheduledAt: r.scheduledAt ?? null, excerpt: excerpt(r), rule, detail, action });
  const all = rows || [];
  const legacy = all.filter((r) => r && !isV2(r) && SCOPE.includes(r.status));
  const sched = (r) => SCHEDULED.includes(r.status);

  // (c) duplicates sharing a packageId (all scheduled/queued, v2 neighbours count, flag legacy rows)
  const byPkg = new Map();
  for (const r of all) if (r && sched(r) && r.packageId) byPkg.set(r.packageId, [...(byPkg.get(r.packageId) || []), r]);

  // (d) spacing / daily cap over every scheduled row, flag legacy ones
  const timed = all.filter((r) => r && sched(r) && Number.isFinite(toMs(r.scheduledAt))).sort((a, b) => toMs(a.scheduledAt) - toMs(b.scheduledAt));
  const tooClose = new Set();
  const overCap = new Set();
  const perDay = new Map();
  timed.forEach((r, i) => {
    if (i > 0 && toMs(r.scheduledAt) - toMs(timed[i - 1].scheduledAt) < MIN_GAP_MS) tooClose.add(r.id);
    const day = ctDay(toMs(r.scheduledAt));
    const n = (perDay.get(day) || 0) + 1;
    perDay.set(day, n);
    if (n > MAX_PER_DAY) overCap.add(r.id);
  });

  for (const r of legacy) {
    const pkg = r.packageId ? packages[r.packageId] : null;
    const sMs = toMs(r.scheduledAt);
    if (sched(r)) {
      if (hasReplyTarget(r)) add(r, 'A-reply-as-original', 'Reply row would publish as a standalone original.');
      if (pkg?.rights === 'never-public') add(r, 'B-package-never-public', 'Package rights are never-public.');
      if (pkg?.approval?.state === 'rejected') add(r, 'B-package-rejected', 'Package approval was rejected.');
      const exp = toMs(r.expiresAt || pkg?.expiresAt);
      if (Number.isFinite(exp) && exp <= now) add(r, 'B-expired', `Window closed ${new Date(exp).toISOString()}.`);
      if (r.packageId && (byPkg.get(r.packageId) || []).length > 1) add(r, 'C-duplicate-package', `${byPkg.get(r.packageId).length} scheduled rows share this package.`);
      if (tooClose.has(r.id)) add(r, 'D-too-close', 'Less than 120 minutes after the previous scheduled row.');
      if (overCap.has(r.id)) add(r, 'D-over-daily-cap', `More than ${MAX_PER_DAY} scheduled rows on this America/Chicago day.`);
      if (Number.isFinite(sMs) && now - sMs > STALE_MS) add(r, 'E-stale-schedule', 'Scheduled more than 2h ago; would expire on the next sweep.');
    }
    if (r.status === 'failed' && AMBIGUOUS.includes(r.errorClass)) add(r, 'F-failed-ambiguous', `errorClass ${r.errorClass}: may be live on X and could be rescheduled.`);
    if (['approved', 'scheduled', 'queued'].includes(r.status) && !r.reviewedAt) {
      if (r.needsApproval === true || (pkg && pkgNeedsApproval(pkg))) add(r, 'G-unreviewed-needs-approval', 'Needs approval per package rules but has no reviewedAt.');
    }
    if (!r.packageId && !r.engine && !(r.tags && r.tags.engine)) add(r, 'H-untagged', 'No packageId or engine tag.', 'info');
  }
  return out;
}

const tableCell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderReport({ findings, rowCount, legacyCount, label, now, clientId = null }) {
  const counts = {};
  for (const f of findings) counts[f.rule] = (counts[f.rule] || 0) + 1;
  const parkIds = new Set(findings.filter((f) => f.action === 'park for review').map((f) => f.postId));
  const lines = [
    '# Content pilot: legacy row report (dry run)',
    '',
    `Generated: ${new Date(now).toISOString()}${label ? ` | ${label}` : ''}`,
    `Client: ${clientId || '(synthetic)'} | collection: social_posts | READ-ONLY, nothing applied.`,
    '',
    `Rows read: ${rowCount} | legacy rows in scope (no lifecycleVersion 2, relevant status): ${legacyCount} | findings: ${findings.length} | distinct rows recommended to park: ${parkIds.size}`,
    '',
    '## Counts by rule',
    '',
    '| Rule | Count |', '|---|---|',
    ...(Object.keys(counts).sort().map((k) => `| ${k} | ${counts[k]} |`)),
    ...(Object.keys(counts).length ? [] : ['| (none) | 0 |']),
    '',
    `## Findings (first ${Math.min(100, findings.length)} of ${findings.length})`,
    '',
    '| postId | status | scheduledAt | excerpt | rule | action |', '|---|---|---|---|---|---|',
    ...findings.slice(0, 100).map((f) => `| ${f.postId} | ${f.status} | ${tableCell(f.scheduledAt)} | ${tableCell(f.excerpt)} | ${f.rule} | ${f.action} |`),
    '',
    '## Authorization needed to apply parking',
    '',
    `Owner approves parking ${parkIds.size} rows -> a separate script sets status needs_review + error note via the guarded service; none applied here.`,
    '',
  ];
  return lines.join('\n');
}

function syntheticFixture(now) {
  const iso = (m) => new Date(now + m * 60_000).toISOString();
  return {
    rows: [
      { id: 'social_syn_reply', status: 'scheduled', scheduledAt: iso(600), content: 'SYNTHETIC reply row', replyTo: { url: 'https://x.com/a/status/1' } },
      { id: 'social_syn_stale', status: 'queued', scheduledAt: iso(-300), content: 'SYNTHETIC stale row', packageId: 'p1', engine: 'x' },
      { id: 'social_syn_fail', status: 'failed', errorClass: 'unknown', content: 'SYNTHETIC failed row', packageId: 'p2' },
      { id: 'social_syn_plain', status: 'approved', content: 'SYNTHETIC untagged row' },
    ],
    packages: { p1: { rights: 'never-public' } },
  };
}

function clientArg(argv = process.argv.slice(2)) {
  const i = argv.indexOf('--client');
  const id = i > -1 ? String(argv[i + 1] || '').trim() : '';
  if (!id) throw new Error('--client <id> is required (no owner default).');
  return id;
}

async function main() {
  const clientId = clientArg();
  const now = Date.now();
  let rows, packages = {}, label = '';
  try {
    const require = createRequire(import.meta.url);
    require(path.join(REPO, 'features/not-the-rug-brief/load-env'));
    const fb = require(path.join(REPO, 'api/_lib/firebase-admin.cjs'));
    const db = fb.adminDb;
    const snap = await db.collection('social_posts').where('clientId', '==', clientId).get();
    rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const ids = [...new Set(rows.filter((r) => !isV2(r) && r.packageId).map((r) => r.packageId))];
    for (let i = 0; i < ids.length; i += 100) {
      const refs = ids.slice(i, i + 100).map((id) => db.collection('x_content_packages').doc(id));
      const docs = await db.getAll(...refs);
      for (const d of docs) if (d.exists) packages[d.id] = d.data();
    }
    label = 'REAL DATA (read-only)';
  } catch (e) {
    console.error(`Real read unavailable (${String(e?.message || e).slice(0, 120)}); using SYNTHETIC fixture.`);
    ({ rows, packages } = syntheticFixture(now));
    label = 'SYNTHETIC fixture (real read unavailable)';
  }
  const findings = classifyLegacyRows(rows, { now, packages });
  const legacyCount = rows.filter((r) => !isV2(r) && SCOPE.includes(r.status)).length;
  const out = path.join(REPO, 'docs/plans/content-pilot-legacy-report.md');
  writeFileSync(out, renderReport({ findings, rowCount: rows.length, legacyCount, label, now, clientId }));
  const counts = {};
  for (const f of findings) counts[f.rule] = (counts[f.rule] || 0) + 1;
  console.log(JSON.stringify({ label, rows: rows.length, legacyCount, findings: findings.length, counts }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e?.message || e); process.exit(1); });
}
