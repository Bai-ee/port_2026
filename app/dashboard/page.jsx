'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import gsap from 'gsap';
import { useAuth } from '../../AuthContext';
import InternalPageBackground from '../../InternalPageBackground';
import DashboardLoadingOverlay from '../../components/dashboard/DashboardLoadingOverlay';
import WebsiteUrlGate from '../../components/dashboard/WebsiteUrlGate';

const DashboardPage = dynamic(() => import('../../DashboardPage'), {
  loading: () => null,
});

// The website URL (and/or idea) captured at sign-up, stashed in sessionStorage by
// the auth flow. Lets the dashboard finish provisioning with the URL the user
// already gave instead of re-prompting via WebsiteUrlGate.
const PENDING_DASHBOARD_SIGNUP_KEY = 'pending-dashboard-signup';

function readPendingSignup() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_DASHBOARD_SIGNUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const websiteUrl = String(parsed?.websiteUrl || '').trim();
    const ideaDescription = String(parsed?.ideaDescription || '').trim();
    if (!websiteUrl && !ideaDescription) return null;
    return { websiteUrl, ideaDescription };
  } catch {
    return null;
  }
}

function clearPendingSignup() {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(PENDING_DASHBOARD_SIGNUP_KEY); } catch {}
}

export default function DashboardRoute() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [showLoadingCard, setShowLoadingCard] = useState(true);
  const [dashboardContentReady, setDashboardContentReady] = useState(false);
  const [bgReady, setBgReady] = useState(false);
  // provisionStatus: 'checking' (gate decision pending) | 'provisioning' (auto-
  // provisioning from the sign-up URL) | 'gate' (no dashboard + no captured URL,
  // prompt for one) | 'ready' (has dashboard / admin → mount dashboard) |
  // 'error' (status check failed; retry instead of mounting a broken dashboard)
  const [provisionStatus, setProvisionStatus] = useState('checking');
  const [provisionError, setProvisionError] = useState('');
  const [showSignedOutFallback, setShowSignedOutFallback] = useState(false);
  // URL captured at sign-up — used to auto-provision, and to prefill the gate if
  // that auto-provision fails so the user never retypes it.
  const [pendingUrl, setPendingUrl] = useState('');
  const loadingOverlayRef = useRef(null);
  const handleDashboardContentReady = useCallback(() => {
    setDashboardContentReady(true);
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      // Deliberate logout → homepage. Direct unauthenticated visit → sign-in.
      let intentionalLogout = false;
      try {
        intentionalLogout = sessionStorage.getItem('intentionalLogout') === '1';
        if (intentionalLogout) sessionStorage.removeItem('intentionalLogout');
      } catch {}
      router.replace(intentionalLogout ? '/' : '/login?redirect=/dashboard');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (loading || user) {
      setShowSignedOutFallback(false);
      return undefined;
    }
    const timer = setTimeout(() => setShowSignedOutFallback(true), 1200);
    return () => clearTimeout(timer);
  }, [loading, user]);

  // Fade out the loading card only once three conditions are met:
  //   1. auth has resolved         (loading === false)
  //   2. the user is present       (!!user)
  //   3. the three.js canvas has rendered its first frame (bgReady)
  //   4. dashboard bootstrap + initial brief render have settled
  // The three.js background stays mounted in the parent tree, so no canvas swap.
  useEffect(() => {
    if (loading || !user || !bgReady || !dashboardContentReady) return;
    if (!loadingOverlayRef.current) return;
    const tween = gsap.to(loadingOverlayRef.current, {
      autoAlpha: 0,
      duration: 0.45,
      ease: 'power2.inOut',
      onComplete: () => setShowLoadingCard(false),
    });
    return () => tween.kill();
  }, [loading, user, bgReady, dashboardContentReady]);

  useEffect(() => {
    setDashboardContentReady(false);
    setShowLoadingCard(true);
    setProvisionStatus('checking');
  }, [user?.uid]);

  // Before processing the dashboard, confirm the user has an assigned dashboard.
  // If not (and they are not an admin), gate on the website-URL prompt.
  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/dashboard/provision-status', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setProvisionError(data?.error || 'Could not confirm your dashboard workspace.');
          setProvisionStatus('error');
          return;
        }
        const needsGate = !data.hasDashboard && !data.isAdmin;
        if (!needsGate) {
          setProvisionStatus('ready');
          return;
        }
        // No dashboard yet — but if the user already gave a URL at sign-up
        // (captured in sessionStorage), finish provisioning with it instead of
        // re-asking. The gate only appears when there's genuinely nothing to go on.
        const pending = readPendingSignup();
        if (!pending) {
          setProvisionStatus('gate');
          return;
        }
        setPendingUrl(pending.websiteUrl);
        setProvisionStatus('provisioning');
        try {
          const provRes = await fetch('/api/clients/provision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(pending),
          });
          const provData = await provRes.json().catch(() => ({}));
          if (cancelled) return;
          if (!provRes.ok) throw new Error(provData?.error || 'Provisioning failed.');
          clearPendingSignup();
          setProvisionStatus('ready');
        } catch {
          // Auto-provision failed — fall back to the manual gate, prefilled with
          // the captured URL so the user can retry without retyping it.
          if (!cancelled) setProvisionStatus('gate');
        }
      } catch {
        if (!cancelled) {
          setProvisionError('Could not confirm your dashboard workspace.');
          setProvisionStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user, loading]);

  const handleProvisioned = useCallback(() => {
    clearPendingSignup();
    setProvisionStatus('ready');
  }, []);

  const dashboardReady = !loading && !!user;

  // While auth resolves, render nothing — no "Opening Dashboard" gate flash
  // before the styled loading overlay. Only block once resolved AND signed out.
  if (loading) return null;
  // Signed out → the effect above redirects (intentional logout → homepage,
  // direct visit → /login). Render nothing so no "Sign in to open Dashboard"
  // gate card flashes during a normal redirect. If routing stalls, reveal a
  // minimal fallback instead of leaving a blank page.
  if (!user) {
    if (!showSignedOutFallback) return null;
    return (
      <main style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%)',
        color: '#1a1a1a',
        fontFamily: '"Space Grotesk", system-ui, -apple-system, sans-serif',
      }}>
        <section style={{
          width: 'min(100%, 420px)',
          display: 'grid',
          gap: 14,
          textAlign: 'center',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid #E4E4E4',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 12,
          padding: 24,
        }}>
          <span style={{ fontSize: 9, fontFamily: '"Space Mono", ui-monospace, monospace', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a8a8a', fontWeight: 700 }}>
            Dashboard
          </span>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.15, letterSpacing: 0 }}>
            Sign in to open Dashboard
          </h1>
          <p style={{ margin: 0, color: '#444', fontSize: 14, lineHeight: 1.55 }}>
            Client data and brief history live behind account access.
          </p>
          <a
            href="/login?redirect=/dashboard"
            style={{
              height: 40,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#2a2420',
              color: '#fff',
              borderRadius: 999,
              padding: '0 18px',
              fontSize: 13,
              fontFamily: '"Space Grotesk", system-ui, -apple-system, sans-serif',
              fontWeight: 700,
              textDecoration: 'none',
              margin: '0 auto',
            }}
          >
            Sign in
          </a>
        </section>
      </main>
    );
  }

  // Auto-provisioning from the URL captured at sign-up — no prompt, just a
  // brief "setting up" beat while the client is created.
  if (provisionStatus === 'provisioning') {
    return (
      <main style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%)',
        color: '#1a1a1a',
        fontFamily: '"Space Grotesk", system-ui, -apple-system, sans-serif',
      }}>
        <section style={{
          width: 'min(100%, 420px)',
          display: 'grid',
          gap: 12,
          textAlign: 'center',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid #E4E4E4',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 12,
          padding: 24,
        }}>
          <span style={{ fontSize: 9, fontFamily: '"Space Mono", ui-monospace, monospace', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a8a8a', fontWeight: 700 }}>
            Set up your workspace
          </span>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.15, letterSpacing: 0 }}>
            Setting up your dashboard…
          </h1>
          <p style={{ margin: 0, color: '#444', fontSize: 14, lineHeight: 1.55 }}>
            Building your first Creative Brief{pendingUrl ? <> from <strong>{pendingUrl}</strong></> : ''}. This only takes a moment.
          </p>
        </section>
      </main>
    );
  }

  // No assigned dashboard and no captured URL → prompt for a website URL before
  // any processing. Prefilled with the sign-up URL if an auto-provision failed.
  if (provisionStatus === 'gate') {
    return <WebsiteUrlGate user={user} initialUrl={pendingUrl} onProvisioned={handleProvisioned} />;
  }

  if (provisionStatus === 'error') {
    return (
      <main style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'linear-gradient(180deg,#fefdf9 0%,#fbf8f0 60%,#fdfaf2 100%)',
        color: '#1a1a1a',
        fontFamily: '"Space Grotesk", system-ui, -apple-system, sans-serif',
      }}>
        <section style={{
          width: 'min(100%, 420px)',
          display: 'grid',
          gap: 12,
          textAlign: 'center',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid #E4E4E4',
          boxShadow: '0 1px 2px rgba(0,0,0,0.04), inset 0 1px 0 rgba(255,255,255,0.6)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 12,
          padding: 24,
        }}>
          <span style={{ fontSize: 9, fontFamily: '"Space Mono", ui-monospace, monospace', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a8a8a', fontWeight: 700 }}>
            Dashboard
          </span>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.15, letterSpacing: 0 }}>
            Workspace check failed
          </h1>
          <p style={{ margin: 0, color: '#444', fontSize: 14, lineHeight: 1.55 }}>
            {provisionError || 'Could not confirm your dashboard workspace.'}
          </p>
          <button type="button" onClick={() => window.location.reload()} style={{
            height: 40,
            justifySelf: 'center',
            borderRadius: 999,
            border: '1px solid #d6d6d6',
            background: '#fff',
            padding: '0 18px',
            fontSize: 13,
            fontFamily: '"Space Grotesk", system-ui, -apple-system, sans-serif',
            fontWeight: 700,
            cursor: 'pointer',
          }}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <div style={{ minHeight: '100dvh', position: 'relative', overflow: 'hidden' }}>
      <InternalPageBackground onReady={() => setBgReady(true)} />

      {dashboardReady && provisionStatus === 'ready' ? (
        <div style={{
          opacity: showLoadingCard ? 0 : 1,
          transition: 'opacity 0.35s ease',
          pointerEvents: showLoadingCard ? 'none' : 'auto',
        }}>
          {/* entranceReady: dashboard entrance timeline starts only after the
              loading overlay's GSAP fade has fully completed */}
          <DashboardPage
            entranceReady={!showLoadingCard}
            onInitialContentReady={handleDashboardContentReady}
          />
        </div>
      ) : null}

      <DashboardLoadingOverlay
        dashboardReady={dashboardReady && dashboardContentReady}
        loadingOverlayRef={loadingOverlayRef}
        showLoadingCard={showLoadingCard}
      />
    </div>
  );
}
