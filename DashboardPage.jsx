import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthContext';

const DashboardPage = () => {
  const { user, userProfile, signOutUser } = useAuth();

  return (
    <div style={shellStyle}>
      <div style={gradientStyle} />
      <header style={headerStyle}>
        <Link to="/" style={brandStyle}>
          <img src="/img/sig.png" alt="" aria-hidden="true" style={sigStyle} />
          <span style={brandWordmarkStyle}>Bryan Balli</span>
        </Link>
        <button type="button" onClick={signOutUser} style={signOutStyle}>Sign Out</button>
      </header>

      <main style={mainStyle}>
        <section style={heroStyle}>
          <span style={eyebrowStyle}>Client Dashboard</span>
          <h1 style={titleStyle}>{userProfile?.dashboardTitle || 'Custom Dashboard'}</h1>
          <p style={copyStyle}>
            {userProfile?.dashboardDescription || 'This private workspace is now protected by Firebase Auth and backed by Firestore.'}
          </p>
        </section>

        <section style={gridStyle}>
          <article style={cardStyle}>
            <span style={cardEyebrowStyle}>Account</span>
            <h2 style={cardTitleStyle}>{userProfile?.displayName || user?.displayName || 'Signed-in User'}</h2>
            <p style={cardCopyStyle}>{user?.email}</p>
          </article>
          <article style={cardStyle}>
            <span style={cardEyebrowStyle}>Firestore</span>
            <h2 style={cardTitleStyle}>User document connected</h2>
            <p style={cardCopyStyle}>Your `users/{'{uid}'}` profile document is live and ready for custom dashboard data.</p>
          </article>
          <article style={cardStyle}>
            <span style={cardEyebrowStyle}>Next Step</span>
            <h2 style={cardTitleStyle}>Build your widgets</h2>
            <p style={cardCopyStyle}>This page is now the protected surface where reports, assets, approvals, and client-specific modules can live.</p>
          </article>
        </section>
      </main>
    </div>
  );
};

const shellStyle = {
  position: 'relative',
  minHeight: '100dvh',
  background: '#f5f1df',
  color: '#2a2420',
  overflow: 'hidden',
};

const gradientStyle = {
  position: 'absolute',
  inset: 0,
  background: 'radial-gradient(50% 50% at 12% 18%, rgba(102, 184, 164, 0.18), transparent 60%), radial-gradient(50% 50% at 80% 20%, rgba(171, 148, 218, 0.16), transparent 62%), radial-gradient(45% 45% at 70% 80%, rgba(214, 191, 123, 0.16), transparent 60%)',
  pointerEvents: 'none',
};

const headerStyle = {
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '1.25rem max(10vw, calc((100vw - 980px) / 2))',
};

const brandStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.65rem',
  textDecoration: 'none',
};

const sigStyle = {
  width: '2.5rem',
  height: 'auto',
};

const brandWordmarkStyle = {
  color: '#2a2420',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  fontSize: '1rem',
};

const signOutStyle = {
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.54)',
  color: '#2a2420',
  borderRadius: '999px',
  padding: '0.75rem 1rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const mainStyle = {
  position: 'relative',
  zIndex: 1,
  width: 'min(100%, 980px)',
  margin: '0 auto',
  padding: '2rem 1.25rem 4rem',
  boxSizing: 'border-box',
};

const heroStyle = {
  marginBottom: '2rem',
};

const eyebrowStyle = {
  display: 'inline-block',
  marginBottom: '1rem',
  fontSize: '0.82rem',
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.45)',
};

const titleStyle = {
  margin: 0,
  fontSize: 'clamp(2.2rem, 5vw, 4.25rem)',
  lineHeight: 0.95,
  letterSpacing: '-0.05em',
};

const copyStyle = {
  margin: '0.9rem 0 0',
  fontSize: '1rem',
  lineHeight: 1.7,
  color: 'rgba(42, 36, 32, 0.65)',
  maxWidth: '42rem',
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: '1rem',
};

const cardStyle = {
  padding: '1.25rem',
  borderRadius: '1.25rem',
  background: 'rgba(245, 241, 223, 0.42)',
  backdropFilter: 'blur(24px)',
  WebkitBackdropFilter: 'blur(24px)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 1px 0 rgba(255,255,255,0.6), 0 24px 70px rgba(42,36,32,0.09)',
};

const cardEyebrowStyle = {
  display: 'inline-block',
  marginBottom: '0.8rem',
  fontSize: '0.76rem',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  color: 'rgba(42, 36, 32, 0.45)',
  fontWeight: 700,
};

const cardTitleStyle = {
  margin: 0,
  fontSize: '1.25rem',
  lineHeight: 1.05,
  letterSpacing: '-0.03em',
};

const cardCopyStyle = {
  margin: '0.7rem 0 0',
  color: 'rgba(42, 36, 32, 0.65)',
  lineHeight: 1.65,
};

export default DashboardPage;
