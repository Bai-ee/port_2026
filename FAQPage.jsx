'use client';

import { useRef, useState } from 'react';
import InternalPageBackground from './InternalPageBackground';
import Header from './Header';
import { internalPageGlassCardStyle } from './pageSurfaceSystem';

const agencyLogos = [
  { src: '/img/agencies/publicis.png', alt: 'Publicis', scale: 2 },
  { src: '/img/agencies/epsilon.png', alt: 'Epsilon' },
  { src: '/img/agencies/conversant.png', alt: 'Conversant' },
  { src: '/img/agencies/alliance.png', alt: 'Alliance Data' },
];

const FAQS = [
  {
    id: 'what-is-an-ai-design-engineer',
    q: 'What is an AI design engineer?',
    a: 'An AI design engineer works at the intersection of software engineering, product design, and applied AI. The role covers building production-quality web experiences — using tools like Next.js, GSAP, and Three.js — while integrating AI workflows directly into the design and development pipeline. Instead of treating AI as a layer you add at the end, the work starts with AI: extracting brand signals, generating structured intake data, running SEO and performance audits, and surfacing the intelligence teams need to move faster. The result is a leaner team that ships with more confidence.',
  },
  {
    id: 'what-is-a-creative-technologist',
    q: 'What is a creative technologist?',
    a: 'A creative technologist sits between design strategy and front-end engineering. The role is responsible for making ideas technically real — prototyping interactions, building design systems, translating brand direction into production code, and identifying where automation or AI can compress timelines without sacrificing quality. Bryan Balli has held this role across agencies and independent engagements spanning San Francisco, Chicago, and remote international teams.',
  },
  {
    id: 'how-i-work',
    q: 'How does the intake process work?',
    a: 'A scraper runs against your site, extracting tone cues, offer clarity, audience signals, and performance data. That data is normalized against a brand/industry/model schema and delivered as a structured brief — covering positioning, competitor context, SEO baseline, and the highest-confidence next move. The intake runs without requiring calls or form fills on your end. You receive a brief you can act on immediately or bring into a scoped engagement.',
  },
  {
    id: 'typical-engagement',
    q: 'What does a typical engagement look like?',
    a: 'Most engagements start with a discovery call or an async intake brief. From there, the scope is phased: Phase 1 is always the smallest safe move — a working prototype, a design system snapshot, or a dashboard build. Approvals gate each phase. No sprawling roadmaps, no surprise pivots. Deliverables are reviewable at every step so direction changes stay cheap.',
  },
  {
    id: 'tech-stack',
    q: 'What is your tech stack?',
    a: 'Next.js · React · TypeScript · GSAP · Three.js · Tailwind CSS · Firebase · Vercel on the front end. Python for intake and scraping pipelines. Claude API (Anthropic) and OpenAI for intelligence layers. Playwright and Puppeteer for automated capture. Every tool is chosen for what the project actually needs — not for résumé surface area.',
  },
  {
    id: 'turnaround',
    q: 'How long does a project take?',
    a: 'A scoped web build runs 2–6 weeks depending on complexity. An intake brief with a dashboard prototype can be ready in under a week. Design system extraction from an existing brand: 3–5 days. Timelines are explicit at the start of each phase and do not shift without a conversation. If something is going to take longer, you hear it before it affects your schedule.',
  },
  {
    id: 'pricing',
    q: 'What does it cost to work with you?',
    a: 'Engagements start at $3,500 for a focused scope — intake, brief, and a working prototype. Ongoing retainers for dashboard maintenance, content pipeline updates, and SEO monitoring are available month-to-month. Custom projects are quoted by scope. Book a 30-minute call and you will have a real number specific to your situation within 24 hours.',
  },
  {
    id: 'early-stage',
    q: 'Do you work with early-stage startups?',
    a: 'Yes. Some of the most productive engagements are with early teams who need to move fast and stay lean. The intake pipeline is particularly useful pre-launch — it surfaces positioning gaps and performance baselines before you are committed to a stack or a brand direction. Early-stage work is scoped conservatively and priced accordingly.',
  },
  {
    id: 'client-intelligence-dashboard',
    q: 'What is a client intelligence dashboard?',
    a: 'A private, real-time surface that aggregates everything relevant to a client\'s digital presence: brand snapshot, SEO baseline, Lighthouse performance scores, social preview state, multi-device layout capture, and AI-generated content recommendations. It replaces the spreadsheet-and-email loop with a single source of truth that updates automatically. Clients access it without needing to request a report or schedule a call.',
  },
  {
    id: 'get-started',
    q: 'How do I get started?',
    a: 'Book a 30-minute call via the Contact link above. Come with a rough sense of what you are trying to fix — or come with nothing and let the intake brief surface what matters most. Either works. If a call is not the right first move, send a note to bryanballi@gmail.com with a brief description of the project and where you are stuck.',
  },
];

const navLinkStyle = {
  fontSize: 'clamp(0.82rem, 1.1vw, 0.9rem)',
  color: 'rgba(42,36,32,0.6)',
  textDecoration: 'none',
  cursor: 'pointer',
  lineHeight: 1.4,
};

const legalLinkStyle = {
  fontSize: '0.82rem',
  color: 'rgba(42,36,32,0.4)',
  textDecoration: 'none',
  cursor: 'pointer',
};

function FAQItem({ item, isOpen, onToggle }) {
  return (
    <div
      id={`faq-item-${item.id}`}
      style={{
        ...internalPageGlassCardStyle,
        borderRadius: '1rem',
        overflow: 'hidden',
        transition: 'box-shadow 0.2s ease',
      }}
    >
      <button
        id={`faq-trigger-${item.id}`}
        aria-expanded={isOpen}
        aria-controls={`faq-answer-${item.id}`}
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          padding: 'clamp(1rem, 2.5vw, 1.5rem) clamp(1.25rem, 3vw, 1.75rem)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{
          fontFamily: '"Space Grotesk", system-ui, sans-serif',
          fontSize: 'clamp(0.95rem, 1.6vw, 1.1rem)',
          fontWeight: 600,
          color: '#1a1a1a',
          lineHeight: 1.35,
        }}>
          {item.q}
        </span>
        <span
          aria-hidden="true"
          style={{
            flexShrink: 0,
            width: '1.75rem',
            height: '1.75rem',
            borderRadius: '50%',
            border: '1px solid rgba(0,0,0,0.12)',
            background: isOpen ? '#1a1a1a' : 'rgba(255,255,255,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.2s ease, transform 0.25s ease',
            transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
            fontSize: '1rem',
            color: isOpen ? '#fff' : '#1a1a1a',
            lineHeight: 1,
          }}
        >
          +
        </span>
      </button>

      <div
        id={`faq-answer-${item.id}`}
        role="region"
        aria-labelledby={`faq-trigger-${item.id}`}
        style={{
          maxHeight: isOpen ? '600px' : '0',
          overflow: 'hidden',
          transition: 'max-height 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <p style={{
          margin: 0,
          padding: '0 clamp(1.25rem, 3vw, 1.75rem) clamp(1rem, 2.5vw, 1.5rem)',
          fontFamily: '"Space Grotesk", system-ui, sans-serif',
          fontSize: 'clamp(0.88rem, 1.4vw, 1rem)',
          lineHeight: 1.7,
          color: 'rgba(26,26,26,0.75)',
        }}>
          {item.a}
        </p>
      </div>
    </div>
  );
}

export default function FAQPage() {
  const [openId, setOpenId] = useState(FAQS[0].id);
  const logoRef = useRef(null);

  const toggle = (id) => setOpenId((prev) => (prev === id ? null : id));

  return (
    <div id="faq-page-shell" style={{ minHeight: '100dvh', position: 'relative', background: 'rgba(254,253,249,1)' }}>
      <InternalPageBackground />

      <style>{`@keyframes agentMarquee { from { transform: translate3d(0,0,0); } to { transform: translate3d(-50%,0,0); } } @media (max-width: 767px) { #faq-hero-eyebrow { display: none; } }`}</style>

      {/* All content above the bg */}
      <div id="faq-page-content" style={{ position: 'relative', zIndex: 1 }}>

        <Header logoRef={logoRef} onOpenPage={null} />

        {/* Hero section */}
        <section
          id="faq-hero-section"
          style={{
            marginTop: '50px',
          padding: 'clamp(3rem, 8vh, 7rem) clamp(1.25rem, max(8vw, calc((100% - 1100px) / 2)), 12rem) clamp(2.5rem, 5vh, 4rem)',
            position: 'relative',
            overflow: 'hidden',
            borderBottom: '1px solid rgba(0,0,0,0.05)',
          }}
        >
          {/* Section watermark */}
          <span
            aria-hidden="true"
            id="faq-hero-sec-num"
            style={{
              position: 'absolute',
              top: '16px',
              right: 'clamp(1.25rem, 4vw, 3rem)',
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
            FAQ
          </span>

          <div id="faq-hero-eyebrow" style={{
            fontFamily: '"Space Mono", monospace',
            fontSize: '11px',
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'rgba(90,83,70,0.7)',
            display: 'flex',
            gap: '18px',
            alignItems: 'center',
            marginBottom: '24px',
          }}>
            <span style={{ width: 6, height: 6, background: '#1a1a1a', borderRadius: '50%', display: 'inline-block' }} />
            Bryan Balli
            <span>AI Design Engineer</span>
          </div>

          <h1 id="faq-hero-headline" style={{
            fontFamily: '"Doto", monospace',
            fontWeight: 900,
            letterSpacing: '-0.01em',
            lineHeight: 0.92,
            fontSize: 'clamp(52px,11vw,160px)',
            margin: '0 0 28px',
            textTransform: 'uppercase',
            color: '#0a0a0a',
          }}>
            Frequently<br />Asked.
          </h1>

          <p id="faq-hero-sub" style={{
            fontFamily: '"Space Grotesk", sans-serif',
            fontWeight: 300,
            fontSize: 'clamp(1.1rem,2.2vw,1.65rem)',
            lineHeight: 1.3,
            color: '#1a1a1a',
            maxWidth: '52ch',
            margin: 0,
          }}>
            What an AI design engineer does, how engagements work, what things cost, and how to get started — answered directly.
          </p>
        </section>

        {/* FAQ accordion section */}
        <section
          id="faq-accordion-section"
          style={{
            padding: 'clamp(3rem, 6vh, 5rem) clamp(1.25rem, max(8vw, calc((100% - 1100px) / 2)), 12rem)',
          }}
        >
          <div id="faq-accordion-list" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {FAQS.map((item) => (
              <FAQItem
                key={item.id}
                item={item}
                isOpen={openId === item.id}
                onToggle={() => toggle(item.id)}
              />
            ))}
          </div>
        </section>

        {/* Footer — matches homepage inline footer pattern */}
        <footer
          id="faq-inline-footer"
          style={{
            width: '100%',
            padding: 'clamp(2.5rem, 5vw, 4.5rem) clamp(1.25rem, max(8vw, calc((100% - 1100px) / 2)), 12rem) clamp(3rem, 6vw, 5rem)',
            boxSizing: 'border-box',
            borderTop: '1px solid rgba(42,36,32,0.08)',
          }}
        >
          {/* Value block — centred, matches homepage layout */}
          <div id="faq-footer-value-block" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 'clamp(1rem, 2vw, 1.55rem)',
            textAlign: 'center',
            width: '100%',
            maxWidth: '46rem',
            margin: '0 auto',
          }}>
            {/* Marquee */}
            <div id="faq-footer-marquee-shell" style={{
              width: '100%',
              overflow: 'hidden',
              marginBottom: 'clamp(24px, 5vw, 75px)',
              maskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 5%, black 95%, transparent 100%)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform', animation: 'agentMarquee 28s linear infinite' }}>
                {['a', 'b'].map((k) => (
                  <div key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '3rem', paddingRight: '3rem', flexShrink: 0 }}>
                    <span style={{ fontFamily: "'Doto', 'Space Mono', monospace", fontSize: 'clamp(1.6rem, 8.5vw, 7rem)', letterSpacing: '-0.02em', fontWeight: 700, lineHeight: 1.05, color: '#2a2420', whiteSpace: 'nowrap' }}>CONTACT • CONTACT •</span>
                  </div>
                ))}
              </div>
            </div>

            <img src="/img/sig.png" alt="Bryan Balli signature" style={{ width: 'min(110px, 31vw)', height: 'auto', display: 'block' }} />

            <blockquote style={{ margin: 'clamp(1rem, 2vw, 1.5rem) 0', padding: 'clamp(1rem, 2vw, 1.5rem) clamp(1.25rem, 3vw, 2rem)', borderLeft: '3px solid rgba(42,36,32,0.15)', fontSize: 'clamp(1.35rem, 1.85vw, 1.65rem)', lineHeight: 1.55, color: 'rgba(42,36,32,0.72)', fontStyle: 'italic', fontFamily: "'Space Grotesk', system-ui, sans-serif", textAlign: 'left' }}>
              "Get all the high-impact deliverables needed to launch digital products and integrate automation into daily operations."
            </blockquote>

            <p style={{ margin: 0, fontSize: 'clamp(0.7rem, 1.4vw, 0.91rem)', lineHeight: 1.6, fontWeight: 400, textAlign: 'left', color: 'rgba(42,36,32,0.8)', width: '100%' }}>
              <strong>Bryan Balli</strong> leads a team across design and engineering as a Creative Technologist, with experience spanning agencies in Chicago, San Francisco, and remote teams. I'm ready to step into your process, see what's working, fix what's not, and build what's missing across design, content, and systems.
            </p>

            <a
              id="faq-cta-btn"
              href="https://calendly.com/bballi/30min"
              target="_blank"
              rel="noopener noreferrer"
              className="cta-pill-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.75rem',
                lineHeight: 1,
                fontSize: 'clamp(0.8rem, 1.1vw, 0.875rem)',
                fontWeight: 700,
                letterSpacing: '0.01em',
                textDecoration: 'none',
                color: '#ffffff',
                background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
                borderRadius: '999px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
                whiteSpace: 'nowrap',
                marginTop: '20px',
                marginBottom: '20px',
              }}
            >
              <img src="/img/profile2_400x400.png?v=1774582808" alt="" aria-hidden="true" style={{ width: '1.75rem', height: '1.75rem', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.35)', flexShrink: 0, display: 'block' }} />
              Meet with Bryan
              <span aria-hidden="true" style={{ fontSize: '0.7rem', opacity: 0.75, marginLeft: '0.1rem' }}>↗</span>
            </a>

            {/* Agency logo marquee */}
            <div id="faq-agency-marquee-shell" style={{
              width: '100%',
              maxWidth: '325px',
              overflow: 'hidden',
              maskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', width: 'max-content', willChange: 'transform', animation: 'agentMarquee 18s linear infinite' }}>
                {['a', 'b'].map((k) => (
                  <div key={k} aria-hidden={k === 'b' ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: '2rem', paddingRight: '2rem', flexShrink: 0 }}>
                    {agencyLogos.map((logo) => (
                      <img
                        key={logo.alt}
                        src={logo.src}
                        alt={k === 'a' ? logo.alt : ''}
                        style={{ height: logo.scale ? `${22 * logo.scale}px` : '22px', width: 'auto', display: 'block', opacity: 0.45, filter: 'grayscale(1)', flexShrink: 0 }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* SEO nav grid */}
          <nav id="faq-footer-seo-nav" aria-label="Site navigation" style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'clamp(2rem, 5vw, 4rem)',
            padding: 'clamp(2rem, 4vw, 3rem) 0',
            borderTop: '1px solid rgba(42,36,32,0.1)',
            marginTop: '50px',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', flex: '1 1 120px' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.35)', marginBottom: '0.2rem' }}>Work</span>
              <a href="#" style={navLinkStyle}>Featured Projects</a>
              <a href="#" style={navLinkStyle}>Case Studies</a>
              <a href="#" style={navLinkStyle}>Process</a>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', flex: '1 1 120px' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.35)', marginBottom: '0.2rem' }}>Services</span>
              <a href="/services/ai-design-consulting" style={navLinkStyle}>AI Design Consulting</a>
              <a href="/services/web-development" style={navLinkStyle}>Web Development</a>
              <a href="/services/brand-identity" style={navLinkStyle}>Brand Identity</a>
              <a href="/services/design-systems" style={navLinkStyle}>Design Systems</a>
              <a href="/services/seo-geo" style={navLinkStyle}>SEO &amp; GEO</a>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', flex: '1 1 120px' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.35)', marginBottom: '0.2rem' }}>FAQ</span>
              <a href="/faq#what-is-a-creative-technologist" style={navLinkStyle}>What Is a Creative Technologist?</a>
              <a href="/faq#ai-design-engineer" style={navLinkStyle}>What Is an AI Design Engineer?</a>
              <a href="/faq#how-i-work" style={navLinkStyle}>How I Work</a>
              <a href="/faq#pricing" style={navLinkStyle}>Pricing &amp; Engagements</a>
              <a href="/faq#turnaround" style={navLinkStyle}>Turnaround &amp; Availability</a>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', flex: '1 1 120px' }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.35)', marginBottom: '0.2rem' }}>Company</span>
              <a href="#" style={navLinkStyle}>About</a>
              <a href="#" style={navLinkStyle}>How It Works</a>
              <a href="#" style={navLinkStyle}>Contact</a>
              <a href="https://calendly.com/bballi/30min" target="_blank" rel="noopener noreferrer" style={navLinkStyle}>Book a Call</a>
            </div>
          </nav>

          {/* Bottom bar */}
          <div id="faq-footer-bottom" style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
            paddingTop: 'clamp(1rem, 2vw, 1.5rem)',
            borderTop: '1px solid rgba(42,36,32,0.1)',
          }}>
            <span style={{ fontSize: '0.78rem', color: 'rgba(42,36,32,0.35)' }}>© 2026 Bryan Balli · All rights reserved</span>
            <div style={{ display: 'flex', gap: '1.5rem' }}>
              <a href="https://www.linkedin.com/in/bryanballi" style={legalLinkStyle}>LinkedIn</a>
              <a href="https://x.com/bai_ee" style={legalLinkStyle}>𝕏</a>
              <a href="#" style={legalLinkStyle}>Privacy</a>
              <a href="#" style={legalLinkStyle}>Terms</a>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
