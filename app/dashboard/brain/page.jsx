'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../AuthContext';
import '../../../styles/brain-builder.css';

const BrainBuilder = dynamic(() => import('../../../components/brain-builder/BrainBuilder'), {
  loading: () => null,
});

// Private, authenticated page: the builder only mounts once Firebase auth has
// resolved with a user; otherwise we send them to sign-in and back here.
export default function BrainBuilderRoute() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [asClientId, setAsClientId] = useState(null);

  useEffect(() => {
    setAsClientId(new URLSearchParams(window.location.search).get('as') || '');
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      const here = `${window.location.pathname}${window.location.search || ''}`;
      // AuthPage reads `redirect`; `next` is passed too for callers that use it.
      router.replace(`/login?redirect=${encodeURIComponent(here)}&next=${encodeURIComponent(here)}`);
    }
  }, [user, loading, router]);

  const getIdToken = useCallback(() => user.getIdToken(), [user]);

  if (loading || !user || asClientId === null) {
    return <div id="brain-builder-page" style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>Loading…</div>;
  }
  return <BrainBuilder getIdToken={getIdToken} asClientId={asClientId} />;
}
