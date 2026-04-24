'use client';

import { useEffect, useRef, useState } from 'react';
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
  const [bgReady, setBgReady] = useState(false);
  const loadingOverlayRef = useRef(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/');
    }
  }, [user, loading, router]);

  // Fade out the loading card only once three conditions are met:
  //   1. auth has resolved         (loading === false)
  //   2. the user is present       (!!user)
  //   3. the three.js canvas has rendered its first frame (bgReady)
  // The three.js background stays mounted in the parent tree, so no canvas swap.
  useEffect(() => {
    if (loading || !user || !bgReady) return;
    if (!loadingOverlayRef.current) return;
    const tween = gsap.to(loadingOverlayRef.current, {
      autoAlpha: 0,
      duration: 0.45,
      ease: 'power2.inOut',
      onComplete: () => setShowLoadingCard(false),
    });
    return () => tween.kill();
  }, [loading, user, bgReady]);

  const dashboardReady = !loading && !!user;

  return (
    <div style={{ minHeight: '100dvh', position: 'relative', overflow: 'hidden' }}>
      <InternalPageBackground onReady={() => setBgReady(true)} />

      {dashboardReady ? (
        <div style={{
          opacity: showLoadingCard ? 0 : 1,
          transition: 'opacity 0.35s ease',
          pointerEvents: showLoadingCard ? 'none' : 'auto',
        }}>
          <DashboardPage />
        </div>
      ) : null}

      <DashboardLoadingOverlay
        dashboardReady={dashboardReady}
        loadingOverlayRef={loadingOverlayRef}
        showLoadingCard={showLoadingCard}
      />
    </div>
  );
}
