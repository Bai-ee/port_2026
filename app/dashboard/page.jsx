'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../AuthContext';
import DashboardPage from '../../DashboardPage';
import InternalPageBackground from '../../InternalPageBackground';
import { internalPageGlassCardStyle } from '../../pageSurfaceSystem';

export default function DashboardRoute() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?redirect=/dashboard');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div style={{ minHeight: '100dvh', position: 'relative', overflow: 'hidden' }}>
        <InternalPageBackground />
        <div
          style={{
            minHeight: '100dvh',
            position: 'relative',
            zIndex: 1,
            display: 'grid',
            placeItems: 'center',
            padding: 'clamp(1.25rem, 5vw, 2rem)',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '30rem',
              padding: 'clamp(1.25rem, 5vw, 2rem)',
              borderRadius: '1.1rem',
              boxSizing: 'border-box',
              ...internalPageGlassCardStyle,
              background: 'rgba(255, 252, 248, 0.94)',
              boxShadow: `${internalPageGlassCardStyle.boxShadow}, 0 30px 90px rgba(42,36,32,0.12)`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '1rem' }}>
              <img src="/img/sig.png" alt="" aria-hidden="true" style={{ width: '2.75rem', height: 'auto', display: 'block' }} />
              <span style={{ fontSize: '0.82rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.44)', fontWeight: 700, fontFamily: '"Space Mono", monospace' }}>
                Dashboard Access
              </span>
              <span
                aria-hidden="true"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2.4rem', height: '2.4rem', borderRadius: '999px', background: 'rgba(255,255,255,0.34)', border: '1px solid rgba(42,36,32,0.12)' }}
              >
                <span style={{ width: '0.46rem', height: '0.46rem', borderRadius: '999px', background: '#4A9E5C' }} />
              </span>
            </div>
            <div style={{ color: '#2a2420', fontSize: 'clamp(2rem, 8.5vw, 4.5rem)', lineHeight: 1, letterSpacing: '-0.04em', fontFamily: '"Doto", "Space Mono", monospace', fontWeight: 700 }}>
              Loading Dashboard
            </div>
            <p style={{ margin: '0.75rem 0 0', color: 'rgba(42,36,32,0.66)', lineHeight: 1.6, fontFamily: '"Space Grotesk", system-ui, sans-serif' }}>
              Restoring your client workspace and loading the latest dashboard state.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <DashboardPage />;
}
