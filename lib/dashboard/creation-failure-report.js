// creation-failure-report.js — client-safe, copyable incident report for
// DashboardCreationFailedModal. Pure formatting only: every field it reads
// comes from bootstrap.creationFailure (the allow-listed projection built by
// api/_lib/client-provisioning.cjs buildCreationFailureProjection) plus the
// client's own already-public websiteUrl — never a raw error.
// See docs/plans/DASHBOARD_CREATION_FAILURE_UX_CLAUDE_PLAN.md §4.

export function extractDomain(websiteUrl) {
  const raw = String(websiteUrl || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return raw;
  }
}

export function formatFailedAt(failedAt) {
  if (!failedAt) return '';
  const date = new Date(failedAt);
  if (Number.isNaN(date.getTime())) return String(failedAt);
  const utc = date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return `${date.toLocaleString()} (local) / ${utc}`;
}

export function buildCreationFailureReport(creationFailure, { websiteUrl } = {}) {
  if (!creationFailure) return '';
  const domain = extractDomain(websiteUrl);
  const lines = [
    `Support reference: ${creationFailure.publicCode || 'unknown'}`,
    `Failed at: ${formatFailedAt(creationFailure.failedAt) || 'unknown'}`,
    `Website: ${domain || '(none submitted)'}`,
    `Category: ${creationFailure.publicStage || 'unknown'}`,
    `Details: ${creationFailure.publicMessage || 'unknown'}`,
    `Run ID: ${creationFailure.runId || 'unknown'}`,
  ];
  return lines.join('\n');
}
