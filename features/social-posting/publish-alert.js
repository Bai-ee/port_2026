// One concise owner alert when the publisher parks or fails posts. No polling dashboard needed.
// Off unless PILOT_ALERT_EMAIL, RESEND_API_KEY and PILOT_ALERT_FROM are all set. Never throws into the publisher,
// never includes post text (ids + error classes only). Idempotency key = the set of ids + the UTC day, so the
// every-15-minute sweep cannot re-send the same alert.

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const rowOf = (p) => ({ id: p?.id || null, status: p?.status || null, errorClass: p?.errorClass || null, clientId: p?.clientId || null });

/** Pure: what would be sent for this sweep result (null = nothing to report). */
export function buildPublishAlert(result, { now = Date.now() } = {}) {
  // Ambiguous v2 failures come back in `failed` with status needs_review: they are HELD, not failed.
  const failedRows = (result?.failed || []).map(rowOf);
  const held = [...(result?.needsReview || []).map(rowOf), ...failedRows.filter((r) => r.status === 'needs_review')];
  const failed = failedRows.filter((r) => r.status !== 'needs_review');
  const expired = (result?.expired || []).map(rowOf);
  if (!held.length && !failed.length && !expired.length) return null;
  const ids = [...held, ...failed, ...expired].map((r) => r.id).filter(Boolean).sort();
  const day = new Date(now).toISOString().slice(0, 10);
  const lines = [
    `${held.length} post(s) held for review, ${failed.length} failed, ${expired.length} missed their window (expired, not posted) in the latest publish run.`,
    ...held.map((r) => `HELD    ${r.id}  ${r.errorClass || 'review needed'}`),
    ...failed.map((r) => `FAILED  ${r.id}  ${r.errorClass || 'error'}`),
    ...expired.map((r) => `EXPIRED ${r.id}  missed the 2h publish window`),
    '',
    'Open Content Management → Queue & Calendar. A held post may already be live on X: check, then mark it Posted or Not posted. Failed posts with a rate-limit or pre-send network error are retried by the next run (up to 3 attempts); other failures are not retried. Expired posts were never sent: reschedule or reject them.',
  ];
  return {
    subject: `Content Management: ${held.length} held, ${failed.length} failed, ${expired.length} expired`,
    text: lines.join('\n'),
    idempotencyKey: `pilot-alert:${day}:${createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 16)}`,
  };
}

export async function alertOnHeldPosts(result, { env = process.env, send = null, now = Date.now() } = {}) {
  try {
    const to = env.PILOT_ALERT_EMAIL;
    const from = env.PILOT_ALERT_FROM;
    const apiKey = env.RESEND_API_KEY;
    if (!to || !from || !apiKey) return { sent: false, reason: 'not-configured' };
    const alert = buildPublishAlert(result, { now });
    if (!alert) return { sent: false, reason: 'nothing-to-report' };
    const sender = send || require('../../api/_lib/resend-transport.cjs').sendViaResend;
    const res = await sender({ apiKey, from, to, subject: alert.subject, html: `<pre>${alert.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</pre>`, idempotencyKey: alert.idempotencyKey });
    return { sent: Boolean(res?.ok), reason: res?.ok ? null : (res?.reason || 'send-failed') };
  } catch (err) {
    return { sent: false, reason: err?.message || 'alert-error' };
  }
}
