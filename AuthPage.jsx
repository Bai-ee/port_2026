'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './AuthContext';

const AuthPageInner = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, signIn, signUp, isFirebaseConfigured } = useAuth();
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({
    displayName: '',
    companyName: '',
    websiteUrl: '',
    ideaDescription: '',
    email: '',
    password: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const redirectPath = useMemo(() => searchParams.get('redirect') || '/dashboard', [searchParams]);

  useEffect(() => {
    if (user) {
      router.replace(redirectPath);
    }
  }, [user, redirectPath, router]);

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
          companyName: form.companyName.trim(),
          websiteUrl: form.websiteUrl.trim(),
          ideaDescription: form.ideaDescription.trim(),
          email: form.email,
          password: form.password,
        });
      }

      router.replace(redirectPath);
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
        <Link href="/" style={backLinkStyle}>Back to site</Link>
        <div style={brandStyle}>
          <img src="/img/sig.png" alt="" aria-hidden="true" style={sigStyle} />
          <span style={eyebrowStyle}>Client Access</span>
        </div>
        <h1 style={titleStyle}>{mode === 'signin' ? 'Log in to your dashboard' : 'Create your account'}</h1>
        <p style={copyStyle}>
          {mode === 'signin'
            ? 'Sign in to access your private client dashboard.'
            : 'Create an account, submit your site URL, and the initial dashboard brief will be queued automatically.'}
        </p>

        {!isFirebaseConfigured ? (
          <div style={warningStyle}>
            Firebase is not configured yet. Add the `NEXT_PUBLIC_FIREBASE_*` variables to `.env.local` before signing in.
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
            <>
              <label style={labelStyle}>
                Name
                <input name="displayName" value={form.displayName} onChange={handleChange} style={inputStyle} placeholder="Bryan Balli" required />
              </label>
              <label style={labelStyle}>
                Company / Project
                <input name="companyName" value={form.companyName} onChange={handleChange} style={inputStyle} placeholder="Human In The Loop" required />
              </label>
              <label style={labelStyle}>
                Website URL
                <input
                  name="websiteUrl"
                  type="url"
                  value={form.websiteUrl}
                  onChange={handleChange}
                  style={inputStyle}
                  placeholder="https://your-site.com"
                  required
                />
              </label>
              <label style={labelStyle}>
                What are you working on?
                <textarea
                  name="ideaDescription"
                  value={form.ideaDescription}
                  onChange={handleChange}
                  style={textareaStyle}
                  placeholder="Describe your idea, product, or project…"
                  rows={3}
                />
              </label>
            </>
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

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: '4.5rem',
  fontFamily: 'inherit',
  lineHeight: 1.5,
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

const AuthPage = () => (
  <Suspense>
    <AuthPageInner />
  </Suspense>
);

export default AuthPage;
