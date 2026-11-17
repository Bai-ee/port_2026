'use client';

// Card-face summary for the Site Showcase card: latest job + today's quota. Reads only; it never starts a render.
import { useCallback, useEffect, useState } from 'react';

export default function useShowcaseSummary({ enabled, authedFetch }) {
  const [summary, setSummary] = useState({ jobs: [], quota: null, loaded: false });

  const refresh = useCallback(async () => {
    if (!enabled || !authedFetch) return;
    try {
      const [listRes, optRes] = await Promise.all([
        authedFetch('/api/dashboard/showcase?action=list'),
        authedFetch('/api/dashboard/showcase?action=options'),
      ]);
      const [list, opts] = await Promise.all([listRes.json().catch(() => ({})), optRes.json().catch(() => ({}))]);
      setSummary({ jobs: Array.isArray(list.jobs) ? list.jobs : [], quota: opts.quota || null, loaded: true });
    } catch {
      setSummary((prev) => ({ ...prev, loaded: true }));
    }
  }, [enabled, authedFetch]);

  useEffect(() => { refresh(); }, [refresh]);
  return { ...summary, refresh };
}
