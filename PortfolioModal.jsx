import React, { useEffect, useMemo, useRef } from 'react';
import {
  benefits,
  plans,
  portfolioPageMap,
  portfolioPages,
  processSteps,
  testimonials,
  workHistory,
} from './portfolioContent';

const detailPageIds = ['value', 'experience', 'clients', 'engage', 'contact'];
const detailPages = portfolioPages.filter((page) => detailPageIds.includes(page.id));

const glassPanelStyle = {
  background: '#ffffff',
  boxShadow: '0 32px 90px rgba(42,36,32,0.18)',
  borderRadius: '1.5rem',
};

const renderPageBody = (pageId) => {
  if (pageId === 'work') {
    return (
      <div style={gridStyle}>
        {[
          {
            name: 'Launch Surfaces',
            desc: 'Marketing pages and campaign systems that preserve the original visual intent through production.',
          },
          {
            name: 'Interactive Product Stories',
            desc: 'Narrative web experiences that explain complex systems without flattening them into generic SaaS copy.',
          },
          {
            name: 'Human-AI Workflows',
            desc: 'Operational layers where AI output is useful, but a human still owns final quality and decision making.',
          },
        ].map((item) => (
          <article key={item.name} style={featureCardStyle}>
            <span style={eyebrowStyle}>Project Type</span>
            <h3 style={cardTitleStyle}>{item.name}</h3>
            <p style={copyStyle}>{item.desc}</p>
          </article>
        ))}
      </div>
    );
  }

  if (pageId === 'value') {
    return (
      <div style={stackStyle}>
        {benefits.map((item) => (
          <article key={item.index} style={listCardStyle}>
            <span style={indexStyle}>{item.index}</span>
            <div style={listBodyStyle}>
              <h3 style={cardTitleStyle}>{item.title}</h3>
              <span style={tagStyle}>{item.tag}</span>
            </div>
          </article>
        ))}
      </div>
    );
  }

  if (pageId === 'experience') {
    return (
      <div style={stackStyle}>
        {workHistory.map((item) => (
          <article key={item.years + item.role} style={timelineCardStyle}>
            <span style={yearStyle}>{item.years}</span>
            <div style={listBodyStyle}>
              <h3 style={cardTitleStyle}>{item.role}</h3>
              <p style={metaStyle}>{item.company} · {item.type}</p>
              <p style={copyStyle}>{item.desc}</p>
            </div>
          </article>
        ))}
      </div>
    );
  }

  if (pageId === 'clients') {
    return (
      <div style={stackStyle}>
        {testimonials.map((item) => (
          <article key={item.name} style={quoteCardStyle}>
            <p style={quoteStyle}>&ldquo;{item.quote}&rdquo;</p>
            <p style={metaStyle}>{item.name} · {item.title}, {item.company}</p>
          </article>
        ))}
      </div>
    );
  }

  if (pageId === 'engage') {
    return (
      <div style={stackStyle}>
        <div style={gridStyle}>
          {processSteps.map((item) => (
            <article key={item.step} style={featureCardStyle}>
              <span style={indexStyle}>{item.step}</span>
              <h3 style={cardTitleStyle}>{item.title}</h3>
              <p style={copyStyle}>{item.desc}</p>
            </article>
          ))}
        </div>
        <div style={gridStyle}>
          {plans.map((plan) => (
            <article key={plan.name} style={featureCardStyle}>
              <span style={eyebrowStyle}>{plan.badge}</span>
              <h3 style={cardTitleStyle}>{plan.name}</h3>
              <p style={priceStyle}>{plan.price}{plan.unit ? <span style={unitStyle}>{plan.unit}</span> : null}</p>
              <p style={copyStyle}>{plan.desc}</p>
              <a
                className="cta-pill-btn"
                style={primaryButtonStyle}
                href="https://calendly.com/bballi/30min"
                target="_blank"
                rel="noopener noreferrer"
              >
                <img src="/img/profile2_400x400.png?v=1774582808" style={avatarStyle} alt="Bryan Balli, AI design engineer and creative technologist" />
                {plan.cta}
                <span style={btnIconStyle}>↗</span>
              </a>
            </article>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={stackStyle}>
      <article style={featureCardStyle}>
        <span style={eyebrowStyle}>Direct line</span>
        <h3 style={cardTitleStyle}>Book a Call</h3>
        <p style={copyStyle}>Book a free intro call and I will come prepared with concrete feedback on scope and next steps.</p>
        <a
          href="#"
          className="cta-pill-btn"
          style={primaryButtonStyle}
          data-cal-link="bryan-balli-5w12w7/30min"
          data-cal-namespace="30min"
          data-cal-config='{"layout":"month_view","useSlotsViewOnSmallScreen":"true"}'
        >
          <img src="/img/profile2_400x400.png?v=1774582808" style={avatarStyle} alt="Bryan Balli, AI design engineer and creative technologist" />
          Book a Call
          <span style={btnIconStyle}>↗</span>
        </a>
      </article>
      <article style={featureCardStyle}>
        <span style={eyebrowStyle}>Fastest path</span>
        <h3 style={cardTitleStyle}>Text Bryan</h3>
        <p style={copyStyle}>Send a text with rough ideas, screenshots, or a voice note. No polished brief required.</p>
        <a href="sms:+13122865129&body=Hey Bryan, I have some ideas I'd like your feedback on." style={secondaryButtonStyle}>
          Text Bryan
        </a>
      </article>
      <article style={featureCardStyle}>
        <span style={eyebrowStyle}>Stay In Touch</span>
        <h3 style={cardTitleStyle}>Updates on projects and tools</h3>
        <div style={newsletterFormStyle}>
          <input type="email" placeholder="Your email address" style={inputStyle} />
          <button type="button" className="cta-pill-btn" style={primaryButtonStyle}>
            <img src="/img/profile2_400x400.png?v=1774582808" style={avatarStyle} alt="Bryan Balli, AI design engineer and creative technologist" />
            Subscribe
          </button>
        </div>
      </article>
    </div>
  );
};

const PortfolioModal = ({ activePageId, onClose, onOpenPage }) => {
  const page = useMemo(() => {
    if (!activePageId || !detailPageIds.includes(activePageId)) {
      return null;
    }

    return portfolioPageMap[activePageId];
  }, [activePageId]);
  const bodyRef = useRef(null);

  useEffect(() => {
    if (!page) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown);

    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, page]);

  if (!page) {
    return null;
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, ...glassPanelStyle }} onClick={(event) => event.stopPropagation()}>
        <div style={modalTopStyle}>
          <div>
            <span style={modalEyebrowStyle}>{page.eyebrow}</span>
            <h2 style={modalTitleStyle}>{page.title}</h2>
            <p style={modalSummaryStyle}>{page.summary}</p>
          </div>
          <button type="button" onClick={onClose} style={closeButtonStyle} aria-label="Close page">
            Close
          </button>
        </div>
        <div style={tabsWrapStyle}>
          {detailPages.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenPage(item.id)}
              style={{
                ...tabButtonStyle,
                ...(item.id === page.id ? activeTabButtonStyle : null),
              }}
            >
              {item.navLabel}
            </button>
          ))}
        </div>
        <div ref={bodyRef} style={modalBodyStyle}>
          {renderPageBody(page.id)}
        </div>
      </div>
    </div>
  );
};

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 320,
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'clamp(1rem, 3vw, 2rem)',
  boxSizing: 'border-box',
};

const modalStyle = {
  width: 'min(1080px, 100%)',
  maxHeight: 'min(88dvh, 980px)',
  color: '#2a2420',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const modalTopStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '1.5rem',
  padding: 'clamp(1.25rem, 2.5vw, 2rem)',
  borderBottom: '1px solid rgba(42, 36, 32, 0.1)',
};

const modalEyebrowStyle = {
  display: 'block',
  fontStyle: 'italic',
  fontSize: 'clamp(0.8rem, 1.1vw, 0.95rem)',
  color: 'rgba(42, 36, 32, 0.5)',
  marginBottom: '0.45rem',
};

const modalTitleStyle = {
  margin: 0,
  fontSize: 'clamp(1.8rem, 3vw, 3.2rem)',
  lineHeight: 1,
  letterSpacing: '-0.04em',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const modalSummaryStyle = {
  margin: '0.75rem 0 0',
  maxWidth: '52ch',
  fontSize: 'clamp(0.9rem, 1.2vw, 1rem)',
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

const tabsWrapStyle = {
  display: 'flex',
  gap: '0.6rem',
  padding: '0.9rem clamp(1.25rem, 2.5vw, 2rem)',
  overflowX: 'auto',
  borderBottom: '1px solid rgba(42, 36, 32, 0.1)',
};

const tabButtonStyle = {
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.32)',
  color: 'rgba(42, 36, 32, 0.72)',
  borderRadius: '999px',
  padding: '0.65rem 0.9rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const activeTabButtonStyle = {
  background: '#2a2420',
  color: '#f5f1df',
};

const modalBodyStyle = {
  overflowY: 'auto',
  padding: 'clamp(1.25rem, 2.5vw, 2rem)',
};

const stackStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
};

const gridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '1rem',
};

const featureCardStyle = {
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.18)',
  borderRadius: '1rem',
  padding: '1.25rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
  boxSizing: 'border-box',
};

const listCardStyle = {
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
  padding: '1rem 0',
  display: 'grid',
  gridTemplateColumns: '3rem 1fr',
  gap: '1rem',
};

const timelineCardStyle = {
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
  padding: '1rem 0',
  display: 'grid',
  gridTemplateColumns: 'minmax(6rem, 8rem) 1fr',
  gap: '1rem',
};

const quoteCardStyle = {
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.16)',
  borderRadius: '1rem',
  padding: '1.25rem',
};

const listBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
  minWidth: 0,
};

const eyebrowStyle = {
  fontSize: '0.75rem',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.48)',
};

const cardTitleStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 1.8vw, 1.5rem)',
  lineHeight: 1.1,
  letterSpacing: '-0.03em',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const copyStyle = {
  margin: 0,
  fontSize: '0.94rem',
  lineHeight: 1.65,
  color: 'rgba(42, 36, 32, 0.72)',
};

const quoteStyle = {
  margin: 0,
  fontSize: '1rem',
  lineHeight: 1.7,
  color: '#2a2420',
};

const metaStyle = {
  margin: 0,
  fontSize: '0.82rem',
  lineHeight: 1.5,
  color: 'rgba(42, 36, 32, 0.48)',
};

const indexStyle = {
  fontSize: '0.75rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'rgba(42, 36, 32, 0.42)',
  textTransform: 'uppercase',
};

const tagStyle = {
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.42)',
};

const yearStyle = {
  fontSize: '0.78rem',
  letterSpacing: '0.04em',
  color: 'rgba(42, 36, 32, 0.42)',
  paddingTop: '0.2rem',
};

const priceStyle = {
  margin: 0,
  fontSize: '1.5rem',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  color: '#2a2420',
};

const unitStyle = {
  fontSize: '0.85rem',
  fontWeight: 400,
  color: 'rgba(42, 36, 32, 0.48)',
  marginLeft: '0.2rem',
};

const avatarStyle = {
  width: '1.75rem',
  height: '1.75rem',
  borderRadius: '50%',
  objectFit: 'cover',
  border: '2px solid rgba(255,255,255,0.35)',
  flexShrink: 0,
  display: 'block',
};

const primaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  alignSelf: 'flex-start',
  textDecoration: 'none',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  color: '#ffffff',
  borderRadius: '999px',
  padding: '0.25rem 0.75rem 0.25rem 0.25rem',
  fontSize: '0.875rem',
  fontWeight: 700,
  letterSpacing: '0.01em',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const btnIconStyle = {
  fontSize: '0.7rem',
  opacity: 0.75,
  marginLeft: '0.1rem',
};

const secondaryButtonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  alignSelf: 'flex-start',
  textDecoration: 'none',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  background: 'rgba(255,255,255,0.28)',
  color: '#2a2420',
  borderRadius: '999px',
  padding: '0.75rem 1rem',
  fontSize: '0.78rem',
  fontWeight: 700,
  letterSpacing: '0.04em',
};

const newsletterFormStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  gap: '0.75rem',
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

export default PortfolioModal;
