import React, { useEffect, useMemo, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { useAuth } from '../../AuthContext';
import { readToken } from '../../lib/theme-runtime/read-token.js';

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

// Stripe renders the PaymentElement in its own iframe, so CSS variables cannot reach it: resolve the
// theme tokens to real colours when the element mounts. The fallbacks are the light baseline values.
function buildStripeAppearance() {
  const text = readToken('--t-text') || '#2a2420';
  return {
    theme: 'stripe',
    variables: {
      colorPrimary: text,
      colorText: text,
      colorTextSecondary: readToken('--t-text-secondary') || 'rgba(42, 36, 32, 0.6)',
      colorBackground: readToken('--t-surface') || '#ffffff',
      borderRadius: '0.75rem',
      fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    },
    rules: {
      '.Input': {
        border: `1px solid ${readToken('--t-border-subtle') || 'rgba(42, 36, 32, 0.12)'}`,
        boxShadow: 'none',
      },
    },
  };
}

const PaymentStep = ({ onSuccess, ctaLabel = 'Subscribe · $5/mo', returnUrl }) => {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!stripe || !elements || submitting) {
      return;
    }
    setSubmitting(true);
    setError('');

    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl || `${window.location.origin}/?subscribed=1` },
      redirect: 'if_required',
    });

    if (result.error) {
      setError(result.error.message || 'Payment failed. Try another card.');
      setSubmitting(false);
      return;
    }

    onSuccess();
  };

  return (
    <form id="subscribe-payment-element-panel" onSubmit={handleSubmit} style={formStackStyle}>
      <PaymentElement />
      {error ? <p style={errorTextStyle}>{error}</p> : null}
      <div id="subscribe-payment-cta-row" style={ctaRowStyle}>
        <button type="submit" className="cta-pill-btn" style={primaryButtonStyle} disabled={submitting}>
          {submitting ? 'Processing…' : ctaLabel}
        </button>
        <button id="subscribe-meet-human-btn" type="button" style={meetHumanButtonStyle}>
          Meet with Human
        </button>
      </div>
    </form>
  );
};

const StripeBadge = () => (
  <div id="subscribe-stripe-badge" style={stripeBadgeStyle} aria-label="Powered by Stripe">
    <span>Powered by</span>
    <svg
      viewBox="0 0 60 25"
      width="42"
      height="18"
      fill="currentColor"
      role="img"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.04 1.26-.06 1.48zm-5.92-5.62c-1.03 0-2.17.73-2.17 2.58h4.25c0-1.85-1.07-2.58-2.08-2.58zM40.95 20.3c-1.44 0-2.32-.6-2.9-1.04l-.02 4.63-4.12.87V5.57h3.76l.08 1.02a4.7 4.7 0 0 1 3.23-1.29c2.9 0 5.62 2.6 5.62 7.4 0 5.23-2.7 7.6-5.65 7.6zM40 8.95c-.95 0-1.54.34-1.97.81l.02 6.12c.4.44.98.78 1.95.78 1.52 0 2.54-1.65 2.54-3.87 0-2.15-1.04-3.84-2.54-3.84zM28.24 5.57h4.13v14.44h-4.13V5.57zm0-4.7L32.37 0v3.36l-4.13.88V.88zm-4.32 9.35v9.79H19.8V5.57h3.7l.12 1.22c1-1.77 3.07-1.41 3.62-1.22v3.79c-.52-.17-2.29-.43-3.32.86zm-8.55 4.72c0 2.43 2.6 1.68 3.12 1.46v3.36c-.55.3-1.54.54-2.89.54a4.15 4.15 0 0 1-4.27-4.24l.01-13.17 4.02-.86v3.54h3.14V9.1h-3.13v5.85zm-4.91.7c0 2.97-2.31 4.66-5.73 4.66a11.2 11.2 0 0 1-4.46-.93v-3.93c1.38.75 3.1 1.31 4.46 1.31.92 0 1.53-.24 1.53-1C6.26 13.77 0 14.51 0 9.95 0 7.04 2.28 5.3 5.62 5.3c1.36 0 2.72.2 4.09.75v3.88a9.23 9.23 0 0 0-4.1-1.06c-.86 0-1.44.25-1.44.9 0 1.85 6.29.97 6.29 5.88z" />
    </svg>
  </div>
);

const SUBSCRIPTION_TIERS = [
  {
    id: 'weekly',
    num: '01',
    name: 'Weekly',
    sub: 'Executive + Market',
    priceMain: '$4',
    priceUnit: '/month',
    cadence: '1 brief a week sent to your email',
    replaces: 'One brief a week: competitor moves, trend signals, and a plain-English read on how your business appears online.',
  },
  {
    id: 'weekly-plus',
    num: '02',
    name: 'Weekly+',
    sub: 'Exec + Strategy',
    priceMain: '$19',
    priceUnit: '/month',
    cadence: '1 brief a week sent to your email',
    replaces: 'Trend and competitor tracking with 30 Days of Dynamic Content. Updating what to work on, post, and prioritize each week.',
  },
  {
    id: 'daily',
    num: '03',
    name: 'Daily',
    sub: 'Exec + Strategy',
    priceMain: '$39',
    priceUnit: '/month',
    cadence: '1 brief a day',
    replaces: 'Trend and competitor tracking with 30 Days of Dynamic Content. Updating what to work on, post, and prioritize each day.',
  },
  {
    id: 'continuous',
    num: '04',
    name: 'Continuous ★',
    sub: 'Full Brief System + Human Monitoring',
    priceMain: '$99',
    priceUnit: '/month',
    cadence: '2–3 briefs a day',
    replaces: 'Actively track your business, market, content, and site with a dedicated Human in the Loop managing the strategies.',
  },
  {
    id: 'studio',
    num: '05',
    name: 'Studio',
    sub: 'Creative Services',
    priceMain: '$1.5K',
    priceUnit: '/month',
    cadence: '3 briefs / day',
    replaces: 'A dedicated Human in the Loop running your system. Creative services on call. Design, content, and site fixes handled as they come up. Trend and competitor tracking.',
  },
];

const DEFAULT_TIER_INDEX = 0; // Weekly — $5/month

// One-time on-demand run price (display only — the server is the source of
// truth for the actual charge in /api/payments/create-payment-intent).
// Reasoning: the top tier is $99/mo for up to 3 briefs/day (~90/mo → ~$1.10
// per brief at max usage). $5 sits ~4.5× above that floor so a single run
// never undercuts subscribing, while staying impulse-friendly.
const RUN_PRICE_LABEL = '$5';

// Free tier = one brief every 30 days. The cooldown context reuses this to
// frame the countdown and clamp the reschedule picker.
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const pad2 = (n) => String(n).padStart(2, '0');

// Local datetime → the value/min format a <input type="datetime-local"> wants.
const toLocalInputValue = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// Human countdown for the cooldown panel: '29d 14h', '6h 12m', 'Available now'.
const formatRemainingLong = (seconds) => {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s <= 0) return 'Available now';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};

const SubscribeModal = ({
  open,
  onClose,
  defaultEmail = '',
  mode = 'subscribe',
  runBriefName = '',
  runBriefKey = '',
  onRunPaid,
  // When set ({ remainingSeconds, lastBriefMs }) the modal opens in the
  // free-tier cooldown context: countdown + reschedule picker above the
  // Subscribe / Run-Once tabs. Opens on the Run-Once tab by default.
  cooldown = null,
}) => {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(defaultEmail);
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cryptoNotice, setCryptoNotice] = useState('');
  const [tierIndex, setTierIndex] = useState(DEFAULT_TIER_INDEX);
  const [activeTab, setActiveTab] = useState(mode === 'run' || cooldown ? 'run' : 'subscribe');
  const [scheduleAt, setScheduleAt] = useState('');
  const [configuredTierIds, setConfiguredTierIds] = useState(null);
  const carouselRef = useRef(null);
  // Latest cooldown read without retriggering the open-reset effect every tick
  // (the parent re-renders this object each second as the countdown ticks).
  const cooldownRef = useRef(cooldown);
  cooldownRef.current = cooldown;
  const { user } = useAuth();
  const isSignedIn = Boolean(user);
  const isRunTab = activeTab === 'run';
  const isCooldown = Boolean(cooldown);

  // Unlock moment = 30 days after the last brief (or now + remaining as a
  // fallback). Anchors both the picker's min and its default value.
  const remainingSeconds = cooldown?.remainingSeconds || 0;
  const unlockMs = isCooldown
    ? (cooldown.lastBriefMs ? cooldown.lastBriefMs + THIRTY_DAYS_MS : Date.now() + remainingSeconds * 1000)
    : 0;
  const unlockInputValue = unlockMs ? toLocalInputValue(unlockMs) : '';

  // Free briefs stay 30 days apart — the picker can delay the next run, never
  // pull it earlier than the unlock moment.
  const handleScheduleChange = (event) => {
    const next = event.target.value;
    if (unlockInputValue && next && next < unlockInputValue) {
      setScheduleAt(unlockInputValue);
      return;
    }
    setScheduleAt(next);
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setStep('email');
      setClientSecret('');
      setError('');
      setLoading(false);
      setCryptoNotice('');
      setTierIndex(DEFAULT_TIER_INDEX);
      setConfiguredTierIds(null);
    } else {
      const cd = cooldownRef.current;
      setActiveTab(mode === 'run' || cd ? 'run' : 'subscribe');
      if (defaultEmail) setEmail(defaultEmail);
      if (cd) {
        const unlock = cd.lastBriefMs
          ? cd.lastBriefMs + THIRTY_DAYS_MS
          : Date.now() + (cd.remainingSeconds || 0) * 1000;
        setScheduleAt(toLocalInputValue(unlock));
      }
    }
  }, [open, defaultEmail, mode]);

  useEffect(() => {
    if (!open || activeTab === 'run') return undefined;
    let cancelled = false;
    fetch('/api/payments/subscription-tiers', { cache: 'no-store' })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (cancelled) return;
        const tiers = Array.isArray(data?.tiers) ? data.tiers.filter(Boolean) : [];
        setConfiguredTierIds(tiers.length ? new Set(tiers) : new Set(['weekly']));
        setTierIndex(0);
      })
      .catch(() => {
        if (!cancelled) {
          setConfiguredTierIds(new Set(['weekly']));
          setTierIndex(0);
        }
      });
    return () => { cancelled = true; };
  }, [open, activeTab]);

  // Land on the default tier (Weekly) when the modal opens.
  useEffect(() => {
    if (!open) return;
    const el = carouselRef.current;
    if (el) {
      el.scrollLeft = el.clientWidth * DEFAULT_TIER_INDEX;
    }
  }, [open]);

  // Resolved once per payment session: Elements must not receive a new appearance object every render.
  const stripeAppearance = useMemo(() => (clientSecret ? buildStripeAppearance() : null), [clientSecret]);

  if (!open) {
    return null;
  }

  const subscriptionTiers = configuredTierIds
    ? SUBSCRIPTION_TIERS.filter((tier) => configuredTierIds.has(tier.id))
    : [SUBSCRIPTION_TIERS[DEFAULT_TIER_INDEX]];
  const selectedTier = subscriptionTiers[Math.min(tierIndex, subscriptionTiers.length - 1)] || subscriptionTiers[0];

  // Carousel position == selected tier; whichever slide the user lands on is
  // what Continue to payment submits.
  const handleCarouselScroll = () => {
    const el = carouselRef.current;
    if (!el || !el.clientWidth) return;
    const next = Math.max(
      0,
      Math.min(subscriptionTiers.length - 1, Math.round(el.scrollLeft / el.clientWidth)),
    );
    if (next !== tierIndex) setTierIndex(next);
  };

  const scrollToTier = (index) => {
    const el = carouselRef.current;
    if (!el) return;
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' });
  };

  const startSubscription = async (event) => {
    event.preventDefault();
    if (loading) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/payments/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tier: selectedTier.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.clientSecret) {
        throw new Error(data.error || 'Could not start subscription.');
      }
      setClientSecret(data.clientSecret);
      setStep('payment');
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  // One-time on-demand brief run — single PaymentIntent, no subscription.
  const startOneTimeRun = async (event) => {
    event.preventDefault();
    if (loading) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/payments/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, briefKey: runBriefKey, briefName: runBriefName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.clientSecret) {
        throw new Error(data.error || 'Could not start the run.');
      }
      setClientSecret(data.clientSecret);
      setStep('payment');
    } catch (err) {
      setError(err.message || 'Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div id="subscribe-modal-overlay" data-tooltip-disabled="true" style={overlayStyle} onClick={onClose}>
      <div
        id="subscribe-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label="Monthly subscription"
        style={modalStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <style>{subscribeModalCss}</style>
        <div id="subscribe-header-row" style={headerRowStyle}>
          <img
            src="/img/profile2_400x400.png?v=1774582808"
            alt=""
            aria-hidden="true"
            style={headerLogoStyle}
          />
          <span style={headerLabelStyle}>Membership</span>
          <button
            type="button"
            id="subscribe-modal-close"
            onClick={onClose}
            aria-label="Close subscription modal"
          >[ ✕ ]</button>
        </div>
        <div id="subscribe-title-marquee-shell" style={marqueeShellStyle}>
          <div className="subscribe-title-marquee-track">
            {['a', 'b'].map((k) => (
              <span
                key={k}
                aria-hidden={k === 'b' ? 'true' : undefined}
                style={marqueeTitleStyle}
              >
                {isCooldown ? 'NEXT FREE BRIEF · ' : isRunTab ? 'ONE-TIME BRIEF RUN · ' : 'MONTHLY SUBSCRIPTION · '}
              </span>
            ))}
          </div>
        </div>

        {/* Free-tier cooldown context: time left + a reschedule picker that
            can delay (never shorten) the next free brief. Display-only for
            now — persistence lands with the scheduling worker. */}
        {isCooldown && step === 'email' ? (
          <div id="subscribe-cooldown-panel" style={cooldownPanelStyle}>
            <span style={cooldownEyebrowStyle}>Free tier · 1 brief / 30 days</span>
            <div style={cooldownCountRowStyle}>
              <span style={cooldownCountStyle}>{formatRemainingLong(remainingSeconds)}</span>
              <span style={cooldownCountSubStyle}>until your next free brief</span>
            </div>
            <label style={cooldownFieldLabelStyle} htmlFor="subscribe-cooldown-schedule">
              Schedule your next free brief
            </label>
            <input
              id="subscribe-cooldown-schedule"
              type="datetime-local"
              value={scheduleAt}
              min={unlockInputValue}
              onChange={handleScheduleChange}
              style={cooldownInputStyle}
            />
            <p style={cooldownHelpStyle}>
              Free briefs stay 30 days apart — you can delay your next run, not shorten the wait.
            </p>
          </div>
        ) : null}

        {/* Tab switch — only shown when opened from Run Briefs tab. */}
        {step === 'email' && mode === 'run' ? (
          <div id="subscribe-tab-row" role="tablist" aria-label="Payment type" style={tabRowStyle}>
            <button
              type="button"
              role="tab"
              aria-selected={!isRunTab}
              className={`subscribe-tab${!isRunTab ? ' subscribe-tab--active' : ''}`}
              onClick={() => setActiveTab('subscribe')}
            >
              Subscribe
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isRunTab}
              className={`subscribe-tab${isRunTab ? ' subscribe-tab--active' : ''}`}
              onClick={() => setActiveTab('run')}
            >
              Run Once
            </button>
          </div>
        ) : null}

        <div id="subscribe-modal-body" style={bodyStyle}>
          {!stripePromise ? (
            <p style={errorTextStyle}>
              Payments are not configured yet (missing publishable key).
            </p>
          ) : step === 'email' ? (
            <form onSubmit={isRunTab ? startOneTimeRun : startSubscription} style={formStackStyle}>
              {isRunTab ? (
                <div id="subscribe-run-panel" style={runPanelStyle}>
                  <span style={runPriceStyle}>
                    {RUN_PRICE_LABEL}
                    <span style={runPriceUnitStyle}>/run</span>
                  </span>
                  <p style={runCopyStyle}>
                    {runBriefName
                      ? `Run "${runBriefName}" once — sent to your email. No subscription.`
                      : 'A single brief, sent to your email. No subscription.'}
                  </p>
                </div>
              ) : (
              <div id="subscribe-tier-carousel-panel" style={productSummaryStyle}>
                <button
                  type="button"
                  id="subscribe-tier-prev"
                  className="subscribe-tier-nav"
                  onClick={() => scrollToTier(Math.max(0, tierIndex - 1))}
                  disabled={tierIndex === 0}
                  aria-label="Previous tier"
                >‹</button>
                <button
                  type="button"
                  id="subscribe-tier-next"
                  className="subscribe-tier-nav"
                  onClick={() => scrollToTier(Math.min(subscriptionTiers.length - 1, tierIndex + 1))}
                  disabled={tierIndex === subscriptionTiers.length - 1}
                  aria-label="Next tier"
                >›</button>
                <div
                  id="subscribe-tier-carousel"
                  className="subscribe-tier-carousel"
                  ref={carouselRef}
                  onScroll={handleCarouselScroll}
                >
                  {subscriptionTiers.map((tier) => (
                    <div className="subscribe-tier-slide" key={tier.id}>
                      <div style={productPriceColStyle}>
                        <span style={tier.priceMain.length > 5 ? productPriceLongStyle : productPriceStyle}>
                          {tier.priceMain}
                          {tier.priceUnit ? (
                            <span style={productPriceUnitStyle}>{tier.priceUnit}</span>
                          ) : null}
                        </span>
                      </div>
                      <div style={productSummaryTextStyle}>
                        <p style={productCopyStyle}>{tier.replaces}</p>
                        <p style={tierCadenceStyle}>{tier.cadence}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  id="subscribe-tier-dots"
                  style={tierDotsRowStyle}
                  role="tablist"
                  aria-label="Pricing tiers"
                >
                  {subscriptionTiers.map((tier, index) => (
                    <button
                      key={tier.id}
                      type="button"
                      role="tab"
                      aria-selected={index === tierIndex}
                      aria-label={`${tier.num} ${tier.name}`}
                      className={`subscribe-tier-dot${index === tierIndex ? ' subscribe-tier-dot--active' : ''}`}
                      onClick={() => scrollToTier(index)}
                    />
                  ))}
                </div>
              </div>
              )}
              <input
                type="email"
                required
                placeholder="Your email address"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                style={inputStyle}
              />
              {error ? <p style={errorTextStyle}>{error}</p> : null}
              <div id="subscribe-actions-row" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '0.6rem' }}>
                <button type="submit" className="cta-pill-btn" style={primaryButtonStyle} disabled={loading}>
                  {loading ? 'Setting up…' : 'Continue to payment'}
                </button>
                <div id="subscribe-below-cta-row" style={belowCtaRowStyle}>
                  <StripeBadge />
                  {/* Existing-user sign-in link — hidden once already signed in. */}
                  {!isSignedIn ? (
                    <a id="subscribe-signin-link" href="/login" style={signInLinkStyle}>
                      Sign In
                    </a>
                  ) : null}
                </div>
              </div>
            </form>
          ) : step === 'crypto' ? (
            <div id="subscribe-crypto-panel" style={formStackStyle}>
              <div>
                <span style={cryptoEyebrowStyle}>Solana · one-time</span>
                <p style={cryptoPriceStyle}>$60<span style={cryptoUnitStyle}> / 1 year</span></p>
                <p style={cryptoCopyStyle}>
                  Pay once in SOL or USDC. Full year, no recurring charge.
                </p>
              </div>
              <button
                id="subscribe-crypto-connect-btn"
                type="button"
                style={cryptoConnectButtonStyle}
                onClick={() => setCryptoNotice('Wallet connect lands in the next release.')}
              >
                ◎ Connect Solana Wallet
              </button>
              <button id="subscribe-crypto-pay-btn" type="button" style={cryptoPayButtonStyle} disabled>
                Pay in SOL / USDC
              </button>
              {cryptoNotice ? <p style={cryptoNoticeStyle}>{cryptoNotice}</p> : null}
              <button
                id="subscribe-crypto-back-link"
                type="button"
                onClick={() => { setCryptoNotice(''); setStep('email'); }}
                style={cryptoTriggerStyle}
              >
                ← Back to card payment
              </button>
            </div>
          ) : step === 'payment' && clientSecret ? (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: stripeAppearance }}>
              <PaymentStep
                ctaLabel={isRunTab ? `Pay ${RUN_PRICE_LABEL} · Run Brief` : `Subscribe · ${selectedTier.priceMain}${selectedTier.priceUnit}`}
                onSuccess={() => {
                  if (isRunTab) {
                    try { onRunPaid?.({ briefKey: runBriefKey, briefName: runBriefName }); } catch {}
                  }
                  setStep('success');
                }}
              />
            </Elements>
          ) : (
            <div style={formStackStyle}>
              <h3 style={successTitleStyle}>{isRunTab ? 'Run started.' : 'You’re in.'}</h3>
              <p style={summaryStyle}>
                {isRunTab
                  ? `Payment received for ${email}. ${runBriefName ? `"${runBriefName}" is` : 'Your brief is'} on the way — a receipt is in your inbox.`
                  : `Subscription active for ${email}. A receipt is on its way to your inbox.`}
              </p>
              <button type="button" className="cta-pill-btn" style={primaryButtonStyle} onClick={onClose}>
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 340,
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  background: 'color-mix(in srgb, var(--t-text) 18%, transparent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'clamp(1rem, 3vw, 2rem)',
  boxSizing: 'border-box',
};

const modalStyle = {
  position: 'relative',
  width: 'min(480px, 100%)',
  maxHeight: 'min(88dvh, 720px)',
  color: 'var(--t-text)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: 'var(--t-surface)',
  // Shadow + border match the dashboard loading card (DashboardLoadingOverlay).
  boxShadow: '0 1px 0 color-mix(in srgb, var(--t-surface) 65%, transparent), inset 0 1px 0 color-mix(in srgb, var(--t-surface) 40%, transparent), 0px 5px 10px rgba(0, 0, 0, 0.1), 0px 15px 30px rgba(0, 0, 0, 0.1), 0px 20px 40px rgba(0, 0, 0, 0.15)',
  border: '1px solid var(--t-dash-border)',
  borderRadius: '1.5rem',
};

// Keyframes, hover states, and the responsive product grid live here because
// inline styles can't express :hover or media queries.
const subscribeModalCss = `
  @keyframes subscribe-title-marquee {
    0%   { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  .subscribe-title-marquee-track {
    display: flex;
    align-items: center;
    width: max-content;
    animation: subscribe-title-marquee 12s linear infinite;
    will-change: transform;
  }
  #subscribe-modal-close {
    flex-shrink: 0;
    justify-self: end;
    background: color-mix(in srgb, var(--t-surface) 90%, transparent);
    border: 1px solid color-mix(in srgb, var(--t-text) 15%, transparent);
    border-radius: 6px;
    padding: 6px 12px;
    font-family: var(--font-mono, 'Space Mono', monospace);
    font-size: 12px;
    cursor: pointer;
    color: var(--t-text);
    white-space: nowrap;
  }
  #subscribe-modal-close:hover {
    background: var(--t-text);
    color: var(--t-surface);
  }
  .subscribe-tier-carousel {
    display: flex;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    margin: 0 1.75rem;
  }
  .subscribe-tier-carousel::-webkit-scrollbar {
    display: none;
  }
  .subscribe-tier-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
    width: 2rem;
    height: 2rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--t-text) 15%, transparent);
    background: color-mix(in srgb, var(--t-surface) 90%, transparent);
    color: var(--t-text);
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    font-family: var(--font-mono, 'Space Mono', monospace);
    padding: 0;
  }
  .subscribe-tier-nav:hover:not(:disabled) {
    background: var(--t-text);
    color: var(--t-surface);
  }
  .subscribe-tier-nav:disabled {
    opacity: 0.35;
    cursor: default;
  }
  #subscribe-tier-prev { left: 0.6rem; }
  #subscribe-tier-next { right: 0.6rem; }
  /* Two rows: price on top, description under it. */
  .subscribe-tier-slide {
    flex: 0 0 100%;
    min-width: 100%;
    box-sizing: border-box;
    scroll-snap-align: start;
    scroll-snap-stop: always;
    display: grid;
    grid-template-columns: 1fr;
    align-items: start;
    gap: 0.75rem;
  }
  .subscribe-tier-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    border: none;
    padding: 0;
    background: color-mix(in srgb, var(--t-text) 18%, transparent);
    cursor: pointer;
    transition: background 0.2s ease;
  }
  .subscribe-tier-dot--active {
    background: var(--t-text);
  }
  .subscribe-tab {
    flex: 1;
    border: none;
    background: transparent;
    padding: 0.55rem 0.75rem;
    border-radius: 999px;
    font-family: 'Space Mono', monospace;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--t-text) 50%, transparent);
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;
  }
  .subscribe-tab--active {
    background: var(--t-surface);
    color: var(--t-text);
    box-shadow: 0 1px 3px color-mix(in srgb, var(--t-text) 12%, transparent);
  }
`;

// Mirrors the dashboard loading card header: avatar left, mono label dead
// center, action right. 1fr/auto/1fr keeps the label centered regardless of
// the side elements' widths.
const headerRowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  gap: '0.75rem',
  padding: 'clamp(1.25rem, 5vw, 2rem) clamp(1.25rem, 5vw, 2rem) 0',
  flexShrink: 0,
};

const headerLogoStyle = {
  width: '2.75rem',
  height: '2.75rem',
  borderRadius: '50%',
  objectFit: 'cover',
  border: '2px solid color-mix(in srgb, var(--t-surface) 35%, transparent)',
  display: 'block',
  flexShrink: 0,
};

const headerLabelStyle = {
  fontSize: '0.82rem',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'color-mix(in srgb, var(--t-text) 44%, transparent)',
  fontWeight: 700,
  fontFamily: '"Space Mono", monospace',
};

// Side margins match the header/loading-card padding so the scrolling text
// clips inside the card gutter instead of running edge to edge.
const marqueeShellStyle = {
  overflow: 'hidden',
  margin: '0 clamp(1.25rem, 5vw, 2rem)',
  padding: '1rem 0 0.5rem',
  flexShrink: 0,
};

const marqueeTitleStyle = {
  margin: 0,
  flexShrink: 0,
  color: 'var(--t-text)',
  fontSize: 'clamp(2.2rem, 8vw, 3.6rem)',
  lineHeight: 1,
  letterSpacing: '-0.04em',
  fontFamily: "'Doto', 'Space Mono', monospace",
  fontWeight: 700,
  whiteSpace: 'nowrap',
};

const summaryStyle = {
  margin: '0.75rem 0 0',
  fontSize: '0.95rem',
  lineHeight: 1.6,
  color: 'color-mix(in srgb, var(--t-text) 70%, transparent)',
};

const bodyStyle = {
  overflowY: 'auto',
  padding:
    '0.75rem clamp(1.25rem, 2.5vw, 1.75rem) clamp(2rem, 4vw, 2.5rem)',
};

const formStackStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

const inputStyle = {
  width: '100%',
  minWidth: 0,
  borderRadius: '999px',
  border: '1px solid var(--t-border-subtle)',
  background: 'color-mix(in srgb, var(--t-surface) 28%, transparent)',
  color: 'var(--t-text)',
  padding: '0.85rem 1rem',
  fontSize: '0.92rem',
  boxSizing: 'border-box',
};

const primaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  width: '100%',
  boxSizing: 'border-box',
  border: 'none',
  textDecoration: 'none',
  background: 'linear-gradient(175deg, color-mix(in srgb, var(--t-surface) 18%, transparent) 0%, color-mix(in srgb, var(--t-surface) 0%, transparent) 52%), linear-gradient(135deg, var(--t-accent-bright) 0%, var(--t-support-1) 52%, var(--t-support-2) 100%)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 color-mix(in srgb, var(--t-surface) 28%, transparent), inset 0 -1px 0 rgba(0,0,0,0.1)',
  color: 'var(--t-surface)',
  borderRadius: '999px',
  padding: '0.85rem 1.25rem',
  fontSize: '0.875rem',
  fontWeight: 700,
  letterSpacing: '0.01em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

// Layout (grid columns + mobile collapse) lives in subscribeModalCss.
// Surface matches the dashboard card-grid shell (#capability-grid) with its
// soft pastel radial gradients.
const productSummaryStyle = {
  position: 'relative',
  padding: '1rem',
  borderRadius: '1rem',
  border: '1px solid var(--t-border-subtle)',
  background:
    'radial-gradient(60% 60% at 10% 15%, color-mix(in srgb, var(--t-deco-2) 12%, transparent), transparent 60%), radial-gradient(50% 50% at 82% 72%, color-mix(in srgb, var(--t-deco-4) 14%, transparent), transparent 65%), color-mix(in srgb, var(--t-surface) 45%, transparent)',
  boxShadow: '0 1px 0 color-mix(in srgb, var(--t-surface) 65%, transparent), inset 0 1px 0 color-mix(in srgb, var(--t-surface) 40%, transparent)',
};

const productSummaryTextStyle = {
  minWidth: 0,
  textAlign: 'center',
};

// Fixed row height = the full-size price line, so the description starts at
// the same y on every slide even when a long price renders smaller.
const productPriceColStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 'clamp(3.2rem, 12vw, 4.4rem)',
};

const productCopyStyle = {
  margin: '0 auto',
  maxWidth: '34ch',
  fontSize: '0.85rem',
  lineHeight: 1.45,
  color: 'color-mix(in srgb, var(--t-text) 65%, transparent)',
};

// Same size as the original single-product $5 — keeps the price-to-copy
// ratio. Long ranges (e.g. $99–$199) step down one notch so they still fit.
const productPriceStyle = {
  fontSize: 'clamp(3.2rem, 12vw, 4.4rem)',
  fontWeight: 900,
  letterSpacing: '-0.02em',
  lineHeight: 1,
  color: 'var(--t-text)',
  fontFamily: "'Doto', 'Space Mono', monospace",
  textAlign: 'center',
  whiteSpace: 'nowrap',
};

const productPriceLongStyle = {
  ...productPriceStyle,
  fontSize: 'clamp(2.2rem, 8.5vw, 3rem)',
};

const productPriceUnitStyle = {
  fontSize: '1.05rem',
  fontWeight: 700,
  letterSpacing: '0',
  color: 'color-mix(in srgb, var(--t-text) 75%, transparent)',
};

const tierCadenceStyle = {
  margin: '0.6rem 0 0',
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'color-mix(in srgb, var(--t-text) 55%, transparent)',
  fontFamily: '"Space Mono", monospace',
  textAlign: 'center',
};

const tierDotsRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  paddingTop: '0.65rem',
};

// Compact Run-Once panel — price + one-line copy side by side, no scrolling.
const runPanelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.9rem',
  padding: '0.85rem 1rem',
  borderRadius: '1rem',
  border: '1px solid var(--t-border-subtle)',
  background:
    'radial-gradient(60% 60% at 10% 15%, color-mix(in srgb, var(--t-deco-2) 12%, transparent), transparent 60%), radial-gradient(50% 50% at 82% 72%, color-mix(in srgb, var(--t-deco-4) 14%, transparent), transparent 65%), color-mix(in srgb, var(--t-surface) 45%, transparent)',
  boxShadow: '0 1px 0 color-mix(in srgb, var(--t-surface) 65%, transparent), inset 0 1px 0 color-mix(in srgb, var(--t-surface) 40%, transparent)',
};

const runPriceStyle = {
  flexShrink: 0,
  fontSize: 'clamp(2rem, 7vw, 2.6rem)',
  fontWeight: 900,
  letterSpacing: '-0.02em',
  lineHeight: 1,
  color: 'var(--t-text)',
  fontFamily: "'Doto', 'Space Mono', monospace",
  whiteSpace: 'nowrap',
};

const runPriceUnitStyle = {
  fontSize: '0.85rem',
  fontWeight: 700,
  color: 'color-mix(in srgb, var(--t-text) 60%, transparent)',
};

const runCopyStyle = {
  margin: 0,
  fontSize: '0.82rem',
  lineHeight: 1.4,
  color: 'color-mix(in srgb, var(--t-text) 65%, transparent)',
  textAlign: 'left',
};

const ctaRowStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: '0.75rem',
};

const meetHumanButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid transparent',
  background: 'linear-gradient(var(--t-surface), var(--t-surface)) padding-box, linear-gradient(135deg, var(--t-accent-bright) 0%, var(--t-support-1) 52%, var(--t-support-2) 100%) border-box',
  color: 'var(--t-text)',
  borderRadius: '999px',
  padding: '0.85rem 1.25rem',
  fontSize: '0.875rem',
  fontWeight: 700,
  letterSpacing: '0.01em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const errorTextStyle = {
  margin: 0,
  fontSize: '0.85rem',
  lineHeight: 1.5,
  color: 'var(--t-danger)',
};

const successTitleStyle = {
  margin: 0,
  fontSize: '1.4rem',
  letterSpacing: '-0.03em',
};

const stripeBadgeStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.35rem',
  fontSize: '0.75rem',
  color: 'color-mix(in srgb, var(--t-text) 45%, transparent)',
};

// Segmented Subscribe / Run-Once switch — sits in the card gutter, matching
// the header/marquee side padding so it doesn't widen the modal.
const tabRowStyle = {
  display: 'flex',
  gap: '0.35rem',
  margin: '1rem clamp(1.25rem, 5vw, 2rem) 0',
  padding: '0.3rem',
  borderRadius: '999px',
  background: 'color-mix(in srgb, var(--t-text) 6%, transparent)',
};

// Cooldown panel — same pastel-radial surface as the tier summary card, sat
// in the card gutter so it lines up with the marquee and tab row.
const cooldownPanelStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
  margin: '1rem clamp(1.25rem, 5vw, 2rem) 0',
  padding: '1rem 1.1rem 1.1rem',
  borderRadius: '1rem',
  border: '1px solid var(--t-border-subtle)',
  background:
    'radial-gradient(60% 60% at 10% 15%, color-mix(in srgb, var(--t-deco-2) 12%, transparent), transparent 60%), radial-gradient(50% 50% at 82% 72%, color-mix(in srgb, var(--t-deco-4) 14%, transparent), transparent 65%), color-mix(in srgb, var(--t-surface) 45%, transparent)',
  boxShadow: '0 1px 0 color-mix(in srgb, var(--t-surface) 65%, transparent), inset 0 1px 0 color-mix(in srgb, var(--t-surface) 40%, transparent)',
};

const cooldownEyebrowStyle = {
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'color-mix(in srgb, var(--t-text) 55%, transparent)',
  fontFamily: '"Space Mono", monospace',
};

const cooldownCountRowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.6rem',
  flexWrap: 'wrap',
};

const cooldownCountStyle = {
  fontFamily: "'Doto', 'Space Mono', monospace",
  fontWeight: 900,
  fontSize: 'clamp(2rem, 8vw, 2.8rem)',
  lineHeight: 1,
  letterSpacing: '-0.02em',
  color: 'var(--t-text)',
};

const cooldownCountSubStyle = {
  fontSize: '0.8rem',
  color: 'color-mix(in srgb, var(--t-text) 60%, transparent)',
};

const cooldownFieldLabelStyle = {
  marginTop: '0.2rem',
  fontSize: '0.72rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'color-mix(in srgb, var(--t-text) 55%, transparent)',
  fontFamily: '"Space Mono", monospace',
};

const cooldownInputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  borderRadius: '0.75rem',
  border: '1px solid var(--t-border-subtle)',
  background: 'color-mix(in srgb, var(--t-surface) 60%, transparent)',
  color: 'var(--t-text)',
  padding: '0.7rem 0.85rem',
  fontSize: '0.9rem',
  fontFamily: '"Space Mono", monospace',
};

const cooldownHelpStyle = {
  margin: 0,
  fontSize: '0.78rem',
  lineHeight: 1.5,
  color: 'color-mix(in srgb, var(--t-text) 60%, transparent)',
};

// Stripe badge left / existing-user sign-in right, under the CTA.
const belowCtaRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '1rem',
};

const signInLinkStyle = {
  fontSize: '0.72rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  fontFamily: '"Space Mono", monospace',
  color: 'color-mix(in srgb, var(--t-text) 60%, transparent)',
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
};

const cryptoTriggerStyle = {
  border: 'none',
  background: 'none',
  padding: 0,
  alignSelf: 'flex-start',
  fontSize: '0.78rem',
  letterSpacing: '0.02em',
  color: 'color-mix(in srgb, var(--t-text) 45%, transparent)',
  textDecoration: 'underline',
  textUnderlineOffset: '3px',
  cursor: 'pointer',
};

const cryptoEyebrowStyle = {
  display: 'block',
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'color-mix(in srgb, var(--t-text) 48%, transparent)',
  marginBottom: '0.35rem',
};

const cryptoPriceStyle = {
  margin: 0,
  fontSize: '1.5rem',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  color: 'var(--t-text)',
};

const cryptoUnitStyle = {
  fontSize: '0.85rem',
  fontWeight: 400,
  color: 'color-mix(in srgb, var(--t-text) 48%, transparent)',
};

const cryptoCopyStyle = {
  margin: '0.5rem 0 0',
  fontSize: '0.9rem',
  lineHeight: 1.6,
  color: 'color-mix(in srgb, var(--t-text) 70%, transparent)',
};

const cryptoConnectButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  border: '1px solid var(--t-border-subtle)',
  background: 'linear-gradient(135deg, rgba(153,69,255,0.12) 0%, rgba(20,241,149,0.12) 100%)',
  color: 'var(--t-text)',
  borderRadius: '999px',
  padding: '0.85rem 1.25rem',
  fontSize: '0.85rem',
  fontWeight: 700,
  letterSpacing: '0.02em',
  cursor: 'pointer',
};

const cryptoPayButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid color-mix(in srgb, var(--t-text) 10%, transparent)',
  background: 'color-mix(in srgb, var(--t-text) 6%, transparent)',
  color: 'color-mix(in srgb, var(--t-text) 40%, transparent)',
  borderRadius: '999px',
  padding: '0.85rem 1.25rem',
  fontSize: '0.85rem',
  fontWeight: 700,
  letterSpacing: '0.02em',
  cursor: 'not-allowed',
};

const cryptoNoticeStyle = {
  margin: 0,
  fontSize: '0.82rem',
  lineHeight: 1.5,
  color: 'color-mix(in srgb, var(--t-text) 55%, transparent)',
};

export default SubscribeModal;
