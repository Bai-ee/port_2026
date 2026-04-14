'use client';

// AnalyticsPageView.jsx — Tracks SPA page views on client navigation
//
// Next.js App Router doesn't fire native GA pageviews on client nav.
// Drop this component inside AuthProvider (or layout) to auto-track.

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { trackPageView } from '@/lib/analytics';

export default function AnalyticsPageView() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) {
      trackPageView(pathname);
    }
  }, [pathname]);

  return null;
}
