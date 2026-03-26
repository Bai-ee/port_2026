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

    // Hover reveal list effect — images appended to body to escape transformed ancestor
    const hoverContainers = Array.from(wrapper.querySelectorAll('[data-hover-item]'));
    const hoverCleanups = [];

    hoverContainers.forEach((container) => {
      const src = container.querySelector('[data-hover-image]')?.src;
      if (!src) return;

      const image = document.createElement('img');
      image.src = src;
      Object.assign(image.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: 'clamp(220px, 24vw, 360px)',
        height: 'clamp(220px, 24vw, 360px)',
        objectFit: 'cover',
        zIndex: '9999',
        opacity: '0',
        visibility: 'hidden',
        pointerEvents: 'none',
        borderRadius: '1.25rem',
        boxShadow: '0 24px 80px rgba(0,0,0,0.42)',
      });
      document.body.appendChild(image);

      gsap.set(image, { xPercent: -50, yPercent: -50, autoAlpha: 0 });

      let firstEnter = false;
      const setX = gsap.quickTo(image, 'x', { duration: 0.4, ease: 'power3' });
      const setY = gsap.quickTo(image, 'y', { duration: 0.4, ease: 'power3' });

      const align = (event) => {
        const rect = container.getBoundingClientRect();
        let itemCenterY = rect.top + rect.height / 2 + 140;
        const imageSize = Math.min(window.innerWidth * 0.24, 360);
        itemCenterY = Math.min(window.innerHeight - imageSize / 2, itemCenterY);

        if (firstEnter) {
          setX(event.clientX, event.clientX);
          setY(itemCenterY, itemCenterY);
          firstEnter = false;
          return;
        }
        setX(event.clientX);
        setY(itemCenterY);
      };

      const startFollow = () => document.addEventListener('mousemove', align);
      const stopFollow = () => document.removeEventListener('mousemove', align);

      const fade = gsap.to(image, {
        autoAlpha: 1,
        ease: 'none',
        paused: true,
        duration: 0.12,
        onReverseComplete: stopFollow,
      });

      const onEnter = (event) => {
        firstEnter = true;
        fade.play();
        startFollow();
        align(event);
      };

      const onLeave = () => fade.reverse();

      container.addEventListener('mouseenter', onEnter);
      container.addEventListener('mouseleave', onLeave);

      hoverCleanups.push(() => {
        container.removeEventListener('mouseenter', onEnter);
        container.removeEventListener('mouseleave', onLeave);
        stopFollow();
        fade.kill();
        document.body.removeChild(image);
      });
    });

    const ctx = gsap.context(() => {
      const panel = wrapper.querySelector('[data-stack-panel]');
      if (!panel) return;
      const innerPanel = panel.querySelector('[data-stack-inner]');
      if (!innerPanel) return;

      const gridEl = panel.querySelector('[data-grid-inner]');
      const gridWindowEl = panel.querySelector('[data-grid-window]');
      const labelHeading = panel.querySelector('[data-label-heading]');
      const quoteEl = panel.querySelector('[data-quote-section]');
      if (!gridEl || !gridWindowEl) return;

      if (gridEl.scrollHeight <= 0) return;

      const getQuoteThreshold = () => {
        const windowTop = gridWindowEl.getBoundingClientRect().top;
        const quoteTop = quoteEl ? quoteEl.getBoundingClientRect().top : Infinity;
        return (quoteTop - windowTop) / gridEl.scrollHeight;
      };

      const isMobile = window.innerWidth < 768;

      gsap.timeline({
        scrollTrigger: {
          trigger: panel,
          start: () => `top top+=${isMobile ? 48 : 64}`,
          end: () => `+=${gridEl.scrollHeight - gridWindowEl.offsetHeight}`,
          pin: true,
          pinSpacing: true,
          scrub: isMobile ? 3.2 : 4,
          invalidateOnRefresh: true,
          anticipatePin: 1.1,
          refreshPriority: 2,
          onToggle: (self) => {
            panel.style.borderRadius = self.isActive ? '0' : '1rem';
          },
          onUpdate: (self) => {
            if (!labelHeading) return;
            const p = self.progress;
            const w = window.innerWidth;

            // Breakpoint thresholds — tune each independently
            let t1, t2;
            if (w >= 1280) {
              // XL
              t1 = 0.15; t2 = 0.25;
            } else if (w >= 1024) {
              // Large
              t1 = 0; t2 = 0.65;
            } else if (w >= 768) {
              // Medium
              t1 = 0.13; t2 = 0.3;
            } else if (w >= 480) {
              // Small
              t1 = 0.35; t2 = 0.45;
            } else {
              // Mobile
              t1 = 0.3; t2 = 0.4;
            }

            if (p >= t2) {
              labelHeading.textContent = "Here's What You Get With Me In The Loop:";
            } else if (p >= t1) {
              labelHeading.textContent = 'If Your Building...';
            } else {
              labelHeading.textContent = 'Featured Work';
            }
          },
        },
      }).to(gridEl, { y: () => -(gridEl.scrollHeight - gridWindowEl.offsetHeight), ease: 'power2.out' });
    }, wrapper);

    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener('resize', refresh);

    // Cal.com embed
    const calScript = document.createElement('script');
    calScript.type = 'text/javascript';
    calScript.innerHTML = `
      (function (C, A, L) { let p = function (a, ar) { a.q.push(ar); }; let d = C.document; C.Cal = C.Cal || function () { let cal = C.Cal; let ar = arguments; if (!cal.loaded) { cal.ns = {}; cal.q = cal.q || []; d.head.appendChild(d.createElement("script")).src = A; cal.loaded = true; } if (ar[0] === L) { const api = function () { p(api, arguments); }; const namespace = ar[1]; api.q = api.q || []; if(typeof namespace === "string"){cal.ns[namespace] = cal.ns[namespace] || api;p(cal.ns[namespace], ar);p(cal, ["initNamespace", namespace]);} else p(cal, ar); return;} p(cal, ar); }; })(window, "https://app.cal.com/embed/embed.js", "init");
      Cal("init", "30min", {origin:"https://app.cal.com"});
      Cal.ns["30min"]("ui", {"hideEventTypeDetails":false,"layout":"month_view"});
    `;
    document.body.appendChild(calScript);

    return () => {
      window.removeEventListener('resize', refresh);
      hoverCleanups.forEach((cleanup) => cleanup());
      if (document.body.contains(calScript)) document.body.removeChild(calScript);
      ctx.revert();
    };
  }, []);

  return (
    <section style={sectionStyle}>
      <style>{`
        @media (max-width: 767px) {
          #stacked-grid-row {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
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
                          <h2 id="panel-hero-headline" style={{ ...headingStyle, fontSize: 'clamp(1.4rem, 3.5vw, 2.45rem)', textAlign: 'left', margin: 0 }}>{slide.headlineText}</h2>
                        </div>
                        <div style={textColumnRightStyle}>
                          <a
                            id="panel-hero-cta"
                            href="#"
                            style={ctaStyle}
                            data-cal-link="bryan-balli-5w12w7/30min"
                            data-cal-namespace="30min"
                            data-cal-config='{"layout":"month_view","useSlotsViewOnSmallScreen":"true"}'
                          >{slide.supportText} ↗</a>
                        </div>
                      </div>
                      {slide.serviceItems && (
                        <div style={servicesRowStyle}>
                          {slide.serviceItems.map((item) => (
                            <div key={item.id} data-service-item style={serviceItemStyle}>
                              <div style={servicePlaceholderStyle} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div data-featured-work-label style={featuredWorkLabelStyle}>
                      <h2 data-label-heading style={{ ...headingStyle, fontSize: 'clamp(1.4rem, 3.5vw, 2.45rem)', textAlign: 'left', margin: 0 }}>
                        Featured Work
                      </h2>
                    </div>
                    <div data-grid-window style={gridWindowStyle}>
                      <div data-grid-inner style={gridInnerContainerStyle}>
                        <div id="stacked-grid-row" style={gridRowStyle}>
                          {slide.gridItems.map((item) => (
                            <div key={item.id} style={gridItemStyle}>
                              <div style={gridPlaceholderStyle}></div>
                            </div>
                          ))}
                        </div>
                        <div data-quote-section data-hover-item style={quoteSectionStyle}>
                          <img data-hover-image src="https://assets.codepen.io/16327/portrait-image-6.jpg" alt="" style={{ display: 'none' }} />
                          <blockquote style={quoteTextStyle}>
                            Heres What You Get With Me In The Loop:
                          </blockquote>
                        </div>
                        <ul role="list" style={hoverListStyle}>
                          {[
                            { image: 'https://assets.codepen.io/16327/portrait-image-8.jpg', title: 'restart reverse scrub pin markers overwrite modifiers' },
                            { image: 'https://assets.codepen.io/16327/portrait-image-3.jpg', title: 'toggleActions start end once refresh from to' },
                            { image: 'https://assets.codepen.io/16327/portrait-image-1.jpg', title: 'ScrollSmoother Flip Draggable SplitText InertiaPlugin' },
                            { image: 'https://assets.codepen.io/16327/portrait-image-14.jpg', title: 'onComplete onUpdate quickSetter quickTo utils.toArray' },
                            { image: 'https://assets.codepen.io/16327/portrait-image-6.jpg', title: 'Power2 Power3 Power4 Back Elastic Bounce Expo Sine' },
                          ].map((item) => (
                            <li key={item.title} style={hoverItemStyle}>
                              <div style={hoverTextWrapStyle}>
                                <h3 style={hoverTitleStyle}>{item.title}</h3>
                              </div>
                            </li>
                          ))}
                        </ul>

                        <div id="rate-cards-shell" style={rateCardShellStyle}>
                          <div style={rateCardHeaderStyle}>
                            <span style={rateCardEyebrowStyle}>What's Included</span>
                            <h2 style={rateCardHeadlineStyle}>Engagement packages</h2>
                            <p style={rateCardSubtextStyle}>Flexible engagements built around how you actually work. From one-off builds to full-loop collaboration.</p>
                          </div>
                          <div style={rateCardGridStyle}>
                            {[
                              { name: 'The Starter', price: '~$800', unit: '/project', desc: 'Single deliverable — a build, audit, or strategy session', badge: 'Standard rate', cta: 'Get Started' },
                              { name: 'The Builder', price: '~$2,400', unit: '/project', desc: 'Multi-phase build with rounds of revision and handoff', badge: 'Most popular', cta: 'Get Started' },
                              { name: 'The Operator', price: '~$3,800', unit: '/mo', desc: 'Ongoing human-in-the-loop support, builds + iteration cycles', badge: 'Save vs. hourly', cta: 'Get Started' },
                              { name: 'The Partner', price: 'Custom', unit: '', desc: 'Full-scope embedded collaboration — strategy, builds, systems', badge: 'Best value', cta: "Let's Talk" },
                            ].map((plan) => (
                              <div key={plan.name} style={rateCardItemStyle}>
                                <h3 style={rateCardNameStyle}>{plan.name}</h3>
                                <div style={rateCardPriceRowStyle}>
                                  <span style={rateCardPriceStyle}>{plan.price}</span>
                                  {plan.unit && <span style={rateCardUnitStyle}>{plan.unit}</span>}
                                </div>
                                <p style={rateCardDescStyle}>{plan.desc}</p>
                                <span style={rateCardBadgeStyle}>{plan.badge}</span>
                                <a
                                  href="#"
                                  style={rateCardCtaStyle}
                                  data-cal-link="bryan-balli-5w12w7/30min"
                                  data-cal-namespace="30min"
                                  data-cal-config='{"layout":"month_view","useSlotsViewOnSmallScreen":"true"}'
                                >{plan.cta}</a>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div id="contact-card-footer" style={contactCardStyle}>
                          <div style={contactCardLeftStyle}>
                            <span style={contactCardEyebrowStyle}>Get Started Today</span>
                            <h2 style={contactCardHeadlineStyle}>Ready to work with a human in the loop?</h2>
                            <p style={contactCardSubtextStyle}>Book a free intro call — no commitment required. I'll come prepared.</p>
                          </div>
                          <div style={contactCardRightStyle}>
                            <a
                              href="#"
                              style={contactCardPrimaryBtnStyle}
                              data-cal-link="bryan-balli-5w12w7/30min"
                              data-cal-namespace="30min"
                              data-cal-config='{"layout":"month_view","useSlotsViewOnSmallScreen":"true"}'
                            >Book a Call</a>
                            <a href="#" style={contactCardSecondaryLinkStyle}>Contact Me →</a>
                          </div>
                        </div>

                        {/* Inline footer */}
                        <div id="stacked-inline-footer" style={inlineFooterStyle}>
                          <div style={inlineFooterDividerStyle} />
                          <div style={inlineFooterNewsletterStyle}>
                            <h3 style={inlineFooterHeadingStyle}>Stay In Touch</h3>
                            <p style={inlineFooterSubStyle}>Updates on projects, tools, and thinking on human-AI collaboration.</p>
                            <div style={inlineFooterFormStyle}>
                              <input
                                type="email"
                                placeholder="Your email address"
                                style={inlineFooterInputStyle}
                              />
                              <button style={inlineFooterSubmitStyle}>Subscribe</button>
                            </div>
                          </div>
                          <div style={inlineFooterDividerStyle} />
                          <div style={inlineFooterBottomStyle}>
                            <span style={inlineFooterCopyrightStyle}>© 2026 Bryan Balli · All rights reserved</span>
                            <div style={inlineFooterLegalStyle}>
                              <a href="#" style={inlineFooterLegalLinkStyle}>Privacy</a>
                              <a href="#" style={inlineFooterLegalLinkStyle}>Terms</a>
                            </div>
                          </div>
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
  paddingBottom: 0,
};

const quoteSectionStyle = {
  paddingTop: 'clamp(6rem, 12vw, 10rem)',
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
  overflowX: 'visible',
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
  overflowX: 'visible',
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
  overflowX: 'visible',
  paddingBottom: 'clamp(3rem, 6vw, 5rem)',
  boxSizing: 'border-box',
};

const gridRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 'clamp(0.7rem, 1.4vw, 1.05rem)',
  width: '100%',
  marginTop: '50px',
};

const gridItemStyle = {
  aspectRatio: '16 / 9',
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
  paddingBottom: 'clamp(2rem, 4vw, 3.5rem)',
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

const hoverListStyle = {
  listStyle: 'none',
  width: '100%',
  margin: 0,
  padding: 0,
  marginTop: 'clamp(2rem, 4vw, 3rem)',
};

const hoverItemStyle = {
  position: 'relative',
  display: 'block',
  width: '100%',
  padding: '2rem clamp(1.5rem, 4vw, 3rem)',
  borderBottom: '1px solid rgba(42, 36, 32, 0.8)',
  boxSizing: 'border-box',
};

const hoverImageStyle = {
  position: 'fixed',
  top: 0,
  left: 0,
  width: 'clamp(220px, 24vw, 360px)',
  height: 'clamp(220px, 24vw, 360px)',
  objectFit: 'cover',
  zIndex: 9999,
  opacity: 0,
  visibility: 'hidden',
  pointerEvents: 'none',
  borderRadius: '1.25rem',
  boxShadow: '0 24px 80px rgba(0, 0, 0, 0.42)',
};

const hoverTextWrapStyle = {
  maxWidth: '72rem',
};

const hoverTitleStyle = {
  margin: 0,
  color: '#2a2420',
  fontSize: 'clamp(1.3rem, 2.2vw, 2.4rem)',
  lineHeight: 1.05,
  fontWeight: 700,
  letterSpacing: '-0.04em',
  fontFamily: "'Aldrich', system-ui, -apple-system, sans-serif",
};


const rateCardShellStyle = {
  width: '100%',
  background: 'none',
  borderRadius: '1.25rem',
  padding: 'clamp(2.5rem, 5vw, 4rem) 0',
  marginTop: 'clamp(2rem, 4vw, 3rem)',
  boxSizing: 'border-box',
};

const rateCardHeaderStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.6rem',
  marginBottom: 'clamp(2rem, 4vw, 3rem)',
};

const rateCardEyebrowStyle = {
  fontStyle: 'italic',
  fontSize: 'clamp(0.8rem, 1.2vw, 0.95rem)',
  color: 'rgba(42, 36, 32, 0.5)',
};

const rateCardHeadlineStyle = {
  margin: 0,
  fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  lineHeight: 1.1,
  color: '#2a2420',
  fontFamily: "'Aldrich', system-ui, -apple-system, sans-serif",
};

const rateCardSubtextStyle = {
  margin: 0,
  fontSize: 'clamp(0.8rem, 1.2vw, 0.9rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.55)',
  maxWidth: '52ch',
};

const rateCardGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 'clamp(1rem, 2vw, 1.5rem)',
};

const rateCardItemStyle = {
  background: 'none',
  border: '1px solid rgba(42, 36, 32, 0.2)',
  borderRadius: '0.5rem',
  padding: 'clamp(1.5rem, 3vw, 2rem)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  boxSizing: 'border-box',
};

const rateCardNameStyle = {
  margin: 0,
  fontSize: 'clamp(1.2rem, 2vw, 1.6rem)',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: '#7a6a3a',
  fontFamily: "'Aldrich', system-ui, -apple-system, sans-serif",
};

const rateCardPriceRowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.3rem',
};

const rateCardPriceStyle = {
  fontSize: 'clamp(1.6rem, 3vw, 2.4rem)',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  color: '#2a2420',
};

const rateCardUnitStyle = {
  fontSize: 'clamp(0.8rem, 1.2vw, 0.9rem)',
  color: 'rgba(42, 36, 32, 0.45)',
};

const rateCardDescStyle = {
  margin: 0,
  fontSize: 'clamp(0.78rem, 1.1vw, 0.88rem)',
  lineHeight: 1.55,
  color: 'rgba(42, 36, 32, 0.55)',
  flexGrow: 1,
};

const rateCardBadgeStyle = {
  display: 'inline-block',
  padding: '0.3rem 0.8rem',
  background: 'rgba(42, 36, 32, 0.08)',
  borderRadius: '2rem',
  fontSize: '0.72rem',
  fontWeight: 600,
  color: 'rgba(42, 36, 32, 0.6)',
  alignSelf: 'flex-start',
};

const rateCardCtaStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0.75rem 1.2rem',
  border: '1.5px solid rgba(42, 36, 32, 0.3)',
  borderRadius: '0.5rem',
  color: '#2a2420',
  fontSize: '0.88rem',
  fontWeight: 600,
  textDecoration: 'none',
  cursor: 'pointer',
  marginTop: '0.5rem',
};

const contactCardStyle = {
  width: '100%',
  marginTop: 'clamp(2rem, 4vw, 3rem)',
  marginBottom: 'clamp(2rem, 4vw, 3rem)',
  background: '#2a2420',
  borderRadius: '1.25rem',
  padding: 'clamp(2.5rem, 5vw, 4rem) clamp(2rem, 4vw, 3.5rem)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'clamp(2rem, 4vw, 4rem)',
  boxSizing: 'border-box',
  flexWrap: 'wrap',
};

const contactCardLeftStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  flex: '1 1 auto',
  maxWidth: '32rem',
};

const contactCardEyebrowStyle = {
  fontStyle: 'italic',
  fontSize: 'clamp(0.8rem, 1.2vw, 0.95rem)',
  color: 'rgba(245, 241, 223, 0.55)',
  letterSpacing: '0.01em',
};

const contactCardHeadlineStyle = {
  margin: 0,
  fontSize: 'clamp(1.8rem, 3.5vw, 3rem)',
  fontWeight: 700,
  lineHeight: 1.1,
  letterSpacing: '-0.03em',
  color: '#f5f1df',
  fontFamily: "'Aldrich', system-ui, -apple-system, sans-serif",
};

const contactCardSubtextStyle = {
  margin: 0,
  fontSize: 'clamp(0.8rem, 1.2vw, 0.9rem)',
  lineHeight: 1.6,
  color: 'rgba(245, 241, 223, 0.55)',
};

const contactCardRightStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'clamp(1rem, 2vw, 1.75rem)',
  flexShrink: 0,
  flexWrap: 'wrap',
};

const contactCardPrimaryBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.8rem 1.8rem',
  fontSize: 'clamp(0.8rem, 1.1vw, 0.9rem)',
  fontWeight: 600,
  letterSpacing: '0.02em',
  color: '#f5f1df',
  border: '1.5px solid rgba(245, 241, 223, 0.5)',
  borderRadius: '0.5rem',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const contactCardSecondaryLinkStyle = {
  fontSize: 'clamp(0.8rem, 1.1vw, 0.9rem)',
  fontWeight: 500,
  color: 'rgba(245, 241, 223, 0.65)',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const inlineFooterStyle = {
  width: '100%',
  paddingTop: 'clamp(1rem, 2vw, 1.5rem)',
  paddingBottom: 'clamp(2rem, 4vw, 3rem)',
  boxSizing: 'border-box',
};

const inlineFooterDividerStyle = {
  width: '100%',
  height: '1px',
  background: 'rgba(42, 36, 32, 0.12)',
  margin: 'clamp(1.5rem, 3vw, 2.5rem) 0',
};

const inlineFooterNewsletterStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.75rem',
  textAlign: 'center',
};

const inlineFooterHeadingStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 1.8vw, 1.3rem)',
  fontWeight: 600,
  letterSpacing: '-0.02em',
  color: '#2a2420',
};

const inlineFooterSubStyle = {
  margin: 0,
  fontSize: 'clamp(0.8rem, 1.1vw, 0.88rem)',
  color: 'rgba(42, 36, 32, 0.5)',
  maxWidth: '36ch',
};

const inlineFooterFormStyle = {
  display: 'flex',
  gap: '0.5rem',
  marginTop: '0.5rem',
  width: '100%',
  maxWidth: '420px',
};

const inlineFooterInputStyle = {
  flex: 1,
  padding: '0.75rem 1rem',
  background: 'rgba(42, 36, 32, 0.04)',
  border: '1px solid rgba(42, 36, 32, 0.15)',
  borderRadius: '0.5rem',
  color: '#2a2420',
  fontSize: '0.88rem',
  outline: 'none',
  boxSizing: 'border-box',
};

const inlineFooterSubmitStyle = {
  padding: '0.75rem 1.4rem',
  background: '#2a2420',
  border: 'none',
  borderRadius: '0.5rem',
  color: '#f5f1df',
  fontSize: '0.88rem',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const inlineFooterBottomStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.75rem',
};

const inlineFooterCopyrightStyle = {
  fontSize: '0.78rem',
  color: 'rgba(42, 36, 32, 0.35)',
};

const inlineFooterLegalStyle = {
  display: 'flex',
  gap: '1.5rem',
};

const inlineFooterLegalLinkStyle = {
  fontSize: '0.78rem',
  color: 'rgba(42, 36, 32, 0.4)',
  textDecoration: 'none',
  cursor: 'pointer',
};

export default StackedSlidesSection;
