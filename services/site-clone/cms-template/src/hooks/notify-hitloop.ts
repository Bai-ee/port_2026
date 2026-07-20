// notify-hitloop.ts — owned-tier dirty flag. Every content change in this CMS
// pings the HITLOOP dashboard so the Site Recreate card can show "content
// changed since the last Arweave publish". Fire-and-forget: a dead webhook
// never blocks saving. Env comes from the hosting deploy (deploy-cms.mjs);
// without it (local dev of a downloaded zip) this is a no-op.
export async function notifyHitloop(): Promise<void> {
  const url = process.env.HITLOOP_CONTENT_WEBHOOK_URL;
  const secret = process.env.HITLOOP_CONTENT_WEBHOOK_SECRET;
  const jobId = process.env.HITLOOP_JOB_ID;
  if (!url || !secret || !jobId) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, secret }),
    });
  } catch {
    /* never block a save on webhook failure */
  }
}
