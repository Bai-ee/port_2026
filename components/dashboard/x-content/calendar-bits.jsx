'use client';

import React from 'react';
import { Check } from 'lucide-react';

// Presentation bits for the month / day calendar levels.

export const ENGINE_TAG = { record: 'REC', ue: 'UE', client: 'CLIENT', identity: 'ID' };

/** state -> short label, used by the grid and day rows. */
export const STATE_LABEL = {
  pending: 'Pending approval',
  awaiting: 'Awaiting approval',
  held: 'Held for review',
  approved: 'Approved · not scheduled',
  scheduled: 'Scheduled',
  manual: 'Posting manually',
  posted: 'Posted',
  failed: 'Failed',
};

/** "Sat, Oct 10" for a YYYY-MM-DD (CT) date key. */
export const dayHeading = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/** Filled = scheduled/approved, hollow = pending, check = posted, red = failed. */
export function StateDot({ state }) {
  return <span className={`xce-mc-dot xce-mc-dot-${state}`} aria-hidden="true">{state === 'posted' ? <Check size={8} strokeWidth={3} /> : null}</span>;
}
