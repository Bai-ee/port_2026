import React, { useEffect, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

const stripeAppearance = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#2a2420',
    colorText: '#2a2420',
    colorTextSecondary: 'rgba(42, 36, 32, 0.6)',
    colorBackground: '#ffffff',
    borderRadius: '0.75rem',
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  rules: {
    '.Input': {
      border: '1px solid rgba(42, 36, 32, 0.12)',
      boxShadow: 'none',
    },
  },
};

const PaymentStep = ({ onSuccess }) => {
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
      confirmParams: { return_url: `${window.location.origin}/?subscribed=1` },
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
      <button type="submit" className="cta-pill-btn" style={primaryButtonStyle} disabled={submitting}>
        {submitting ? 'Processing…' : 'Subscribe · $5/mo'}
      </button>
    </form>
  );
};

const SubscribeModal = ({ open, onClose }) => {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    }
  }, [open]);

  if (!open) {
    return null;
  }

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
        body: JSON.stringify({ email }),
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

  return (
    <div id="subscribe-modal-overlay" style={overlayStyle} onClick={onClose}>
      <div
        id="subscribe-modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label="Monthly subscription"
        style={modalStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={topRowStyle}>
          <div>
            <span style={eyebrowStyle}>Membership</span>
            <h2 style={titleStyle}>Monthly Subscription</h2>
            <p style={summaryStyle}>$5/month. Cancel anytime.</p>
          </div>
          <button type="button" onClick={onClose} style={closeButtonStyle} aria-label="Close subscription modal">
            Close
          </button>
        </div>

        <div id="subscribe-modal-body" style={bodyStyle}>
          {!stripePromise ? (
            <p style={errorTextStyle}>
              Payments are not configured yet (missing publishable key).
            </p>
          ) : step === 'email' ? (
            <form onSubmit={startSubscription} style={formStackStyle}>
              <input
                type="email"
                required
                placeholder="Your email address"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                style={inputStyle}
              />
              {error ? <p style={errorTextStyle}>{error}</p> : null}
              <button type="submit" className="cta-pill-btn" style={primaryButtonStyle} disabled={loading}>
                {loading ? 'Setting up…' : 'Continue to payment'}
              </button>
            </form>
          ) : step === 'payment' && clientSecret ? (
            <Elements stripe={stripePromise} options={{ clientSecret, appearance: stripeAppearance }}>
              <PaymentStep onSuccess={() => setStep('success')} />
            </Elements>
          ) : (
            <div style={formStackStyle}>
              <h3 style={successTitleStyle}>You&rsquo;re in.</h3>
              <p style={summaryStyle}>
                Subscription active for {email}. A receipt is on its way to your inbox.
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
  background: 'rgba(42, 36, 32, 0.18)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'clamp(1rem, 3vw, 2rem)',
  boxSizing: 'border-box',
};

const modalStyle = {
  width: 'min(480px, 100%)',
  maxHeight: 'min(88dvh, 720px)',
  color: '#2a2420',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: '#ffffff',
  boxShadow: '0 32px 90px rgba(42,36,32,0.18)',
  borderRadius: '1.5rem',
};

const topRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1.5rem',
  padding: 'clamp(1.25rem, 2.5vw, 1.75rem)',
  borderBottom: '1px solid rgba(42, 36, 32, 0.1)',
};

const eyebrowStyle = {
  display: 'block',
  fontStyle: 'italic',
  fontSize: '0.85rem',
  color: 'rgba(42, 36, 32, 0.5)',
  marginBottom: '0.45rem',
};

const titleStyle = {
  margin: 0,
  fontSize: 'clamp(1.5rem, 2.4vw, 2.1rem)',
  lineHeight: 1,
  letterSpacing: '-0.04em',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const summaryStyle = {
  margin: '0.75rem 0 0',
  fontSize: '0.95rem',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.7)',
};

const closeButtonStyle = {
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.42)',
  color: '#2a2420',
  borderRadius: '999px',
  padding: '0.7rem 1rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  alignSelf: 'flex-start',
};

const bodyStyle = {
  overflowY: 'auto',
  padding: 'clamp(1.25rem, 2.5vw, 1.75rem)',
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
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.28)',
  color: '#2a2420',
  padding: '0.85rem 1rem',
  fontSize: '0.92rem',
  boxSizing: 'border-box',
};

const primaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.5rem',
  alignSelf: 'flex-start',
  border: 'none',
  textDecoration: 'none',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  color: '#ffffff',
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
  color: '#b3261e',
};

const successTitleStyle = {
  margin: 0,
  fontSize: '1.4rem',
  letterSpacing: '-0.03em',
};

export default SubscribeModal;
