import React, { useLayoutEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const slides = [
  {
    title: 'Section 1',
    bg: '#f5f1df',
    fg: '#2a2420',
    layout: 'grid',
    headlineText: 'Your Human in the Loop',
    supportText: 'Chat with Bryan',
    gridItems: Array(9).fill(null).map((_, i) => ({ id: i })),
    serviceItems: Array(3).fill(null).map((_, i) => ({ id: i })),
  },
];

const StackedSlidesSection = () => {
  const wrapperRef = useRef(null);

  useLayoutEffect(() => {
    if (!wrapperRef.current) return;
    const wrapper = wrapperRef.current;

    const ctx = gsap.context(() => {
      const panel = wrapper.querySelector('[data-stack-panel]');
      if (!panel) return;
      const innerPanel = panel.querySelector('[data-stack-inner]');
      if (!innerPanel) return;

      const gridEl = panel.querySelector('[data-grid-inner]');
      const gridWindowEl = panel.querySelector('[data-grid-window]');
      if (!gridEl || !gridWindowEl) return;

      if (gridEl.scrollHeight <= 0) return;

      gsap.timeline({
        scrollTrigger: {
          trigger: panel,
          start: 'top top+=64',
          end: () => `+=${gridEl.scrollHeight}`,
          pin: true,
          pinSpacing: true,
          scrub: 1,
          invalidateOnRefresh: true,
          onToggle: (self) => {
            panel.style.borderRadius = self.isActive ? '0' : '1rem';
          },
        },
      }).to(gridEl, { y: () => -gridEl.scrollHeight, ease: 'none' });
    }, wrapper);

    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener('resize', refresh);

    return () => {
      window.removeEventListener('resize', refresh);
      ctx.revert();
    };
  }, []);

  return (
    <section style={sectionStyle}>
      <div ref={wrapperRef} style={wrapperStyle}>
        {slides.map((slide, index) => (
          <section
            key={slide.title}
            data-stack-panel
            style={{
              ...panelStyle,
              height: index === 0 ? 'calc(2 * (100vh - 64px))' : panelStyle.height,
              background: index === 0 ? 'rgba(245, 241, 223, 0.18)' : slide.bg,
              backdropFilter: index === 0 ? 'blur(24px)' : 'none',
              WebkitBackdropFilter: index === 0 ? 'blur(24px)' : 'none',
              boxShadow: index === 0 ? 'inset 0 0 0 1px rgba(255,255,255,0.45), inset 0 1px 0 rgba(255,255,255,0.6)' : 'none',
              color: slide.fg,
            }}
          >
            <div style={contentStyle}>
              <div data-stack-inner style={innerStyle}>
                {slide.layout === 'grid' ? (
                  <div style={gridLayoutStyle}>
                    <div style={textCenteringStyle}>
                      <div style={textRowStyle}>
                        <div style={textColumnStyle}>
                          <h2 style={{ ...headingStyle, fontSize: 'clamp(1.4rem, 3.5vw, 2.45rem)', textAlign: 'left', margin: 0 }}>{slide.headlineText}</h2>
                        </div>
                        <div style={textColumnRightStyle}>
                          <a href="#" style={ctaStyle}>{slide.supportText} ↗</a>
                        </div>
                      </div>
                      {slide.serviceItems && (
                        <div style={servicesRowStyle}>
                          {slide.serviceItems.map((item) => (
                            <div key={item.id} style={serviceItemStyle}>
                              <div style={servicePlaceholderStyle} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div data-featured-work-label style={featuredWorkLabelStyle}>
                      <h2 style={{ ...headingStyle, fontSize: 'clamp(1.4rem, 3.5vw, 2.45rem)', textAlign: 'left', margin: 0 }}>
                        Featured Work
                      </h2>
                    </div>
                    <div data-grid-window style={gridWindowStyle}>
                      <div data-grid-inner style={gridInnerContainerStyle}>
                        <div style={gridRowStyle}>
                          {slide.gridItems.map((item) => (
                            <div key={item.id} style={gridItemStyle}>
                              <div style={gridPlaceholderStyle}></div>
                            </div>
                          ))}
                        </div>
                        <div style={quoteSectionStyle}>
                          <blockquote style={quoteTextStyle}>
                            "The gap between what's possible and what's built is where I work."
                          </blockquote>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 style={headingStyle}>{slide.title}</h2>
                    {slide.image ? (
                      <img src={slide.image} alt="" style={imageStyle} />
                    ) : (
                      <div style={copyWrapStyle}>
                        {slide.body.map((paragraph) => (
                          <p key={paragraph} style={paragraphStyle}>
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
};

const sectionStyle = {
  position: 'relative',
  paddingBottom: '1.4rem',
};

const quoteSectionStyle = {
  paddingTop: 'clamp(3rem, 6vw, 6rem)',
  paddingBottom: 'clamp(3rem, 6vw, 6rem)',
};

const quoteTextStyle = {
  margin: 0,
  fontSize: 'clamp(2rem, 5vw, 4.2rem)',
  fontWeight: 700,
  lineHeight: 1.08,
  letterSpacing: '-0.04em',
  fontFamily: "'Aldrich', system-ui, -apple-system, sans-serif",
  color: '#2a2420',
  maxWidth: '18ch',
};

const wrapperStyle = {
  paddingTop: '64px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const panelStyle = {
  width: '100%',
  height: 'calc(100vh - 64px)',
  display: 'flex',
  justifyContent: 'center',
  position: 'relative',
  boxSizing: 'border-box',
  overflow: 'hidden',
  borderRadius: '1rem',
};

const contentStyle = {
  width: '100%',
  height: '100%',
};

const innerStyle = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
};

const longInnerStyle = {
  height: 'auto',
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  paddingBottom: '14vh',
  boxSizing: 'border-box',
};

const headingStyle = {
  fontSize: 'max(2.8rem, min(8.4vw + 0.7rem, 7rem))',
  fontWeight: 700,
  margin: '0 auto',
  lineHeight: 0.9,
  letterSpacing: '-0.05em',
  fontFamily: "'Aldrich', system-ui, -apple-system, sans-serif",
  textAlign: 'center',
};

const imageStyle = {
  width: 'min(40%, 27.2rem)',
  aspectRatio: '1 / 1',
  objectFit: 'cover',
  marginTop: '1.75rem',
  borderRadius: '0.75rem',
};

const copyWrapStyle = {
  width: 'min(33.6rem, 80%)',
  marginTop: '1.4rem',
};

const paragraphStyle = {
  maxWidth: '40ch',
  padding: '0 1.4rem',
  margin: '0 0 0.7rem',
  fontSize: '0.735rem',
  lineHeight: 1.55,
  textAlign: 'justify',
};

const gridWindowStyle = {
  flex: 1,
  overflow: 'hidden',
};

const gridLayoutStyle = {
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  paddingTop: 0,
  paddingBottom: 'clamp(1.4rem, 3.5vw, 2.8rem)',
  paddingLeft: 'max(10vw, calc((100% - 810px) / 2))',
  paddingRight: 'max(10vw, calc((100% - 810px) / 2))',
  boxSizing: 'border-box',
};

const textCenteringStyle = {
  height: 'clamp(14rem, calc(9rem + 3vw + 8vh), 20rem)',
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  gap: 'clamp(0.75rem, 2vh, 1.25rem)',
};

const textRowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'clamp(1.4rem, 2.8vw, 2.1rem)',
  width: '100%',
};

const textColumnStyle = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'flex-start',
};

const textColumnRightStyle = {
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'flex-end',
  textAlign: 'right',
};

const supportTextStyle = {
  margin: 0,
  fontSize: 'clamp(0.7rem, 1.4vw, 0.91rem)',
  lineHeight: 1.6,
  fontWeight: 400,
  textAlign: 'justify',
  color: 'rgba(42, 36, 32, 0.8)',
};

const ctaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.6rem 1.2rem',
  fontSize: 'clamp(0.7rem, 1.1vw, 0.8rem)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textDecoration: 'none',
  color: '#f5f1df',
  background: '#2a2420',
  borderRadius: '2rem',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const gridInnerContainerStyle = {
  width: '100%',
};

const gridRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 'clamp(0.7rem, 1.4vw, 1.05rem)',
  width: '100%',
};

const gridItemStyle = {
  aspectRatio: '1',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const gridPlaceholderStyle = {
  width: '100%',
  height: '100%',
  backgroundColor: 'rgba(42, 36, 32, 0.08)',
  borderRadius: '0.5rem',
  border: '1px solid rgba(42, 36, 32, 0.2)',
};

const featuredWorkLabelStyle = {
  width: '100%',
  paddingTop: 'clamp(1.4rem, 3.5vw, 2.8rem)',
  paddingBottom: 'clamp(0.7rem, 1.4vw, 1.05rem)',
};

const servicesRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 'clamp(0.7rem, 1.4vw, 1.05rem)',
  width: '100%',
};

const serviceItemStyle = {
  height: 'clamp(60px, 8vh, 120px)',
  overflow: 'hidden',
};

const servicePlaceholderStyle = {
  width: '100%',
  height: '100%',
  backgroundColor: 'rgba(42, 36, 32, 0.08)',
  borderRadius: '0.5rem',
  border: '1px solid rgba(42, 36, 32, 0.2)',
};

export default StackedSlidesSection;
