'use client';

import InnerPageShell from './InnerPageShell';
import { internalPageGlassCardStyle } from './pageSurfaceSystem';

const cardStyle = {
  ...internalPageGlassCardStyle,
  borderRadius: '1rem',
  padding: 'clamp(1.25rem,2.5vw,2rem)',
};

const eyebrowStyle = {
  fontFamily: '"Space Mono", monospace',
  fontSize: '11px',
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'rgba(90,83,70,0.7)',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '0.75rem',
};

export default function ContactPage() {
  return (
    <InnerPageShell>
      {/* Hero */}
      <section
        id="contact-hero-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) max(10vw,calc((100% - 810px) / 2)) clamp(2.5rem,5vh,4rem)',
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid rgba(0,0,0,0.05)',
        }}
      >
        <span
          aria-hidden="true"
          id="contact-hero-sec-num"
          style={{
            position: 'absolute',
            top: '16px',
            right: 'clamp(1.25rem,4vw,3rem)',
            fontFamily: '"Doto", monospace',
            fontWeight: 900,
            fontSize: 'clamp(80px,14vw,220px)',
            color: 'transparent',
            WebkitTextStroke: '1.5px rgba(0,0,0,0.1)',
            lineHeight: 0.8,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          CT
        </span>

        <div className="inner-page-eyebrow" style={eyebrowStyle}>
          <span style={{ width: 6, height: 6, background: '#1a1a1a', borderRadius: '50%', display: 'inline-block' }} />
          Bryan Balli · Contact
        </div>

        <h1
          id="contact-hero-headline"
          style={{
            fontFamily: '"Doto", monospace',
            fontWeight: 900,
            letterSpacing: '-0.01em',
            lineHeight: 0.92,
            fontSize: 'clamp(52px,11vw,160px)',
            margin: '0 0 28px',
            textTransform: 'uppercase',
            color: '#0a0a0a',
          }}
        >
          Let's<br />Talk.
        </h1>

        <p
          id="contact-hero-sub"
          style={{
            fontFamily: '"Space Grotesk", sans-serif',
            fontWeight: 300,
            fontSize: 'clamp(1.1rem,2.2vw,1.65rem)',
            lineHeight: 1.3,
            color: '#1a1a1a',
            maxWidth: '52ch',
            margin: 0,
          }}
        >
          Book a 30-minute call, send a note, or start with the intake brief — whichever fits where you are right now.
        </p>
      </section>

      {/* Contact cards */}
      <section
        id="contact-cards-section"
        style={{
          padding: 'clamp(3rem,8vh,7rem) max(10vw,calc((100% - 810px) / 2)) clamp(2.5rem,5vh,4rem)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.25rem',
        }}
      >
        {/* Card 1 — Fastest Path */}
        <div id="contact-card-call" style={cardStyle}>
          <div style={eyebrowStyle}>
            <span style={{ width: 6, height: 6, background: 'rgba(90,83,70,0.5)', borderRadius: '50%', display: 'inline-block' }} />
            Fastest Path
          </div>
          <a
            href="https://calendly.com/bballi/30min"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: '"Doto", monospace',
              fontSize: 'clamp(2rem,4vw,3.5rem)',
              color: '#0a0a0a',
              textDecoration: 'none',
              display: 'block',
              marginBottom: '1rem',
              lineHeight: 1.1,
            }}
          >
            Book a 30-min call →
          </a>
          <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>
            Come with a question, come with a URL, or come with nothing — the intake brief will surface what matters most.
          </p>
        </div>

        {/* Card 2 — Send a Note */}
        <div id="contact-card-email" style={cardStyle}>
          <div style={eyebrowStyle}>
            <span style={{ width: 6, height: 6, background: 'rgba(90,83,70,0.5)', borderRadius: '50%', display: 'inline-block' }} />
            Send a Note
          </div>
          <a
            href="mailto:bryanballi@gmail.com"
            style={{
              fontFamily: '"Space Mono", monospace',
              fontSize: 'clamp(0.95rem,1.5vw,1.1rem)',
              color: '#0a0a0a',
              textDecoration: 'none',
              display: 'inline-block',
              border: '1px solid rgba(0,0,0,0.15)',
              borderRadius: '999px',
              padding: '0.5rem 1.25rem',
              marginBottom: '1rem',
            }}
          >
            bryanballi@gmail.com
          </a>
          <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>
            Best for: project briefs, collaboration proposals, speaking requests. Response within 24 hours on business days.
          </p>
        </div>

        {/* Card 3 — Working Hours */}
        <div id="contact-card-hours" style={cardStyle}>
          <div style={eyebrowStyle}>
            <span style={{ width: 6, height: 6, background: 'rgba(90,83,70,0.5)', borderRadius: '50%', display: 'inline-block' }} />
            Working Hours
          </div>
          <p style={{ fontFamily: '"Space Grotesk", sans-serif', fontWeight: 300, fontSize: 'clamp(0.9rem,1.3vw,1rem)', lineHeight: 1.7, color: 'rgba(26,26,26,0.8)', margin: 0 }}>
            Available beyond standard 9–5 to accommodate your flow state. Time zone: Central (Chicago). Response SLA: same business day for existing clients, 24 hours for new inquiries.
          </p>
        </div>
      </section>
    </InnerPageShell>
  );
}
