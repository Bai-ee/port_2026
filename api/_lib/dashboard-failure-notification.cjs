'use strict';

// dashboard-failure-notification.cjs — best-effort, idempotent alert to Bryan
// when a client's PRIMARY dashboard-creation run hard-fails.
//
// Contract with the caller (api/_lib/run-lifecycle.cjs failRun):
//   1. The durable incident (dashboard_state.errorState) is already written
//      and committed BEFORE this module is ever called — the client-facing
//      gate exists independently of whether this email succeeds.
//   2. notifyDashboardFailure() NEVER throws. Every outcome — success,
//      Resend not configured, a network/provider failure, or a bug in this
//      module itself — resolves to a plain { attemptedAt, status } record
//      the caller persists onto errorState.notification. "sent" is the only
//      status that may ever justify client copy claiming Bryan was emailed;
//      everything else means "your report was recorded," not "sent".
//   3. Idempotent per run: Resend's Idempotency-Key (`dashboard-failure:
//      ${runId}`) means a duplicate call for the same still-failed run
//      within Resend's dedupe window returns the original result instead of
//      sending a second email — this module does not need its own send log.
//
// See docs/plans/DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md §2.

const { sendViaResend } = require('./resend-transport.cjs');
const { digestSelfOrigin } = require('./digest-self-origin.cjs');
const { logInfo, logWarn } = require('./observability.cjs');

// Same verified sender identity used by every other system email (digest,
// approval rollup) — reusing it avoids standing up a second Resend-verified
// domain/identity just for this alert.
const FROM_ADDRESS = process.env.DIGEST_FROM || 'HITLOOP Daily <digest@hitloop.agency>';

function resolveAlertRecipient() {
  return process.env.DASHBOARD_FAILURE_ALERT_EMAIL || process.env.DIGEST_EMAIL || 'bryanballi@gmail.com';
}

// Defense-in-depth for the admin email, which — unlike the client-facing
// publicMessage — is allowed the real internal error text: strip anything
// shaped like an API key or bearer token before it ever leaves this process.
function redactSecrets(text) {
  return String(text || '')
    .replace(/Bearer\s+[A-Za-z0-9._-]{10,}/gi, 'Bearer [redacted]')
    // Real key shapes have internal hyphens too (e.g. Anthropic's sk-ant-...).
    .replace(/\b(sk|pk|rk)[-_][A-Za-z0-9_-]{6,}\b/gi, '[redacted-key]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted]');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildAdminLink(clientId) {
  return `${digestSelfOrigin()}/admin?clientId=${encodeURIComponent(clientId)}`;
}

function buildEmailHtml(incident) {
  const {
    clientId, runId, publicCode, publicStage, companyName, ownerEmail,
    websiteUrl, internalError, failedAt,
  } = incident;
  const rows = [
    ['Client', escapeHtml(companyName || clientId)],
    ['Client ID', escapeHtml(clientId)],
    ['Owner email', escapeHtml(ownerEmail || '(none on file)')],
    ['Submitted website', escapeHtml(websiteUrl || '(none)')],
    ['Run ID', escapeHtml(runId)],
    ['Support code', escapeHtml(publicCode)],
    ['Category', escapeHtml(publicStage)],
    ['Failed at', escapeHtml(failedAt)],
    ['Internal error', escapeHtml(redactSecrets(internalError?.message))],
    ['Internal stage', escapeHtml(internalError?.stage || 'unknown')],
  ];
  const tableRows = rows
    .map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;white-space:nowrap;">${label}</td><td style="padding:4px 0;"><strong>${value}</strong></td></tr>`)
    .join('');
  const link = buildAdminLink(clientId);
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#111;">
      <p>A client's dashboard could not be created and needs a look.</p>
      <table cellpadding="0" cellspacing="0">${tableRows}</table>
      <p style="margin-top:16px;"><a href="${link}">Open in admin</a></p>
    </div>
  `.trim();
}

/**
 * @param {object} incident
 * @param {string} incident.clientId
 * @param {string} incident.runId
 * @param {string} incident.publicCode
 * @param {string} incident.publicStage
 * @param {string} [incident.companyName]
 * @param {string} [incident.ownerEmail]
 * @param {string} [incident.websiteUrl]
 * @param {{message?: string, stage?: string}} [incident.internalError]
 * @param {string} incident.failedAt
 * @param {{sendFn?: Function}} [opts] - sendFn injection point for tests
 * @returns {Promise<{attemptedAt: string, status: 'sent'|'failed'|'not_configured'}>}
 */
async function notifyDashboardFailure(incident, opts = {}) {
  const sendFn = opts.sendFn || sendViaResend;
  const attemptedAt = new Date().toISOString();
  const { clientId, runId, publicCode } = incident || {};

  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      logWarn('dashboard_failure_notify_not_configured', { clientId, runId, publicCode });
      return { attemptedAt, status: 'not_configured' };
    }

    const to = resolveAlertRecipient();
    const subject = `Dashboard creation failed — ${incident.companyName || clientId} — ${publicCode}`;
    const html = buildEmailHtml(incident);
    const result = await sendFn({
      apiKey,
      from: FROM_ADDRESS,
      to,
      subject,
      html,
      idempotencyKey: `dashboard-failure:${runId}`,
    });

    if (result?.ok) {
      logInfo('dashboard_failure_notify_sent', { clientId, runId, publicCode, emailId: result.id });
      return { attemptedAt, status: 'sent' };
    }
    logWarn('dashboard_failure_notify_failed', {
      clientId, runId, publicCode,
      reason: result?.reason || 'unknown', errorCode: result?.errorCode || null,
    });
    return { attemptedAt, status: 'failed' };
  } catch (err) {
    // Belt-and-suspenders — sendViaResend never throws, but this module must
    // never let a bug here surface as a failure of the incident write itself.
    logWarn('dashboard_failure_notify_threw', { clientId, runId, publicCode, error: err?.message || String(err) });
    return { attemptedAt, status: 'failed' };
  }
}

module.exports = {
  notifyDashboardFailure,
  resolveAlertRecipient,
  redactSecrets,
  buildEmailHtml,
};
