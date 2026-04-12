import React, { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * AdminRoute — wraps ProtectedRoute behavior and additionally verifies admin access
 * by calling an admin-gated endpoint. If the call returns 403, the user is shown
 * an access denied message instead of the admin UI.
 *
 * Admin status is determined server-side (admins/{email} Firestore collection).
 * The client never reads that collection directly.
 */
const AdminRoute = () => {
  const { user, loading } = useAuth();
  const location = useLocation();
  const [adminStatus, setAdminStatus] = useState('checking'); // 'checking' | 'authorized' | 'denied'

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

    return () => { cancelled = true; };
  }, [user, loading]);

  if (loading || (user && adminStatus === 'checking')) {
    return <div style={shellStyle}><span style={labelStyle}>CHECKING ACCESS…</span></div>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (adminStatus === 'denied') {
    return (
      <div style={shellStyle}>
        <div style={denyCardStyle}>
          <div style={denyTitleStyle}>ACCESS DENIED</div>
          <div style={denyBodyStyle}>Admin credentials required for this route.</div>
          <Link to="/dashboard" style={denyLinkStyle}>← Return to dashboard</Link>
        </div>
      </div>
    );
  }

  return <Outlet />;
};

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

export default AdminRoute;
