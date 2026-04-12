'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './AuthContext';
import InternalPageBackground from './InternalPageBackground';
import { internalPageGlassCardStyle } from './pageSurfaceSystem';

const AuthPageInner = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, signIn, signInWithGoogle, signUp, isFirebaseConfigured } = useAuth();
  const [mode, setMode] = useState('signin');
  const [form, setForm] = useState({
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

  const validateCreateDashboard = () => {
    const websiteUrl = form.websiteUrl.trim();
    const ideaDescription = form.ideaDescription.trim();

    if (!websiteUrl && !ideaDescription) {
      throw new Error('Enter a website URL or describe your idea / project / request.');
    }

    if (!form.email.trim()) {
      throw new Error('Email is required.');
    }

    if (!form.password) {
      throw new Error('Password is required.');
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      if (mode === 'signin') {
        await signIn({ email: form.email, password: form.password });
      } else {
        validateCreateDashboard();
        await signUp({
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

  const handleGoogle = async () => {
    setSubmitting(true);
    setError('');

    try {
      if (mode === 'create') {
        const websiteUrl = form.websiteUrl.trim();
        const ideaDescription = form.ideaDescription.trim();

        if (!websiteUrl && !ideaDescription) {
          throw new Error('Enter a website URL or describe your idea / project / request.');
        }

        await signInWithGoogle({
          provisioningPayload: {
            websiteUrl,
            ideaDescription,
          },
        });
      } else {
        await signInWithGoogle();
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
      <InternalPageBackground />
      <style>{`
        @keyframes loginHeadlineMarquee {
          0% {
            transform: translate3d(0, 0, 0);
          }
          100% {
            transform: translate3d(-50%, 0, 0);
          }
        }
      `}</style>
      <div style={gradientStyle} />
      <div style={cardStyle}>
        <div style={cardTopRowStyle}>
          <Link href="/" style={backLinkStyle} aria-label="Back to site">↖</Link>
        </div>
        <div style={brandStyle}>
          <img src="/img/sig.png" alt="" aria-hidden="true" style={sigStyle} />
          <span style={eyebrowStyle}>Client Access</span>
        </div>
        <div style={titleViewportStyle}>
          <div style={titleTrackStyle}>
            <span style={titleStyle}>{mode === 'signin' ? 'SIGN IN TO YOUR DASHBOARD' : 'CREATE DASHBOARD'}</span>
            <span aria-hidden="true" style={titleStyle}>{mode === 'signin' ? 'SIGN IN TO YOUR DASHBOARD' : 'CREATE DASHBOARD'}</span>
          </div>
        </div>
        <p style={copyStyle}>
          {mode === 'signin'
            ? 'Sign in to access your dashboard.'
            : 'Submit your website, idea, or request to generate your dashboard.'}
        </p>

        {!isFirebaseConfigured ? (
          <div style={warningStyle}>
            Firebase is not configured yet. Add the `NEXT_PUBLIC_FIREBASE_*` variables to `.env.local` before signing in.
          </div>
        ) : null}

        <div style={toggleRowStyle}>
          <button type="button" style={{ ...toggleStyle, ...(mode === 'signin' ? toggleActiveStyle : null) }} onClick={() => setMode('signin')}>
            Sign In
          </button>
          <button type="button" style={{ ...toggleStyle, ...(mode === 'create' ? toggleActiveStyle : null) }} onClick={() => setMode('create')}>
            Create Dashboard
          </button>
        </div>

        <form style={formStyle} onSubmit={handleSubmit}>
          {mode === 'create' ? (
            <>
              <label style={labelStyle}>
                Website URL
                <input
                  name="websiteUrl"
                  type="url"
                  value={form.websiteUrl}
                  onChange={handleChange}
                  style={inputStyle}
                  placeholder="Enter your website (optional)"
                />
              </label>
              <label style={labelStyle}>
                Idea / Project / Request
                <textarea
                  name="ideaDescription"
                  value={form.ideaDescription}
                  onChange={handleChange}
                  style={textareaStyle}
                  placeholder="Describe your idea, project, or the work you need done"
                  rows={4}
                />
              </label>
              <div style={hintStyle}>
                Have a site, an idea, or need work done - this is enough to get started.
              </div>
            </>
          ) : null}
          <label style={labelStyle}>
            Email
            <input name="email" type="email" value={form.email} onChange={handleChange} style={inputStyle} placeholder="Your email address" required />
          </label>
          <label style={labelStyle}>
            Password
            <input
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              style={inputStyle}
              placeholder={mode === 'signin' ? 'Enter your password' : 'Create a password'}
              required
              minLength={6}
            />
          </label>

          {error ? <div style={errorStyle}>{error}</div> : null}

          <button type="submit" className="cta-pill-btn" style={submitStyle} disabled={submitting || !isFirebaseConfigured}>
            {submitting ? 'Working…' : mode === 'signin' ? 'Enter Dashboard' : 'Create Dashboard'}
          </button>
          <div style={dividerStyle}>
            <span style={dividerLineStyle} />
            <span style={dividerLabelStyle}>or</span>
            <span style={dividerLineStyle} />
          </div>
          <button type="button" style={googleButtonStyle} onClick={handleGoogle} disabled={submitting || !isFirebaseConfigured}>
            {mode === 'signin' ? 'Continue with Google' : 'Create Dashboard with Google'}
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
  background: 'transparent',
  overflow: 'hidden',
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
};

const gradientStyle = {
  position: 'absolute',
  inset: 0,
  background: 'radial-gradient(60% 60% at 10% 15%, rgba(102, 184, 164, 0.12), transparent 60%), radial-gradient(50% 50% at 82% 72%, rgba(171, 148, 218, 0.14), transparent 65%), linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))',
  pointerEvents: 'none',
  zIndex: 1,
};

const cardStyle = {
  position: 'relative',
  zIndex: 2,
  width: 'min(100%, 30rem)',
  padding: '2rem',
  borderRadius: '1.1rem',
  ...internalPageGlassCardStyle,
  boxShadow: `${internalPageGlassCardStyle.boxShadow}, 0 30px 90px rgba(42,36,32,0.12)`,
};

const cardTopRowStyle = {
  display: 'flex',
  justifyContent: 'flex-end',
  marginBottom: '1.1rem',
};

const backLinkStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2.4rem',
  height: '2.4rem',
  color: 'rgba(42, 36, 32, 0.58)',
  textDecoration: 'none',
  fontSize: '1.15rem',
  fontFamily: '"Space Mono", monospace',
  lineHeight: 1,
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
  fontFamily: '"Space Mono", monospace',
};

const titleViewportStyle = {
  width: '100%',
  overflow: 'hidden',
  margin: '0 0 0.7rem',
};

const titleTrackStyle = {
  display: 'flex',
  alignItems: 'center',
  width: 'max-content',
  minWidth: '100%',
  gap: '2rem',
  animation: 'loginHeadlineMarquee 12s linear infinite',
};

const titleStyle = {
  margin: 0,
  flexShrink: 0,
  color: '#2a2420',
  fontSize: 'clamp(1.75rem, 4.2vw, 2.5rem)',
  lineHeight: 1,
  letterSpacing: '-0.04em',
  fontFamily: '"Doto", "Space Mono", monospace',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const copyStyle = {
  margin: 0,
  color: 'rgba(42, 36, 32, 0.66)',
  lineHeight: 1.6,
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
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
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
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
  fontFamily: '"Space Mono", monospace',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
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
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
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
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
};

const textareaStyle = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: '4.5rem',
  fontFamily: 'inherit',
  lineHeight: 1.5,
};

const hintStyle = {
  marginTop: '-0.2rem',
  color: 'rgba(42, 36, 32, 0.56)',
  fontSize: '0.84rem',
  lineHeight: 1.5,
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
};

const errorStyle = {
  padding: '0.8rem 1rem',
  borderRadius: '0.95rem',
  background: 'rgba(161, 54, 54, 0.08)',
  color: '#8b1e1e',
  fontSize: '0.9rem',
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
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
  fontFamily: '"Space Mono", monospace',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
};

const dividerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  marginTop: '0.1rem',
};

const dividerLineStyle = {
  flex: 1,
  height: '1px',
  background: 'rgba(42, 36, 32, 0.12)',
};

const dividerLabelStyle = {
  color: 'rgba(42, 36, 32, 0.5)',
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  fontFamily: '"Space Mono", monospace',
};

const googleButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '3rem',
  borderRadius: '999px',
  border: '1px solid rgba(42, 36, 32, 0.14)',
  background: 'rgba(255,255,255,0.68)',
  color: '#2a2420',
  fontWeight: 700,
  fontSize: '0.9rem',
  cursor: 'pointer',
  fontFamily: '"Space Mono", monospace',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const AuthPage = () => (
  <Suspense>
    <AuthPageInner />
  </Suspense>
);

export default AuthPage;
