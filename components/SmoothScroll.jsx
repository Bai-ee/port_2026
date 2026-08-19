'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Lenis from 'lenis';

// Pages outside the marketing site keep native scroll — the dashboard/admin
// shells have their own nested scrollable modals/panels/terminals that
// Lenis's global wheel hijack would fight with.
const EXCLUDED_PREFIXES = ['/dashboard', '/admin', '/login', '/preview', '/capture', '/briefs', '/api'];

export default function SmoothScroll() {
  const pathname = usePathname();
  const excluded = EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  useEffect(() => {
    if (excluded) return;

    const lenis = new Lenis({ duration: 1 });
    // Exposed so modals/overlays can lenis.stop()/start() — body.style.overflow
    // alone doesn't stop Lenis, since it drives scroll itself via wheel/touch,
    // not the native scrollbar.
    window.__lenis = lenis;

    let rafId;
    function raf(time) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
      window.__lenis = null;
    };
  }, [excluded]);

  return (
    <style jsx global>{`
      html.lenis, html.lenis body {
        height: auto;
      }
      .lenis.lenis-smooth {
        scroll-behavior: auto !important;
      }
      .lenis.lenis-smooth [data-lenis-prevent] {
        overscroll-behavior: contain;
      }
      .lenis.lenis-stopped {
        overflow: hidden;
      }
      .lenis.lenis-scrolling iframe {
        pointer-events: none;
      }
    `}</style>
  );
}
