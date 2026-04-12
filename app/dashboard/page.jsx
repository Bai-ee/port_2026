'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../AuthContext';
import DashboardPage from '../../DashboardPage';

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
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#f5f1df' }}>
        <div style={{ padding: '1rem 1.25rem', borderRadius: '1rem', background: 'rgba(255,255,255,0.7)', boxShadow: '0 24px 70px rgba(42,36,32,0.12)', color: '#2a2420', fontWeight: 600 }}>
          Loading dashboard…
        </div>
      </div>
    );
  }

  if (!user) return null;

  return <DashboardPage />;
}
