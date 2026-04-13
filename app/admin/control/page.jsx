'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../../AuthContext';
import AdminPage from '../../../AdminPage';

export default function AdminControlRoute() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [adminStatus, setAdminStatus] = useState('checking');

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login?redirect=/admin/control');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (loading || !user) return;

    let cancelled = false;

    user.getIdToken()
      .then((token) =>
        fetch('/api/admin/clients?limit=1', {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      .then((res) => {
        if (!cancelled) {
          setAdminStatus(res.status === 200 ? 'authorized' : 'denied');
        }
      })
      .catch(() => {
        if (!cancelled) setAdminStatus('denied');
      });

    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  if (loading || (user && adminStatus === 'checking')) {
    return (
      <div style={shellStyle}>
        <span style={labelStyle}>CHECKING ACCESS…</span>
      </div>
    );
  }

  if (!user) return null;

  if (adminStatus === 'denied') {
    return (
      <div style={shellStyle}>
        <div style={denyCardStyle}>
          <div style={denyTitleStyle}>ACCESS DENIED</div>
          <div style={denyBodyStyle}>Admin credentials required for this route.</div>
          <Link href="/admin" style={denyLinkStyle}>← Return to ops overview</Link>
        </div>
      </div>
    );
  }

  return <AdminPage />;
}

const shellStyle = {
  minHeight: '100dvh',
  display: 'grid',
  placeItems: 'center',
  background: '#000',
  fontFamily: '"Space Mono", monospace',
};

const labelStyle = {
  fontSize: 11,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#666',
};

const denyCardStyle = {
  padding: '32px 40px',
  border: '1px solid #222',
  background: '#111',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxWidth: 360,
};

const denyTitleStyle = {
  fontFamily: '"Space Mono", monospace',
  fontSize: 13,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: '#D71921',
};

const denyBodyStyle = {
  fontSize: 12,
  color: '#666',
  lineHeight: 1.5,
};

const denyLinkStyle = {
  fontSize: 11,
  fontFamily: '"Space Mono", monospace',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#999',
  textDecoration: 'none',
};
