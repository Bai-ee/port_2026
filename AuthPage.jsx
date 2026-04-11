import React, { useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

const AuthPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signIn, signUp, isFirebaseConfigured } = useAuth();
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const redirectPath = useMemo(() => location.state?.from?.pathname || '/dashboard', [location.state]);

  if (user) {
    return <Navigate to={redirectPath} replace />;
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      if (mode === 'signin') {
        await signIn({ email: form.email, password: form.password });
      } else {
        await signUp({
          displayName: form.displayName.trim(),
          email: form.email,
          password: form.password,
        });
      }

      navigate(redirectPath, { replace: true });
    } catch (nextError) {
      setError(nextError?.message || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={shellStyle}>
      <div style={gradientStyle} />
      <div style={cardStyle}>
        <Link to="/" style={backLinkStyle}>Back to site</Link>
        <div style={brandStyle}>
          <img src="/img/sig.png" alt="" aria-hidden="true" style={sigStyle} />
          <span style={eyebrowStyle}>Client Access</span>
        </div>
        <h1 style={titleStyle}>{mode === 'signin' ? 'Log in to your dashboard' : 'Create your account'}</h1>
        <p style={copyStyle}>
          Sign in to access a private client dashboard powered by Firebase Authentication and Firestore.
        </p>

        {!isFirebaseConfigured ? (
          <div style={warningStyle}>
            Firebase is not configured yet. Add the `VITE_FIREBASE_*` variables to `.env.local` before signing in.
          </div>
        ) : null}

        <div style={toggleRowStyle}>
          <button type="button" style={{ ...toggleStyle, ...(mode === 'signin' ? toggleActiveStyle : null) }} onClick={() => setMode('signin')}>
            Log In
          </button>
          <button type="button" style={{ ...toggleStyle, ...(mode === 'signup' ? toggleActiveStyle : null) }} onClick={() => setMode('signup')}>
            Sign Up
          </button>
        </div>

        <form style={formStyle} onSubmit={handleSubmit}>
          {mode === 'signup' ? (
            <label style={labelStyle}>
              Name
              <input name="displayName" value={form.displayName} onChange={handleChange} style={inputStyle} placeholder="Bryan Balli" />
            </label>
          ) : null}
          <label style={labelStyle}>
            Email
            <input name="email" type="email" value={form.email} onChange={handleChange} style={inputStyle} placeholder="you@company.com" required />
          </label>
          <label style={labelStyle}>
            Password
            <input name="password" type="password" value={form.password} onChange={handleChange} style={inputStyle} placeholder="••••••••" required minLength={6} />
          </label>

          {error ? <div style={errorStyle}>{error}</div> : null}

          <button type="submit" className="cta-pill-btn" style={submitStyle} disabled={submitting || !isFirebaseConfigured}>
            {submitting ? 'Working…' : mode === 'signin' ? 'Enter Dashboard' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  );
};

const shellStyle = {
  position: 'relative',
  minHeight: '100dvh',
  display: 'grid',
  placeItems: 'center',
  padding: '2rem',
  background: '#f5f1df',
  overflow: 'hidden',
};

const gradientStyle = {
  position: 'absolute',
  inset: 0,
  background: 'radial-gradient(60% 60% at 10% 15%, rgba(102, 184, 164, 0.18), transparent 60%), radial-gradient(50% 50% at 82% 72%, rgba(171, 148, 218, 0.2), transparent 65%), linear-gradient(180deg, rgba(255,255,255,0.3), rgba(255,255,255,0))',
  pointerEvents: 'none',
};

const cardStyle = {
  position: 'relative',
  zIndex: 1,
  width: 'min(100%, 30rem)',
  padding: '2rem',
  borderRadius: '1.5rem',
  background: 'rgba(245, 241, 223, 0.42)',
  backdropFilter: 'blur(28px)',
  WebkitBackdropFilter: 'blur(28px)',
  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 1px 0 rgba(255,255,255,0.6), 0 30px 90px rgba(42,36,32,0.14)',
};

const backLinkStyle = {
  display: 'inline-block',
  marginBottom: '1.5rem',
  color: 'rgba(42, 36, 32, 0.58)',
  textDecoration: 'none',
  fontSize: '0.92rem',
};

const brandStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  marginBottom: '1rem',
};

const sigStyle = {
  width: '2.75rem',
  height: 'auto',
  display: 'block',
};

const eyebrowStyle = {
  fontSize: '0.82rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.44)',
  fontWeight: 700,
};

const titleStyle = {
  margin: '0 0 0.5rem',
  color: '#2a2420',
  fontSize: 'clamp(2rem, 5vw, 2.8rem)',
  lineHeight: 1,
  letterSpacing: '-0.04em',
};

const copyStyle = {
  margin: 0,
  color: 'rgba(42, 36, 32, 0.66)',
  lineHeight: 1.6,
};

const warningStyle = {
  marginTop: '1rem',
  padding: '0.9rem 1rem',
  borderRadius: '1rem',
  background: 'rgba(255,255,255,0.62)',
  border: '1px solid rgba(42, 36, 32, 0.08)',
  color: 'rgba(42, 36, 32, 0.72)',
  fontSize: '0.92rem',
  lineHeight: 1.55,
};

const toggleRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0.6rem',
  marginTop: '1.4rem',
};

const toggleStyle = {
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.34)',
  color: '#2a2420',
  borderRadius: '999px',
  padding: '0.75rem 1rem',
  fontWeight: 700,
  cursor: 'pointer',
};

const toggleActiveStyle = {
  background: '#2a2420',
  color: '#f5f1df',
  borderColor: '#2a2420',
};

const formStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.9rem',
  marginTop: '1.2rem',
};

const labelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.4rem',
  color: '#2a2420',
  fontSize: '0.88rem',
  fontWeight: 600,
};

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '0.9rem 1rem',
  borderRadius: '0.95rem',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.72)',
  color: '#2a2420',
  fontSize: '1rem',
};

const errorStyle = {
  padding: '0.8rem 1rem',
  borderRadius: '0.95rem',
  background: 'rgba(161, 54, 54, 0.08)',
  color: '#8b1e1e',
  fontSize: '0.9rem',
};

const submitStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '3rem',
  border: 'none',
  borderRadius: '999px',
  background: 'linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  color: '#fff',
  fontWeight: 700,
  fontSize: '0.95rem',
  cursor: 'pointer',
  marginTop: '0.4rem',
};

export default AuthPage;
