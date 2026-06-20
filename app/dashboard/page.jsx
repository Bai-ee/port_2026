'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';
import { useAuth } from '../../AuthContext';
import InternalPageBackground from '../../InternalPageBackground';
import DashboardLoadingOverlay from '../../components/dashboard/DashboardLoadingOverlay';

const DashboardPage = dynamic(() => import('../../DashboardPage'), {
  loading: () => null,
});

export default function DashboardRoute() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [showLoadingCard, setShowLoadingCard] = useState(true);
  const [dashboardContentReady, setDashboardContentReady] = useState(false);
  const [bgReady, setBgReady] = useState(false);
  const loadingOverlayRef = useRef(null);
  const handleDashboardContentReady = useCallback(() => {
    setDashboardContentReady(true);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?redirect=/dashboard');
    }
  }, [user, loading, router]);

  // Fade out the loading card only once three conditions are met:
  //   1. auth has resolved         (loading === false)
  //   2. the user is present       (!!user)
  //   3. the three.js canvas has rendered its first frame (bgReady)
  //   4. dashboard bootstrap + initial brief render have settled
  // The three.js background stays mounted in the parent tree, so no canvas swap.
  useEffect(() => {
    if (loading || !user || !bgReady || !dashboardContentReady) return;
    if (!loadingOverlayRef.current) return;
    const tween = gsap.to(loadingOverlayRef.current, {
      autoAlpha: 0,
      duration: 0.45,
      ease: 'power2.inOut',
      onComplete: () => setShowLoadingCard(false),
    });
    return () => tween.kill();
  }, [loading, user, bgReady, dashboardContentReady]);

  useEffect(() => {
    setDashboardContentReady(false);
    setShowLoadingCard(true);
  }, [user?.uid]);

  const dashboardReady = !loading && !!user;

  // While auth resolves, render nothing — no "Opening Dashboard" gate flash
  // before the styled loading overlay. Only block once resolved AND signed out.
  if (loading) return null;
  if (!user) {
    return (
      <main style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%)',
        color: '#1a1a1a',
        fontFamily: '"Space Grotesk", system-ui, -apple-system, sans-serif',
      }}>
        <section style={{
          width: 'min(100%, 420px)',
          display: 'grid',
          gap: 16,
          textAlign: 'center',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid #E4E4E4',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 12,
          padding: 24,
        }}>
          <span style={{ fontSize: 9, fontFamily: '"Space Mono", ui-monospace, monospace', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a8a8a', fontWeight: 700 }}>
            Dashboard
          </span>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.15, letterSpacing: 0 }}>
            Sign in to open Dashboard
          </h1>
          <p style={{ margin: 0, color: '#444', fontSize: 14, lineHeight: 1.55 }}>
            Client data and brief history live behind account access.
          </p>
          <a
            href="/login?redirect=/dashboard"
            style={{
              height: 40,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: 999,
              padding: '0 18px',
              fontSize: 13,
              fontFamily: '"Space Grotesk", system-ui, -apple-system, sans-serif',
              fontWeight: 700,
              letterSpacing: '0.01em',
              lineHeight: 1,
              textDecoration: 'none',
              margin: '0 auto',
              boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
            }}
          >
            Sign in
          </a>
        </section>
      </main>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', position: 'relative', overflow: 'hidden' }}>
      <InternalPageBackground onReady={() => setBgReady(true)} />

      {dashboardReady ? (
        <div style={{
          opacity: showLoadingCard ? 0 : 1,
          transition: 'opacity 0.35s ease',
          pointerEvents: showLoadingCard ? 'none' : 'auto',
        }}>
          {/* entranceReady: dashboard entrance timeline starts only after the
              loading overlay's GSAP fade has fully completed */}
          <DashboardPage
            entranceReady={!showLoadingCard}
            onInitialContentReady={handleDashboardContentReady}
          />
        </div>
      ) : null}

      <DashboardLoadingOverlay
        dashboardReady={dashboardReady && dashboardContentReady}
        loadingOverlayRef={loadingOverlayRef}
        showLoadingCard={showLoadingCard}
      />
    </div>
  );
}
