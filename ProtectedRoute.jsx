import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

const ProtectedRoute = () => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={shellStyle}>
        <div style={cardStyle}>Loading dashboard…</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
};

const shellStyle = {
  minHeight: '100dvh',
  display: 'grid',
  placeItems: 'center',
  background: '#f5f1df',
  padding: '2rem',
};

const cardStyle = {
  padding: '1rem 1.25rem',
  borderRadius: '1rem',
  background: 'rgba(255,255,255,0.7)',
  boxShadow: '0 24px 70px rgba(42,36,32,0.12)',
  color: '#2a2420',
  fontWeight: 600,
};

export default ProtectedRoute;
