'use client';

import React from 'react';
import { Check } from 'lucide-react';

// Shared by MonthCalendarPanel and PostSheet (kept here so neither imports the other).

export const ENGINE_TAG = { record: 'REC', ue: 'UE', client: 'CLIENT', identity: 'ID' };

/** "Sat, Oct 10" for a YYYY-MM-DD (CT) date key. */
export const dayHeading = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/** Filled = scheduled/approved, hollow = pending, check = posted, red = failed. */
export function StateDot({ state }) {
  return <span className={`xce-mc-dot xce-mc-dot-${state}`} aria-hidden="true">{state === 'posted' ? <Check size={8} strokeWidth={3} /> : null}</span>;
}
