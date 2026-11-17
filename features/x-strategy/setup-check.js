// setup-check.js — what a client still needs before a strategy review or plan answer means anything.
//
// OWNER RULE (2026-11-17): a review on no data is not a review. When a blocker is open, the chat says what is missing
// and offers the fix instead of reviewing. Connecting an X account is NOT required: the strategy works off the public
// timeline (free Mac `bird` pull by handle). A connected account is only needed to auto-post, and that is separate.
//
// Pure: callers pass what they read. Nothing here reads, writes or spends.

/**
 * @param {object} s
 * @param {string|null} s.handle            the client's own X handle (resolveClientXHandle / xGrowth.ownHandle)
 * @param {number}      s.ownRows           stored rows of the own timeline (x_corpora)
 * @param {string|null} s.ownPulledAt       when the own timeline was last pulled
 * @param {object[]}    s.buckets           listBuckets rows (the client's tracks)
 * @param {string[]}    s.benchmarkHandles
 * @param {boolean}     [s.xConnected]      an X account is connected (informational; omitted = not checked)
 * @returns {{ready:boolean, blockers:{code:string,text:string,fix:string}[], notes:string[]}}
 */
export function strategySetupStatus({ handle = null, ownRows = 0, ownPulledAt = null, buckets = [], benchmarkHandles = [], xConnected } = {}) {
  const blockers = [];
  const notes = [];
  const h = handle ? `@${String(handle).replace(/^@/, '')}` : null;
  if (!h) {
    blockers.push({ code: 'no-handle', text: 'No X handle on record for this client.', fix: 'Save the handle in Strategy > X profile (or ask me to, with the handle).' });
  } else if (!(ownRows > 0)) {
    blockers.push({
      code: 'no-own-posts',
      text: `${h}'s posts have never been pulled${ownPulledAt ? ` (last pull ${ownPulledAt} found 0 posts)` : ''}.`,
      fix: 'Refresh > Strategy accounts (free Mac bird pull of the public timeline), or ask me to refresh strategy-accounts. No account connection needed.',
    });
  }
  const active = (Array.isArray(buckets) ? buckets : []).filter((b) => b && b.active !== false);
  if (!active.length) {
    blockers.push({ code: 'no-tracks', text: 'No content tracks set up for this client.', fix: 'Add the client\'s lanes in Content Center > Buckets (one bucket per track), or ask me to propose them as cards.' });
  }
  if (!(Array.isArray(benchmarkHandles) && benchmarkHandles.length)) notes.push('No benchmark handles: reviews cannot compare against peers, and quote scans have no watchlist.');
  if (xConnected === false) notes.push('No X account connected: fine for strategy (public data); only needed to auto-post.');
  return { ready: blockers.length === 0, blockers, notes };
}

/** The system-prompt block. Empty when there is nothing to say. */
export function setupStatusText(status) {
  if (!status || (status.ready && !status.notes?.length)) return '';
  const lines = [];
  if (!status.ready) {
    lines.push('SETUP BLOCKERS (hard): this client is not set up for a strategy review. Until every blocker below is fixed, do NOT run a strategy review, score the plan, or recommend strategy changes from data, and do not call it "no change". Answer with this checklist (each item: what is missing + its fix, offering to do the fixes you can: refresh_data, cards), then answer only what can be answered without the missing data.');
    for (const b of status.blockers) lines.push(`- ${b.text} Fix: ${b.fix}`);
  }
  if (status.notes?.length) lines.push(`SETUP NOTES: ${status.notes.join(' ')}`);
  return lines.join('\n');
}
