'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Globe, Lock } from 'lucide-react';
import { useAuth } from './AuthContext';
import InternalPageBackground from './InternalPageBackground';
import { internalPageGlassCardStyle } from './pageSurfaceSystem';
import { trackSignIn, trackSignUp } from '@/lib/analytics';

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
  const [isHomepageCreate, setIsHomepageCreate] = useState(false);

  const redirectPath = useMemo(() => searchParams.get('redirect') || '/dashboard', [searchParams]);

  // Marquee — rAF loop for pixel-consistent speed, never restarts on tab switch
  const marqueeTrackRef = useRef(null);
  const marqueeOffsetRef = useRef(0);
  const marqueeAnimRef = useRef(null);
  const marqueePrevTimeRef = useRef(null);

  useEffect(() => {
    const SPEED = 72; // px per second — consistent regardless of text length

    const tick = (timestamp) => {
      if (marqueePrevTimeRef.current === null) {
        marqueePrevTimeRef.current = timestamp;
      }
      // Cap delta so a hidden/backgrounded tab doesn't cause a jump on resume
      const delta = Math.min(timestamp - marqueePrevTimeRef.current, 64);
      marqueePrevTimeRef.current = timestamp;

      const track = marqueeTrackRef.current;
      if (track && track.children[0]) {
        const singleWidth = track.children[0].offsetWidth;
        marqueeOffsetRef.current -= SPEED * (delta / 1000);
        if (marqueeOffsetRef.current <= -singleWidth) {
          marqueeOffsetRef.current += singleWidth;
        }
        track.style.transform = `translate3d(${marqueeOffsetRef.current}px, 0, 0)`;
      }

      marqueeAnimRef.current = requestAnimationFrame(tick);
    };

    marqueeAnimRef.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(marqueeAnimRef.current);
      marqueePrevTimeRef.current = null;
    };
  }, []);

  // Detect homepage-create flow — runs once on mount
  const onboardingInitRef = useRef(false);
  useEffect(() => {
    if (onboardingInitRef.current) return;
    onboardingInitRef.current = true;
    const flow = searchParams.get('flow');
    const urlParam = searchParams.get('url');
    if (flow === 'homepage-create') {
      setIsHomepageCreate(true);
      setMode('create');
      if (urlParam) setForm((current) => ({ ...current, websiteUrl: urlParam }));
    }
  }, [searchParams]);

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
        trackSignIn('email');
      } else {
        validateCreateDashboard();
        await signUp({
          websiteUrl: form.websiteUrl.trim(),
          ideaDescription: form.ideaDescription.trim(),
          email: form.email,
          password: form.password,
        });
        trackSignUp('email');
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
        await signInWithGoogle({
          provisioningPayload: {
            websiteUrl: form.websiteUrl.trim(),
            ideaDescription: form.ideaDescription.trim(),
          },
        });
        trackSignUp('google');
      } else {
        await signInWithGoogle();
        trackSignIn('google');
      }

      router.replace(redirectPath);
    } catch (nextError) {
      setError(nextError?.message || 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id="auth-shell" style={shellStyle}>
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
        #auth-tab-indicator {
          transition: left 220ms cubic-bezier(0.25, 0.1, 0.25, 1);
        }
        #auth-submit-btn:disabled,
        #auth-google-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        @media (max-width: 480px) {
          #auth-shell {
            padding: 1rem;
            align-items: start;
            padding-top: 1.5rem;
            padding-bottom: 1.5rem;
          }
          #auth-card {
            padding: 1.25rem;
            width: 100%;
            box-sizing: border-box;
          }
          #auth-mode-tab-bar {
            height: 48px;
          }
          #auth-tab-signin,
          #auth-tab-create {
            font-size: 0.62rem;
            letter-spacing: 0.03em;
          }
          #auth-submit-btn,
          #auth-google-btn {
            font-size: 0.78rem;
          }
        }

        @media (max-width: 360px) {
          #auth-shell {
            padding: 0.75rem;
            padding-top: 1rem;
            padding-bottom: 1rem;
          }
          #auth-card {
            padding: 1rem;
          }
          #auth-tab-signin,
          #auth-tab-create {
            font-size: 0.56rem;
            letter-spacing: 0.02em;
          }
        }
      `}</style>
      <div id="auth-gradient-overlay" style={gradientStyle} />

      <div id="auth-card" style={cardStyle}>
        <div id="auth-brand-row" style={brandStyle}>
          <img src="/img/sig.png" alt="" aria-hidden="true" style={sigStyle} />
          <span style={eyebrowStyle}>Client Access</span>
          <Link href="/" id="auth-back-btn" style={backBtnStyle} aria-label="Back to site">↖</Link>
        </div>

        {/* Marquee — rAF driven, fixed content so speed never changes between tabs */}
        <div style={titleViewportStyle}>
          <div ref={marqueeTrackRef} style={titleTrackStyle}>
            <span style={titleStyle}>SIGN IN TO YOUR DASHBOARD&nbsp;&nbsp;·&nbsp;&nbsp;CREATE DASHBOARD&nbsp;&nbsp;·&nbsp;&nbsp;</span>
            <span aria-hidden="true" style={titleStyle}>SIGN IN TO YOUR DASHBOARD&nbsp;&nbsp;·&nbsp;&nbsp;CREATE DASHBOARD&nbsp;&nbsp;·&nbsp;&nbsp;</span>
          </div>
        </div>

        {isHomepageCreate ? (
          /* ── Homepage-create streamlined variant ─────────────────────────── */
          <>
            <p id="auth-copy" style={copyStyle}>Create your account to activate your dashboard.</p>

            {!isFirebaseConfigured ? (
              <div id="auth-firebase-warning" style={warningStyle}>
                Firebase is not configured yet. Add the `NEXT_PUBLIC_FIREBASE_*` variables to `.env.local` before signing in.
              </div>
            ) : null}

            {/* Captured website — read-only, locked */}
            <div id="auth-captured-url" style={capturedUrlStyle}>
              <Globe size={14} strokeWidth={1.5} style={{ flexShrink: 0, color: 'rgba(42,36,32,0.45)' }} aria-hidden="true" />
              <span id="auth-captured-url-text" style={capturedUrlTextStyle}>{form.websiteUrl}</span>
              <span style={capturedUrlBadgeStyle}>
                <Lock size={10} strokeWidth={2} aria-hidden="true" />
                CAPTURED
              </span>
            </div>

            <form id="auth-form" style={formStyle} onSubmit={handleSubmit}>
              <label style={labelStyle}>
                <span style={labelTextStyle}>Email</span>
                <input
                  id="auth-form-email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  style={inputStyle}
                  placeholder="Your email address"
                  required
                />
              </label>
              <label style={labelStyle}>
                <span style={labelTextStyle}>Password</span>
                <input
                  id="auth-form-password"
                  name="password"
                  type="password"
                  value={form.password}
                  onChange={handleChange}
                  style={inputStyle}
                  placeholder="Create a password"
                  required
                  minLength={6}
                />
              </label>

              {error ? (
                <div id="auth-error" style={errorStyle}>[ERROR: {error}]</div>
              ) : null}

              <button
                type="submit"
                id="auth-submit-btn"
                className="cta-pill-btn"
                style={submitStyle}
                disabled={submitting || !isFirebaseConfigured}
              >
                {submitting ? 'Working…' : 'Create Dashboard'}
              </button>

              <div id="auth-divider" style={dividerStyle}>
                <span style={dividerLineStyle} />
                <span style={dividerLabelStyle}>or</span>
                <span style={dividerLineStyle} />
              </div>

              <button
                type="button"
                id="auth-google-btn"
                style={googleButtonStyle}
                onClick={handleGoogle}
                disabled={submitting || !isFirebaseConfigured}
              >
                <GoogleLogo />
                <span>Create Dashboard with Google</span>
              </button>
            </form>
          </>
        ) : (
          /* ── General auth variant — full experience unchanged ─────────────── */
          <>
            <p id="auth-copy" style={copyStyle}>
              {mode === 'signin'
                ? 'Sign in to access your dashboard.'
                : 'Create your dashboard and make requests.'}
            </p>

            {!isFirebaseConfigured ? (
              <div id="auth-firebase-warning" style={warningStyle}>
                Firebase is not configured yet. Add the `NEXT_PUBLIC_FIREBASE_*` variables to `.env.local` before signing in.
              </div>
            ) : null}

            {/* Wanda Tab Bar */}
            <div id="auth-mode-tab-bar" style={tabBarStyle}>
              <div
                id="auth-tab-indicator"
                style={{
                  ...tabIndicatorStyle,
                  left: mode === 'signin' ? '4px' : 'calc(50%)',
                }}
              />
              <button
                id="auth-tab-signin"
                type="button"
                style={{ ...tabButtonStyle, color: mode === 'signin' ? '#f5f1df' : '#2a2420' }}
                onClick={() => setMode('signin')}
              >
                Sign In
              </button>
              <button
                id="auth-tab-create"
                type="button"
                style={{ ...tabButtonStyle, color: mode === 'create' ? '#f5f1df' : '#2a2420' }}
                onClick={() => setMode('create')}
              >
                Create Dashboard
              </button>
            </div>

            <form id="auth-form" style={formStyle} onSubmit={handleSubmit}>
              {mode === 'create' ? (
                <>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Website URL</span>
                    <input
                      id="auth-form-url"
                      name="websiteUrl"
                      type="url"
                      value={form.websiteUrl}
                      onChange={handleChange}
                      style={inputStyle}
                      placeholder="Enter your website (optional)"
                    />
                  </label>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Idea / Request</span>
                    <textarea
                      id="auth-form-idea"
                      name="ideaDescription"
                      value={form.ideaDescription}
                      onChange={handleChange}
                      style={textareaStyle}
                      placeholder="Describe your project (required if no website)"
                      rows={1}
                    />
                  </label>
                </>
              ) : null}

              <label style={labelStyle}>
                <span style={labelTextStyle}>Email</span>
                <input
                  id="auth-form-email"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={handleChange}
                  style={inputStyle}
                  placeholder="Your email address"
                  required
                />
              </label>
              <label style={labelStyle}>
                <span style={labelTextStyle}>Password</span>
                <input
                  id="auth-form-password"
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

              {error ? (
                <div id="auth-error" style={errorStyle}>[ERROR: {error}]</div>
              ) : null}

              <button
                type="submit"
                id="auth-submit-btn"
                className="cta-pill-btn"
                style={submitStyle}
                disabled={submitting || !isFirebaseConfigured}
              >
                {submitting ? 'Working…' : mode === 'signin' ? 'Enter Dashboard' : 'Create Dashboard'}
              </button>

              <div id="auth-divider" style={dividerStyle}>
                <span style={dividerLineStyle} />
                <span style={dividerLabelStyle}>or</span>
                <span style={dividerLineStyle} />
              </div>

              <button
                type="button"
                id="auth-google-btn"
                style={googleButtonStyle}
                onClick={handleGoogle}
                disabled={submitting || !isFirebaseConfigured}
              >
                <GoogleLogo />
                <span>{mode === 'signin' ? 'Continue with Google' : 'Create Dashboard with Google'}</span>
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

// ── Shell ─────────────────────────────────────────────────────────────────────

const shellStyle = {
  position: 'relative',
  minHeight: '100dvh',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'clamp(1rem, 5vw, 2rem)',
  boxSizing: 'border-box',
  background: 'transparent',
  overflowX: 'hidden',
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
};

const gradientStyle = {
  position: 'absolute',
  inset: 0,
  background: 'radial-gradient(60% 60% at 10% 15%, rgba(102, 184, 164, 0.12), transparent 60%), radial-gradient(50% 50% at 82% 72%, rgba(171, 148, 218, 0.14), transparent 65%), linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))',
  pointerEvents: 'none',
  zIndex: 1,
};

// ── Card ──────────────────────────────────────────────────────────────────────

const cardStyle = {
  position: 'relative',
  zIndex: 2,
  width: '100%',
  maxWidth: '30rem',
  padding: 'clamp(1.25rem, 5vw, 2rem)',
  borderRadius: '1.1rem',
  boxSizing: 'border-box',
  ...internalPageGlassCardStyle,
  boxShadow: `${internalPageGlassCardStyle.boxShadow}, 0 30px 90px rgba(42,36,32,0.12)`,
};

const backBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2.4rem',
  height: '2.4rem',
  borderRadius: '999px',
  background: 'rgba(255,255,255,0.34)',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  color: 'rgba(42, 36, 32, 0.58)',
  textDecoration: 'none',
  fontSize: '1.05rem',
  fontFamily: '"Space Mono", monospace',
  lineHeight: 1,
};

// ── Brand ─────────────────────────────────────────────────────────────────────

const brandStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  marginBottom: '1rem',
  justifyContent: 'space-between',
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

// ── Marquee — UNTOUCHED ───────────────────────────────────────────────────────

const titleViewportStyle = {
  width: '100%',
  overflow: 'hidden',
  margin: '0 0 0.7rem',
};

const titleTrackStyle = {
  display: 'flex',
  alignItems: 'center',
  width: 'max-content',
  willChange: 'transform',
};

const titleStyle = {
  margin: 0,
  flexShrink: 0,
  color: '#2a2420',
  fontSize: 'clamp(2rem, 8.5vw, 7rem)',
  lineHeight: 1,
  letterSpacing: '-0.04em',
  fontFamily: '"Doto", "Space Mono", monospace',
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

// ── Copy ──────────────────────────────────────────────────────────────────────

const copyStyle = {
  margin: 0,
  color: 'rgba(42, 36, 32, 0.66)',
  lineHeight: 1.6,
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
  textAlign: 'center',
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

// ── Wanda Tab Bar ─────────────────────────────────────────────────────────────

const tabBarStyle = {
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  borderRadius: '999px',
  padding: '4px',
  height: '44px',
  marginTop: '1.4rem',
  background: 'rgba(255,255,255,0.34)',
  boxSizing: 'border-box',
};

const tabIndicatorStyle = {
  position: 'absolute',
  top: '4px',
  bottom: '4px',
  width: 'calc(50% - 4px)',
  borderRadius: '999px',
  background: '#2a2420',
  pointerEvents: 'none',
  zIndex: 0,
};

const tabButtonStyle = {
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontFamily: '"Space Mono", monospace',
  fontSize: '0.72rem',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  fontWeight: 700,
  padding: 0,
  transition: 'color 220ms cubic-bezier(0.25, 0.1, 0.25, 1)',
};

// ── Form ──────────────────────────────────────────────────────────────────────

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
};

const labelTextStyle = {
  color: 'rgba(42, 36, 32, 0.55)',
  fontSize: '0.72rem',
  fontWeight: 400,
  fontFamily: '"Space Mono", monospace',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
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
  color: '#8b1e1e',
  fontSize: '0.82rem',
  fontFamily: '"Space Mono", monospace',
  letterSpacing: '0.04em',
};

// ── Actions ───────────────────────────────────────────────────────────────────

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
  gap: '0.65rem',
  minHeight: '3rem',
  borderRadius: '999px',
  border: '1px solid rgba(42, 36, 32, 0.18)',
  background: 'rgba(255,255,255,0.92)',
  color: '#3c3c3c',
  fontWeight: 500,
  fontSize: '0.9rem',
  cursor: 'pointer',
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
  letterSpacing: '0.01em',
  boxShadow: '0 1px 3px rgba(42,36,32,0.08)',
};

// ── Shared sub-components ─────────────────────────────────────────────────────

const GoogleLogo = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }} aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

// ── Homepage-create captured URL display ──────────────────────────────────────

const capturedUrlStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  marginTop: '1rem',
  padding: '0.6rem 0.75rem',
  borderRadius: '0.75rem',
  background: 'rgba(255,255,255,0.55)',
  border: '1px solid rgba(42, 36, 32, 0.1)',
  overflow: 'hidden',
};

const capturedUrlTextStyle = {
  flex: 1,
  fontSize: '0.82rem',
  color: 'rgba(42, 36, 32, 0.72)',
  fontFamily: '"Space Grotesk", system-ui, sans-serif',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const capturedUrlBadgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.25rem',
  flexShrink: 0,
  fontSize: '0.6rem',
  fontFamily: '"Space Mono", monospace',
  letterSpacing: '0.07em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.4)',
  background: 'rgba(42, 36, 32, 0.06)',
  borderRadius: '999px',
  padding: '0.2rem 0.5rem',
};

const AuthPage = () => (
  <Suspense>
    <AuthPageInner />
  </Suspense>
);

export default AuthPage;
