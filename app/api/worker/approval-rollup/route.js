import { NextResponse } from 'next/server';
import { createRequire } from 'module';
import {
  DT,
  appOrigin,
  buildVideoPostRow,
  dKicker,
  dSection,
  escapeHtml,
  sendEmail,
} from '../../admin/daily-digest/route.js';
import { getSocialAccount } from '../../../../features/social-posting/social-accounts.js';
import { listPendingApprovalPosts } from '../../../../features/social-posting/twitter-service.js';

// Admin roll-up: one email listing every client's video that is
// awaiting_approval AND whose own per-client digest is suppressed for it (see
// isDigestClaimedByRollup — the same predicate both sides read). Each row
// gets its OWN freshly-minted, single-use token; a post already carrying an
// unused token from its original per-client mint is untouched — two valid
// tokens for the same post is safe because publishApprovedPost/rejectSocialPost
// guard on post.status, so only the first click (either link) can publish.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const require = createRequire(import.meta.url);
const fb = require('../../../../api/_lib/firebase-admin.cjs');
const {
  buildAuthRequestShim,
  getHeaderValue,
  hasValidWorkerSecret,
  safeSecretEquals,
  verifyAdminRequest,
} = require('../../../../api/_lib/auth.cjs');
const { logError, logInfo, logWarn } = require('../../../../api/_lib/observability.cjs');
const digestConfig = require('../../../../features/intelligence/_digest-config.js');
const { signApprovalToken, APPROVAL_TTL_MS } = require('../../../../api/_lib/social-approval.cjs');

const DIGEST_TO = process.env.DIGEST_EMAIL || 'bryanballi@gmail.com';

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function hasValidCronSecret(request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const provided = getHeaderValue(buildAuthRequestShim(request).headers, 'authorization');
  return safeSecretEquals(provided, `Bearer ${cronSecret}`);
}

async function authorizeRequest(request) {
  if (hasValidWorkerSecret(buildAuthRequestShim(request))) return;
  if (hasValidCronSecret(request)) return;
  await verifyAdminRequest(buildAuthRequestShim(request));
}

function buildRollupEmailHtml(rows, timestamp) {
  const dateStr = new Date(timestamp).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const body = rows.length
    ? rows.map((r) => buildVideoPostRow(r.item, 'Remix', r.ctx)).join('<div style="height:24px;"></div>')
    : `<div style="background:${DT.card};border:1px dashed ${DT.dash};border-radius:14px;padding:16px 18px;font-family:${DT.fBody};font-size:13px;line-height:1.55;color:${DT.soft};">Nothing is waiting on approval right now.</div>`;

  const emailHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>HITLOOP Pending Approval</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Doto:wght@400;700;900&family=Space+Grotesk:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
body{margin:0;padding:0;background:${DT.bg};}
a{text-decoration:none;}
@media only screen and (max-width:600px){
  .container{padding:24px 16px !important;}
  .hero-title{font-size:42px !important;}
  .vp-col-media,.vp-col-text{display:block !important;width:100% !important;padding-left:0 !important;}
  .vp-col-media{margin-bottom:10px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background:${DT.bg};-webkit-font-smoothing:antialiased;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${DT.bg};">
    <tr><td align="center" style="padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;width:100%;table-layout:fixed;">
        <tr><td class="container" style="padding:40px 32px;">
          <div style="padding-bottom:6px;">
            ${dKicker('HitLoop.agency &middot; Social Auto-Publish')}
            <div class="hero-title" style="font-family:${DT.fDisp};font-weight:900;font-size:56px;line-height:.95;letter-spacing:-.03em;text-transform:uppercase;color:${DT.ink};margin:6px 0 16px;">Pending Approval &middot; ${rows.length} video${rows.length === 1 ? '' : 's'}</div>
            <div style="font-family:${DT.fMono};font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${DT.light};">${dateStr}</div>
          </div>
          ${dSection('Social Auto-Publish', 'Ready to post', body)}
          <div style="border-top:1.5px solid ${DT.line};padding-top:22px;margin-top:32px;">
            <div style="font-family:${DT.fMono};font-size:10px;letter-spacing:.08em;color:${DT.light};">Generated ${new Date(timestamp).toLocaleTimeString('en-US')}</div>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return emailHtml.replace(/\n[ \t]+/g, '\n');
}

async function buildRollupRow(post) {
  const clientId = post.clientId;
  const platform = post.platform || 'x';
  let clientName = clientId;
  try {
    const snap = await fb.adminDb.collection('clients').doc(clientId).get();
    const data = snap.exists ? snap.data() : null;
    clientName = data?.companyName || data?.name || data?.dashboardTitle || clientId;
  } catch { /* fall back to the raw id */ }

  let handle = null;
  try {
    const account = await getSocialAccount(clientId, platform);
    handle = account?.connected ? account.username : null;
  } catch { /* not connected */ }

  const { token } = await signApprovalToken({ postId: post.id, clientId, platform });
  const approvalUrl = `${appOrigin()}/post-approval/${encodeURIComponent(token)}`;

  return {
    item: { url: post.mediaUrl, duration: 0, caption: post.content, stale: false, staleLabel: '' },
    ctx: { clientName, handle, mode: 'approval', platformLabel: platform === 'x' ? 'X' : platform, approvalUrl, publishedAt: null },
  };
}

async function handle(request) {
  try {
    await authorizeRequest(request);
  } catch {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const timestamp = Date.now();
  let rows = [];
  let expiredCount = 0;
  try {
    // Bounded by the approval token's own TTL: a post nobody acted on within
    // 48h is swept to 'expired' rather than re-listed (and re-tokened) here
    // every single day.
    const pending = await listPendingApprovalPosts({ maxAgeMs: APPROVAL_TTL_MS, limit: 200 });
    const posts = pending.posts;
    expiredCount = pending.expired;
    if (expiredCount) logInfo('approval_rollup_expired_stale', { count: expiredCount });

    // Only clients whose own digest is claimed (same-inbox as this roll-up) —
    // a client with its own recipientEmail keeps its button in its own email
    // only; that client never appears here (see isDigestClaimedByRollup).
    const byClient = new Map();
    for (const post of posts) {
      if (!post?.mediaUrl || !post?.clientId) continue;
      if (!byClient.has(post.clientId)) byClient.set(post.clientId, []);
      byClient.get(post.clientId).push(post);
    }

    for (const [clientId, clientPosts] of byClient) {
      // eslint-disable-next-line no-await-in-loop
      const cfg = await digestConfig.getDigestConfig(clientId).catch(() => null);
      if (!cfg || !digestConfig.isDigestClaimedByRollup(cfg)) continue;
      for (const post of clientPosts) {
        // eslint-disable-next-line no-await-in-loop
        try {
          rows.push(await buildRollupRow(post));
        } catch (err) {
          logWarn('approval_rollup_row_failed', { clientId, postId: post.id, error: err.message });
        }
      }
    }
  } catch (err) {
    logError('approval_rollup_query_failed', { error: err.message });
    return json({ error: `Could not query pending approvals: ${err.message}` }, 500);
  }

  const html = buildRollupEmailHtml(rows, timestamp);
  try {
    await sendEmail(`HITLOOP — Pending Approval · ${rows.length} video${rows.length === 1 ? '' : 's'}`, html, DIGEST_TO);
  } catch (err) {
    logError('approval_rollup_send_failed', { error: err.message, count: rows.length });
    return json({ error: `Send failed: ${err.message}` }, 500);
  }

  logInfo('approval_rollup_sent', { count: rows.length, expired: expiredCount });
  return json({ ok: true, count: rows.length, expired: expiredCount });
}

export async function GET(request) {
  return handle(request);
}

export async function POST(request) {
  return handle(request);
}
