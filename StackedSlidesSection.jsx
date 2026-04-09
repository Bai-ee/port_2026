import React, { useLayoutEffect, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { createSharedParticleGalleryRenderer } from './sharedParticleGalleryRenderer';

const agencyLogos = [
  { src: '/img/agencies/publicis.png', alt: 'Publicis', scale: 2 },
  { src: '/img/agencies/epsilon.png', alt: 'Epsilon' },
  { src: '/img/agencies/conversant.png', alt: 'Conversant' },
  { src: '/img/agencies/ANNTAYLOR.png', alt: 'Ann Taylor', scale: 0.67 },
  { src: '/img/agencies/GAP.png', alt: 'Gap', scale: 2 },
  { src: '/img/agencies/MAZDA.png', alt: 'Mazda' },
  { src: '/img/agencies/alliance.png', alt: 'Alliance Data' },
];

const testimonials = [
  {
    quote: 'Transforms ideas into polished, high-impact experiences. Strong across devices, highly responsive, and consistently delivers under pressure.',
    name: 'Melissa Hsiao',
    title: 'Industry Lead',
    company: 'TikTok',
    img: '/img/melissa.jpg',
  },
  {
    quote: 'Rare ability to operate across both design and development. Pixel-perfect execution with deep technical ownership across platforms.',
    name: 'Jeanne Cheung',
    title: 'Director, Design Management',
    company: 'HBO Max',
    img: '/img/jeanne.jpg',
  },
  {
    quote: 'Brings expert-level creative and technical thinking across platforms. Pushes concepts further and executes with precision.',
    name: 'Eric Farias',
    title: 'Senior Art Director',
    company: 'Epsilon',
    img: '/img/eric.jpg',
  },
  {
    quote: 'A go-to for complex creative builds across desktop, mobile, and video. Combines technical depth with strong design instincts.',
    name: 'Vanessa D\'Amore',
    title: 'Sr. Product Manager (AI, SaaS, Integrations)',
    company: 'TST',
    img: '/img/vanessa.jpg',
  },
  {
    quote: 'A knowledge hub for custom creative systems—able to design, build, and troubleshoot across evolving tech stacks and environments.',
    name: 'Vanessa D\'Amore',
    title: 'Sr. Product Manager (AI, SaaS, Integrations)',
    company: 'TST',
    img: '/img/vanessa.jpg',
  },
  {
    quote: 'Moves seamlessly between concept and execution across devices—bringing clarity, speed, and craftsmanship to complex builds.',
    name: 'Eric Farias',
    title: 'Senior Art Director',
    company: 'Epsilon',
    img: '/img/eric.jpg',
  },
];

const workHistory = [
  {
    years: '2022 — Now',
    role: 'Founder & Consultant',
    company: 'Independent',
    type: 'Consulting',
    desc: 'Human-in-the-loop AI systems, interactive builds, and digital strategy for brands navigating AI adoption.',
  },
  {
    years: '2019 — 2022',
    role: 'Creative Technology Director',
    company: 'Studio Meridian',
    type: 'Full-time',
    desc: 'Led interactive experience development across web, installation, and emerging media for a boutique digital studio.',
  },
  {
    years: '2017 — 2019',
    role: 'Senior Interactive Producer',
    company: 'Carve Digital',
    type: 'Full-time',
    desc: 'Produced real-time data visualization and campaign microsites for Fortune 500 clients.',
  },
  {
    years: '2014 — 2017',
    role: 'Front-End Developer',
    company: 'Tactile Media',
    type: 'Full-time',
    desc: 'Built responsive marketing platforms and motion-rich interfaces for media and entertainment brands.',
  },
];

const slides = [
  {
    title: 'Section 1',
    bg: '#f5f1df',
    fg: '#2a2420',
    layout: 'grid',
    headlineText: 'Digital Media Consultant',
    supportText: 'Chat with Bryan',
    gridItems: Array(17).fill(null).map((_, i) => ({ id: i })),
    serviceItems: [
      { id: 0, label: 'Product Development' },
      { id: 1, label: 'Agentic Automation' },
      { id: 2, label: 'Decentralized Ecosystems' },
    ],
  },
];

const getInitials = (name) => name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

const FILTERS = ['All', 'Agentic Automation', 'Decentralized Ecosystems', 'SaaS', 'Brand Development', 'UI / UX', 'Audio / Video', 'Marketing', 'Print Collateral', 'Social Media', 'Websites & Dashboards'];

const PORTFOLIO_IMAGES = [
  '/img/port/frame_3.png',
  '/img/port/frame_5.png',
  '/img/port/fast_poker_ui_1.png',
  '/img/port/frame_1.png',
  '/img/port/edittrax.png',
  '/img/port/claire.png',
  '/img/port/cq_figma.png',
  '/img/port/cq_guide.png',
  '/img/port/viva.png',
];

const PARTICLE_DEFAULTS = {
  scale: 60,
  particleCount: 3000,
  particleSize: 1,
  speedMult: 0.5,
  animationSpeed: 6,
  hueSpeed: 0.15,
  waveAmplitude: 6,
  chaos: 0,
  saturation: 1,
  lightness: 1,
};

const PARTICLE_SLIDERS = [
  { key: 'scale',          label: 'Scale',        min: 5,     max: 60,   step: 1     },
  { key: 'particleCount',  label: 'Count',        min: 100,   max: 3000, step: 50    },
  { key: 'particleSize',   label: 'Size',         min: 0.02,  max: 1.0,  step: 0.01  },
  { key: 'speedMult',      label: 'Speed',        min: 0.01,  max: 0.5,  step: 0.005 },
  { key: 'animationSpeed', label: 'Anim Speed',   min: 0.1,   max: 6.0,  step: 0.1   },
  { key: 'hueSpeed',       label: 'Hue Speed',    min: 0.001, max: 0.15, step: 0.001 },
  { key: 'waveAmplitude',  label: 'Wave',         min: 0.0,   max: 6.0,  step: 0.1   },
  { key: 'chaos',          label: 'Chaos',        min: 0.0,   max: 5.0,  step: 0.05  },
  { key: 'saturation',     label: 'Saturation',   min: 0.0,   max: 1.0,  step: 0.01  },
  { key: 'lightness',      label: 'Lightness',    min: 0.1,   max: 1.0,  step: 0.01  },
];

const PRESET_KINDS = ['torus', 'vortex', 'lattice', 'sphere', 'ribbon', 'orbits', 'cloud', 'helix'];

const StackedSlidesSection = () => {
  const wrapperRef = useRef(null);
  const filterDropdownRef = useRef(null);
  const servicesViewportRef = useRef(null);
  const servicesCanvasRef = useRef(null);
  const marqueeShellRef = useRef(null);
  const marqueeTrackRef = useRef(null);
  const marqueeSetRef = useRef(null);
  const [pokerHovered, setPokerHovered] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState('All');
  const [particleParams, setParticleParams] = useState(PARTICLE_DEFAULTS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Set initial hidden state
  useEffect(() => {
    const el = filterDropdownRef.current;
    if (!el) return;
    gsap.set(el, { height: 0, overflow: 'hidden' });
    gsap.set(el.querySelectorAll('.filter-chip'), { opacity: 0, y: 6 });
  }, []);

  // Animate open / close
  useEffect(() => {
    const el = filterDropdownRef.current;
    if (!el) return;
    const pills = el.querySelectorAll('.filter-chip');

    if (filterOpen) {
      gsap.set(el, { overflow: 'hidden' });
      gsap.set(el, { height: 'auto' });
      gsap.from(el, { height: 0, duration: 0.35, ease: 'power2.out' });
      gsap.fromTo(
        pills,
        { opacity: 0, y: 6 },
        { opacity: 1, y: 0, duration: 0.22, ease: 'power2.out', stagger: 0.055, delay: 0.12 }
      );
    } else {
      gsap.to(pills, { opacity: 0, y: 4, duration: 0.1, stagger: { each: 0.03, from: 'end' } });
      gsap.to(el, { height: 0, duration: 0.28, ease: 'power2.in', delay: 0.08 });
    }
  }, [filterOpen]);

  // Three.js particle renderer for service thumbnails
  useEffect(() => {
    const viewport = servicesViewportRef.current;
    const canvas = servicesCanvasRef.current;
    if (!viewport || !canvas) return;

    const particleRenderer = createSharedParticleGalleryRenderer({
      canvas,
      container: viewport,
      getWindows: () => Array.from(viewport.querySelectorAll('[data-particle-window]')),
      params: particleParams,
    });

    let frameId = 0;
    let isLoopActive = false;
    let isVisible = false;

    const renderFrame = (time) => {
      if (!isLoopActive) return;
      particleRenderer.render(time * 0.001);
      frameId = window.requestAnimationFrame(renderFrame);
    };

    const stopRenderLoop = () => {
      isLoopActive = false;
      if (frameId) { window.cancelAnimationFrame(frameId); frameId = 0; }
    };

    const startRenderLoop = () => {
      if (isLoopActive || !isVisible || document.hidden) return;
      isLoopActive = true;
      frameId = window.requestAnimationFrame(renderFrame);
    };

    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? false;
        if (isVisible) { startRenderLoop(); return; }
        stopRenderLoop();
      },
      { root: null, threshold: 0, rootMargin: '100px 0px' }
    );

    const handleDocumentVisibility = () => {
      if (document.hidden) { stopRenderLoop(); return; }
      startRenderLoop();
    };

    document.addEventListener('visibilitychange', handleDocumentVisibility);
    visibilityObserver.observe(viewport);

    return () => {
      stopRenderLoop();
      visibilityObserver.disconnect();
      document.removeEventListener('visibilitychange', handleDocumentVisibility);
      particleRenderer.dispose();
    };
  }, [particleParams]);

  useEffect(() => {
    const shell = marqueeShellRef.current;
    const track = marqueeTrackRef.current;
    const set = marqueeSetRef.current;
    if (!shell || !track || !set) return;

    let itemWidth = 0;
    let offset = 0;
    let frameId = 0;
    let measureFrameId = 0;
    let lastTime = 0;
    let isVisible = false;

    const applyTransform = () => {
      track.style.transform = `translate3d(${offset}px, 0, 0)`;
    };

    const measure = () => {
      itemWidth = set.getBoundingClientRect().width;
      if (!itemWidth) return;

      offset = itemWidth ? -((Math.abs(offset) % itemWidth)) : 0;
      applyTransform();
    };

    const scheduleMeasure = () => {
      cancelAnimationFrame(measureFrameId);
      measureFrameId = requestAnimationFrame(measure);
    };

    const stop = () => {
      if (!frameId) return;
      cancelAnimationFrame(frameId);
      frameId = 0;
      lastTime = 0;
    };

    const tick = (time) => {
      if (!isVisible || document.hidden || !itemWidth) {
        stop();
        return;
      }

      if (!lastTime) {
        lastTime = time;
      }

      const delta = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      offset -= delta * 42;

      if (offset <= -itemWidth) {
        offset += itemWidth;
      }

      applyTransform();
      frameId = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frameId || document.hidden || !isVisible || !itemWidth) return;
      lastTime = 0;
      frameId = requestAnimationFrame(tick);
    };

    const handleVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }

      start();
    };

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? false;

        if (isVisible) {
          start();
          return;
        }

        stop();
      },
      { root: null, threshold: 0, rootMargin: '120px 0px' }
    );

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleMeasure)
      : null;

    const images = Array.from(set.querySelectorAll('img'));
    const onImageLoad = () => scheduleMeasure();

    images.forEach((image) => {
      if (!image.complete) {
        image.addEventListener('load', onImageLoad);
      }
    });

    resizeObserver?.observe(shell);
    resizeObserver?.observe(set);
    intersectionObserver.observe(shell);
    document.addEventListener('visibilitychange', handleVisibility);
    scheduleMeasure();

    return () => {
      stop();
      cancelAnimationFrame(measureFrameId);
      resizeObserver?.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      images.forEach((image) => image.removeEventListener('load', onImageLoad));
    };
  }, []);

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

    // Calendly embed
    const calScript = document.createElement('script');
    calScript.type = 'text/javascript';
    calScript.src = 'https://assets.calendly.com/assets/external/widget.js';
    calScript.async = true;
    document.body.appendChild(calScript);

    return () => {
      hoverCleanups.forEach((cleanup) => cleanup());
      if (document.body.contains(calScript)) document.body.removeChild(calScript);
    };
  }, []);

  return (
    <section style={sectionStyle}>
      <style>{`
        @media (max-width: 767px) {
          #stacked-grid-row {
            grid-template-columns: 1fr !important;
          }
          #stacked-grid-row > * {
            height: 250px !important;
            aspect-ratio: unset !important;
          }
          [data-service-item] {
            height: auto !important;
          }
          [data-service-item] > div {
            aspect-ratio: 16 / 9 !important;
            flex: none !important;
          }
        }
        .section-header-block {
          cursor: default;
          transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .section-header-block:hover {
          opacity: 0.65;
        }
        .deliverables-toggle:hover {
          opacity: 0.7;
        }
        #inline-footer-bullet-list li:last-child {
          padding-bottom: 0 !important;
        }
        @media (max-width: 767px) {
          #inline-footer-bottom {
            justify-content: center !important;
          }
        }
        @media (max-width: 767px) {
          [data-label-heading] {
            color: #000000 !important;
          }
          [data-filter-dropdown] {
            justify-content: center;
          }
          #panel-hero-text-row {
            grid-template-columns: 1fr !important;
            gap: clamp(0.5rem, 2vw, 0.75rem) !important;
          }
          #panel-hero-headline-col {
            width: 100% !important;
            align-items: center !important;
          }
          #panel-hero-headline {
            width: 100% !important;
            text-align: center !important;
            margin-bottom: clamp(0.5rem, 2vw, 0.85rem) !important;
          }
          #panel-hero-cta {
            width: 100% !important;
            justify-content: center !important;
            box-sizing: border-box !important;
          }
          #hero-panel-filter-pills {
            gap: 0.25rem !important;
            padding-top: 0.35rem !important;
            padding-bottom: 0.35rem !important;
            justify-content: center;
          }
          #hero-panel-filter-pills .filter-chip {
            padding: 0.15rem 0.45rem !important;
            font-size: 0.52rem !important;
            border-radius: 999px !important;
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
                      <div id="panel-hero-text-row" style={textRowStyle}>
                        <div id="panel-hero-headline-col" style={textColumnStyle}>
                          <h2 id="panel-hero-headline" style={{ ...headingStyle, fontSize: 'clamp(1.4rem, 3.5vw, 2.45rem)', textAlign: 'left', margin: 0 }}>{slide.headlineText}</h2>
                        </div>
                        <div style={textColumnRightStyle}>
                          <a
                            id="panel-hero-cta"
                            href="https://calendly.com/bballi/30min"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="cta-pill-btn"
                            style={ctaStyle}
                          >
                            <img src="/img/profile2_400x400.png?v=1774582808" style={ctaAvatarStyle} alt="" />
                            {slide.supportText}
                            <span style={ctaIconStyle}>↗</span>
                          </a>
                        </div>
                      </div>
                      <div id="hero-panel-filter-pills" style={filterDropdownStyle}>
                        {FILTERS.map((f) => (
                          <button
                            key={f}
                            type="button"
                            className="filter-chip"
                            style={{ ...filterChipStyle, ...(activeFilter === f ? filterChipActiveStyle : {}) }}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div data-featured-work-label style={featuredWorkLabelStyle}>
                      <button
                        type="button"
                        className="deliverables-toggle"
                        style={deliverablesToggleStyle}
                        onClick={() => setFilterOpen(prev => !prev)}
                        aria-expanded={filterOpen}
                      >
                        <h2 data-label-heading style={{ ...headingStyle, fontSize: 'clamp(1.4rem, 3.5vw, 2.45rem)', textAlign: 'left', margin: 0, opacity: 0 }}>
                          Recent Projects
                        </h2>
                        <svg
                          width="18" height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ transform: filterOpen ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)', flexShrink: 0, color: '#2a2420', opacity: 0 }}
                          aria-hidden="true"
                        >
                          <polyline points="9 6 15 12 9 18" />
                        </svg>
                      </button>
                    </div>
                    <div data-grid-window style={gridWindowStyle}>
                      <div data-grid-inner style={gridInnerContainerStyle}>
                        <div id="stacked-grid-row" style={gridRowStyle}>
                          {slide.gridItems.map((item, index) => {
                            const isQuoteCard = index % 2 === 1;
                            const testimonial = testimonials[Math.floor(index / 2) % testimonials.length];

                            if (isQuoteCard) {
                              return (
                                <article key={item.id} style={testimonialCardStyle}>
                                  <p style={testimonialCardQuoteStyle}>&ldquo;{testimonial.quote}&rdquo;</p>
                                  <div style={testimonialCardAuthorRowStyle}>
                                    <img src={testimonial.img} alt={testimonial.name} style={testimonialCardAvatarStyle} />
                                    <div style={testimonialCardMetaStyle}>
                                      <span style={testimonialCardNameStyle}>{testimonial.name}</span>
                                      <span style={testimonialCardCompanyStyle}>{testimonial.title} · {testimonial.company}</span>
                                    </div>
                                  </div>
                                </article>
                              );
                            }

                            const isFirst = index === 0;
                            return (
                              <div
                                key={item.id}
                                style={{ ...gridItemStyle, overflow: 'hidden', backgroundColor: 'rgba(42, 36, 32, 0.08)', border: '1px solid rgba(42, 36, 32, 0.2)', borderRadius: '0.5rem' }}
                              >
                                <img
                                  src={PORTFOLIO_IMAGES[Math.floor(index / 2) % PORTFOLIO_IMAGES.length]}
                                  alt={`Project frame ${Math.floor(index / 2) + 1}`}
                                  style={isFirst ? gridFeatureImageStyle : gridFrameImageStyle}
                                />
                              </div>
                            );
                          })}
                        </div>
                        {/* Inline footer */}
                        <div id="stacked-inline-footer" style={inlineFooterStyle}>
                          <div style={inlineFooterDividerStyle} />
                          <div id="inline-footer-value-block" style={inlineFooterNewsletterStyle}>
                            <img src="/img/sig.png" alt="Bryan Balli signature" style={inlineFooterSignatureStyle} />

                            <p style={footerValueIntroStyle}>
                              &ldquo;With me in the loop, you get all the high-impact deliverables needed to launch your digital products and cross-platform marketing campaigns.&rdquo;
                            </p>
                            <p style={footerBridgeLabelStyle}>
                              But what matters most:
                            </p>

                            <ul id="inline-footer-bullet-list" style={footerBulletListStyle}>
                              <li style={footerBulletItemStyle}>Your Rough Ideas Ship</li>
                              <li style={footerBulletItemStyle}>Key Insights Become Design Strategy</li>
                              <li style={footerBulletItemStyle}>Design Decisions Create Consistency</li>
                              <li style={footerBulletItemStyle}>Consistency Becomes Product Confidence</li>
                              <li style={footerBulletItemStyle}>Agentic Workflows Are Identified</li>
                              <li style={footerBulletItemStyle}>Handoffs Scale</li>
                            </ul>

                            <div style={{ ...inlineFooterDividerStyle, margin: 0 }} />

                            <div id="inline-footer-credit-row" style={inlineFooterCreditRowStyle}>
                              <div style={inlineFooterCreditLineStyle}>
                                <span style={{ ...testimonialCardNameStyle, fontWeight: 400, lineHeight: 1.55 }}><strong style={{ fontWeight: 700 }}>Bryan Balli</strong> is an experienced Creative Technologist spanning engineering and creative roles at leading agencies and brands—from Chicago, San Francisco and on remote international teams. Currently consulting friends, family and business' alike.</span>
                              </div>
                              <a
                                href="https://calendly.com/bballi/30min"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="cta-pill-btn"
                                style={ctaStyle}
                              >
                                <img src="/img/profile2_400x400.png?v=1774582808" style={ctaAvatarStyle} alt="" />
                                Chat with Bryan
                                <span style={ctaIconStyle}>↗</span>
                              </a>
                            </div>

                            <div id="agency-marquee-shell" ref={marqueeShellRef} style={agencyMarqueeShellStyle}>
                              <div ref={marqueeTrackRef} style={agencyMarqueeTrackStyle}>
                                <div ref={marqueeSetRef} style={agencyMarqueeSetStyle}>
                                  {agencyLogos.map((logo) => (
                                    <img key={`agency-a-${logo.alt}`} src={logo.src} alt={logo.alt} style={logo.scale ? { ...agencyLogoStyle, height: `${22 * logo.scale}px` } : agencyLogoStyle} />
                                  ))}
                                </div>
                                <div aria-hidden="true" style={agencyMarqueeSetStyle}>
                                  {agencyLogos.map((logo) => (
                                    <img key={`agency-b-${logo.alt}`} src={logo.src} alt="" style={logo.scale ? { ...agencyLogoStyle, height: `${22 * logo.scale}px` } : agencyLogoStyle} />
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                          <div style={{ ...inlineFooterDividerStyle, margin: 'clamp(1.5rem, 3vw, 2.5rem) 0' }} />
                          <div id="inline-footer-bottom" style={inlineFooterBottomStyle}>
                            <div style={inlineFooterLegalStyle}>
                              <a href="https://www.linkedin.com/in/bryanballi" style={inlineFooterLegalLinkStyle}>LinkedIn</a>
                              <a href="https://x.com/bai_ee" style={inlineFooterLegalLinkStyle}>𝕏</a>
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

      {/* Particle debug panel */}
      {settingsOpen && (
        <div style={debugPanelStyle}>
          <div style={debugPanelHeaderStyle}>
            <span style={debugPanelTitleStyle}>Particle Settings</span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button
                type="button"
                style={debugPanelSmallBtnStyle}
                onClick={() => {
                  navigator.clipboard?.writeText(JSON.stringify(particleParams, null, 2));
                }}
                title="Copy JSON"
              >
                Copy
              </button>
              <button
                type="button"
                style={debugPanelSmallBtnStyle}
                onClick={() => setParticleParams(PARTICLE_DEFAULTS)}
              >
                Reset
              </button>
              <button
                type="button"
                style={{ ...debugPanelSmallBtnStyle, padding: '0.2rem 0.45rem' }}
                onClick={() => setSettingsOpen(false)}
              >
                ✕
              </button>
            </div>
          </div>

          <div style={debugPanelPresetsStyle}>
            {slides[0].serviceItems.map((item, i) => (
              <span key={item.id} style={debugPresetTagStyle}>
                {item.label.split(' ')[0]}:{' '}
                <em>{item.id === 1 ? 'brain (svg)' : PRESET_KINDS[i % 2 === 0 ? 0 : 2]}</em>
              </span>
            ))}
          </div>

          <div style={debugSlidersStyle}>
            {PARTICLE_SLIDERS.map(({ key, label, min, max, step }) => (
              <div key={key} style={debugSliderRowStyle}>
                <div style={debugSliderLabelRowStyle}>
                  <span style={debugSliderLabelStyle}>{label}</span>
                  <span style={debugSliderValueStyle}>{particleParams[key]}</span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={particleParams[key]}
                  onChange={(e) => setParticleParams(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                  style={debugRangeStyle}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

const sectionStyle = {
  position: 'relative',
  paddingBottom: 0,
};

const quoteSectionStyle = {
  width: '100%',
  marginTop: 'clamp(2rem, 4vw, 3rem)',
  paddingTop: 'clamp(2.5rem, 5vw, 4rem)',
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
  boxSizing: 'border-box',
};

const quoteTextStyle = {
  margin: 0,
  fontSize: 'clamp(2rem, 5vw, 4.2rem)',
  fontWeight: 700,
  lineHeight: 1.08,
  letterSpacing: '-0.04em',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
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
  minHeight: 'calc(100dvh - 64px)',
  display: 'flex',
  justifyContent: 'center',
  position: 'relative',
  boxSizing: 'border-box',
  overflow: 'visible',
  borderRadius: '1rem',
};

const contentStyle = {
  width: '100%',
  height: 'auto',
};

const innerStyle = {
  height: 'auto',
  display: 'flex',
  flexDirection: 'column',
};

const headingStyle = {
  fontSize: 'max(2.8rem, min(8.4vw + 0.7rem, 7rem))',
  fontWeight: 700,
  margin: '0 auto',
  lineHeight: 0.9,
  letterSpacing: '-0.05em',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
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
  overflow: 'visible',
};

const gridLayoutStyle = {
  width: '100%',
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
  gap: '0.5rem',
  padding: '0.25rem 0.75rem 0.25rem 0.25rem',
  fontSize: 'clamp(0.8rem, 1.1vw, 0.875rem)',
  fontWeight: 700,
  letterSpacing: '0.01em',
  textDecoration: 'none',
  color: '#ffffff',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  borderRadius: '999px',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const ctaAvatarStyle = {
  width: '1.75rem',
  height: '1.75rem',
  borderRadius: '50%',
  objectFit: 'cover',
  border: '2px solid rgba(255,255,255,0.35)',
  flexShrink: 0,
  display: 'block',
};

const ctaIconStyle = {
  fontSize: '0.7rem',
  opacity: 0.75,
  marginLeft: '0.1rem',
};

const gridInnerContainerStyle = {
  width: '100%',
  overflowX: 'visible',
  paddingBottom: 'clamp(3rem, 6vw, 5rem)',
  boxSizing: 'border-box',
};

const gridRowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 'clamp(0.7rem, 1.4vw, 1.05rem)',
  width: '100%',
  marginTop: 0,
};

const gridItemStyle = {
  aspectRatio: '16 / 9',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const gridFrameImageStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const gridFeatureImageStyle = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const gridPlaceholderStyle = {
  width: '100%',
  height: '100%',
  backgroundColor: 'rgba(42, 36, 32, 0.08)',
  borderRadius: '0.5rem',
  border: '1px solid rgba(42, 36, 32, 0.2)',
};

const testimonialCardStyle = {
  background: 'transparent',
  borderRadius: '0.5rem',
  aspectRatio: '16 / 9',
  padding: 'clamp(1.5rem, 4vw, 3rem)',
  border: '1px solid rgba(42, 36, 32, 0.1)',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 'clamp(0.75rem, 1.5vw, 1.25rem)',
  boxSizing: 'border-box',
  overflow: 'hidden',
  textAlign: 'center',
};

const testimonialCardQuoteStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 2.4vw, 1.75rem)',
  lineHeight: 1.4,
  letterSpacing: '-0.02em',
  fontStyle: 'italic',
  fontWeight: 400,
  color: 'rgba(42, 36, 32, 0.82)',
  textWrap: 'balance',
};

const testimonialCardAuthorRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.6rem',
};

const testimonialCardAvatarStyle = {
  width: '2rem',
  height: '2rem',
  borderRadius: '50%',
  objectFit: 'cover',
  border: '1px solid rgba(42, 36, 32, 0.14)',
  flexShrink: 0,
  display: 'block',
};

const testimonialCardMetaStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
  flexWrap: 'wrap',
  justifyContent: 'center',
};

const testimonialCardNameStyle = {
  fontSize: 'clamp(0.78rem, 1vw, 0.875rem)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'rgba(42, 36, 32, 0.75)',
};

const testimonialCardCompanyStyle = {
  fontSize: 'clamp(0.72rem, 0.9vw, 0.8rem)',
  fontWeight: 400,
  letterSpacing: '0.02em',
  color: 'rgba(42, 36, 32, 0.38)',
};

const featuredWorkLabelStyle = {
  width: '100%',
  paddingTop: 0,
  paddingBottom: 'clamp(1rem, 2vw, 1.5rem)',
};

const deliverablesToggleStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  background: 'none',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  textAlign: 'left',
  transition: 'opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
};

const filterDropdownStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  paddingTop: 'clamp(0.75rem, 1.5vw, 1rem)',
  paddingBottom: 'clamp(1rem, 2vw, 1.5rem)',
};

const filterChipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.35rem 0.9rem',
  background: 'rgba(42, 36, 32, 0.05)',
  border: '1px solid rgba(42, 36, 32, 0.15)',
  borderRadius: '2rem',
  fontSize: 'clamp(0.72rem, 1vw, 0.82rem)',
  fontWeight: 500,
  letterSpacing: '0.01em',
  color: 'rgba(42, 36, 32, 0.6)',
  cursor: 'default',
  pointerEvents: 'none',
};

const filterChipActiveStyle = {
  background: '#2a2420',
  border: '1px solid #2a2420',
  color: '#f5f1df',
};

const servicesViewportStyle = {
  position: 'relative',
  width: '100%',
};

const servicesCanvasStyle = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  zIndex: 2,
  filter: 'brightness(1.1) contrast(1.08)',
};

const servicesRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 'clamp(0.7rem, 1.4vw, 1.05rem)',
  width: '100%',
};

const serviceItemStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(0.4rem, 0.8vw, 0.6rem)',
  height: 'clamp(130px, 16vh, 200px)',
  overflow: 'hidden',
};

const serviceVisualZoneStyle = {
  flex: 1,
  width: '100%',
  backgroundColor: 'transparent',
  borderRadius: '0.5rem',
  border: '1px solid rgba(42, 36, 32, 0.1)',
};


const serviceLabelStyle = {
  fontSize: 'clamp(0.7rem, 0.95vw, 0.82rem)',
  fontWeight: 500,
  letterSpacing: '0.01em',
  color: 'rgba(42, 36, 32, 0.65)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
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
  display: 'grid',
  gridTemplateColumns: '2.8rem 1fr auto',
  alignItems: 'center',
  gap: '0 clamp(0.75rem, 2vw, 1.75rem)',
  width: '100%',
  padding: 'clamp(1.2rem, 2.2vw, 1.8rem) 0',
  borderBottom: '1px solid rgba(42, 36, 32, 0.12)',
  boxSizing: 'border-box',
};

const hoverItemIndexStyle = {
  fontSize: '0.65rem',
  fontWeight: 500,
  letterSpacing: '0.06em',
  color: 'rgba(42, 36, 32, 0.28)',
  fontVariantNumeric: 'tabular-nums',
  alignSelf: 'center',
};

const hoverItemTagStyle = {
  fontSize: '0.68rem',
  fontWeight: 500,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.35)',
  whiteSpace: 'nowrap',
  alignSelf: 'center',
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
  minWidth: 0,
};

const hoverTitleStyle = {
  margin: 0,
  color: '#2a2420',
  fontSize: 'clamp(1.1rem, 2vw, 2.2rem)',
  lineHeight: 1.08,
  fontWeight: 700,
  letterSpacing: '-0.04em',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};


const testimonialsShellStyle = {
  width: '100%',
  marginTop: 'clamp(2rem, 4vw, 3rem)',
  paddingTop: 'clamp(2.5rem, 5vw, 4rem)',
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
  boxSizing: 'border-box',
};

const featuredQuoteStyle = {
  position: 'relative',
  padding: 'clamp(1.5rem, 3vw, 2.5rem)',
  background: 'rgba(42, 36, 32, 0.03)',
  border: '1px solid rgba(42, 36, 32, 0.1)',
  borderRadius: '0.75rem',
  marginBottom: 'clamp(1rem, 2vw, 1.5rem)',
  overflow: 'hidden',
};

const featuredQuoteMarkStyle = {
  position: 'absolute',
  top: '-0.5rem',
  left: 'clamp(1rem, 2vw, 1.75rem)',
  fontSize: 'clamp(5rem, 10vw, 8rem)',
  lineHeight: 1,
  color: 'rgba(42, 36, 32, 0.06)',
  fontFamily: 'Georgia, serif',
  pointerEvents: 'none',
  userSelect: 'none',
};

const featuredQuoteTextStyle = {
  margin: '0 0 clamp(1rem, 2vw, 1.5rem)',
  fontSize: 'clamp(1rem, 1.8vw, 1.3rem)',
  lineHeight: 1.6,
  fontWeight: 400,
  color: '#2a2420',
  letterSpacing: '-0.01em',
  maxWidth: '62ch',
  position: 'relative',
};

const quoteAttributionStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
};

const quoteAttributionNameStyle = {
  fontSize: 'clamp(0.8rem, 1.1vw, 0.9rem)',
  fontWeight: 700,
  color: '#2a2420',
  letterSpacing: '-0.01em',
};

const quoteAttributionSepStyle = {
  fontSize: '0.75rem',
  color: 'rgba(42, 36, 32, 0.3)',
};

const quoteAttributionRoleStyle = {
  fontSize: 'clamp(0.75rem, 1vw, 0.85rem)',
  color: 'rgba(42, 36, 32, 0.45)',
};

const secondaryQuotesGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: 'clamp(0.75rem, 1.5vw, 1rem)',
};

const secondaryQuoteItemStyle = {
  padding: 'clamp(1rem, 2vw, 1.5rem)',
  border: '1px solid rgba(42, 36, 32, 0.1)',
  borderRadius: '0.75rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
  boxSizing: 'border-box',
};

const secondaryQuoteTextStyle = {
  margin: 0,
  fontSize: 'clamp(0.82rem, 1.2vw, 0.95rem)',
  lineHeight: 1.65,
  color: 'rgba(42, 36, 32, 0.7)',
  fontStyle: 'italic',
  flexGrow: 1,
};

const workHistoryShellStyle = {
  width: '100%',
  marginTop: 'clamp(2rem, 4vw, 3rem)',
  paddingTop: 'clamp(2.5rem, 5vw, 4rem)',
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
  boxSizing: 'border-box',
};

const workHistoryHeaderStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  marginBottom: 'clamp(1.5rem, 3vw, 2.5rem)',
};

const workHistoryEyebrowStyle = {
  fontStyle: 'italic',
  fontSize: 'clamp(0.8rem, 1.2vw, 0.95rem)',
  color: 'rgba(42, 36, 32, 0.5)',
};

const workHistoryHeadlineStyle = {
  margin: 0,
  fontSize: 'clamp(1.8rem, 3.5vw, 2.8rem)',
  fontWeight: 700,
  letterSpacing: '-0.03em',
  lineHeight: 1.1,
  color: '#2a2420',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const workHistoryListStyle = {
  width: '100%',
};

const workHistoryItemStyle = {
  display: 'grid',
  gridTemplateColumns: 'clamp(6rem, 10vw, 9rem) 1fr auto',
  gap: '0 clamp(1rem, 2.5vw, 2rem)',
  padding: 'clamp(1rem, 2vw, 1.5rem) 0',
  borderBottom: '1px solid rgba(42, 36, 32, 0.1)',
  alignItems: 'start',
};

const workHistoryYearStyle = {
  fontSize: 'clamp(0.72rem, 1vw, 0.82rem)',
  color: 'rgba(42, 36, 32, 0.4)',
  letterSpacing: '0.02em',
  paddingTop: '0.2rem',
  whiteSpace: 'nowrap',
};

const workHistoryBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.35rem',
};

const workHistoryRoleRowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.6rem',
  flexWrap: 'wrap',
};

const workHistoryRoleStyle = {
  fontSize: 'clamp(0.95rem, 1.5vw, 1.15rem)',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: '#2a2420',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const workHistoryCompanyStyle = {
  fontSize: 'clamp(0.8rem, 1.1vw, 0.9rem)',
  color: 'rgba(42, 36, 32, 0.45)',
  fontWeight: 400,
};

const workHistoryDescStyle = {
  margin: 0,
  fontSize: 'clamp(0.78rem, 1.1vw, 0.88rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.55)',
  maxWidth: '54ch',
};

const workHistoryBadgeStyle = {
  display: 'inline-block',
  padding: '0.25rem 0.7rem',
  background: 'rgba(42, 36, 32, 0.06)',
  border: '1px solid rgba(42, 36, 32, 0.12)',
  borderRadius: '2rem',
  fontSize: '0.7rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.5)',
  whiteSpace: 'nowrap',
  marginTop: '0.2rem',
};

const rateCardShellStyle = {
  width: '100%',
  background: 'none',
  marginTop: 'clamp(2rem, 4vw, 3rem)',
  paddingTop: 'clamp(2.5rem, 5vw, 4rem)',
  paddingBottom: 0,
  borderTop: '1px solid rgba(42, 36, 32, 0.12)',
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
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

const rateCardSubtextStyle = {
  margin: 0,
  fontSize: 'clamp(0.8rem, 1.2vw, 0.9rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.55)',
  maxWidth: '52ch',
};

const processStepsStyle = {
  width: '100%',
  marginBottom: 'clamp(2rem, 4vw, 3rem)',
};

const processStepItemStyle = {
  display: 'grid',
  gridTemplateColumns: '3rem 1fr',
  gap: '0 clamp(1rem, 2.5vw, 2rem)',
  padding: 'clamp(1.1rem, 2vw, 1.6rem) 0',
  borderBottom: '1px solid rgba(42, 36, 32, 0.1)',
  alignItems: 'start',
};

const processStepNumStyle = {
  fontSize: 'clamp(1.6rem, 2.8vw, 2.4rem)',
  fontWeight: 700,
  letterSpacing: '-0.04em',
  lineHeight: 1,
  color: 'rgba(42, 36, 32, 0.1)',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  paddingTop: '0.1rem',
};

const processStepBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

const processStepTitleStyle = {
  fontSize: 'clamp(1rem, 1.6vw, 1.2rem)',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: '#2a2420',
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  lineHeight: 1.2,
};

const processStepDescStyle = {
  margin: 0,
  fontSize: 'clamp(0.78rem, 1.1vw, 0.88rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.55)',
  maxWidth: '52ch',
};

const textBryanRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '1rem',
  padding: 'clamp(1.2rem, 2.5vw, 2rem) 0',
  flexWrap: 'wrap',
};

const textBryanBtnStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.45rem',
  padding: '0.65rem 1.3rem',
  background: '#2a2420',
  color: '#f5f1df',
  fontSize: 'clamp(0.78rem, 1.1vw, 0.88rem)',
  fontWeight: 600,
  letterSpacing: '0.02em',
  textDecoration: 'none',
  borderRadius: '2rem',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const textBryanHintStyle = {
  fontSize: '0.72rem',
  color: 'rgba(42, 36, 32, 0.38)',
  letterSpacing: '0.02em',
};

const processToPackagesDividerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '1rem',
  marginBottom: 'clamp(1.5rem, 3vw, 2rem)',
};

const processToPackagesLabelStyle = {
  fontSize: '0.68rem',
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'rgba(42, 36, 32, 0.35)',
  whiteSpace: 'nowrap',
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
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
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
  gap: '0.75rem',
  padding: '0.45rem 1.6rem 0.45rem 0.45rem',
  borderRadius: '2rem',
  color: '#ffffff',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  fontSize: 'clamp(0.9rem, 1.3vw, 1rem)',
  fontWeight: 700,
  textDecoration: 'none',
  cursor: 'pointer',
  marginTop: '0.5rem',
  whiteSpace: 'nowrap',
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
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
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
  gap: '0.75rem',
  padding: '0.45rem 1.6rem 0.45rem 0.45rem',
  fontSize: 'clamp(0.9rem, 1.3vw, 1rem)',
  fontWeight: 700,
  letterSpacing: '0.01em',
  color: '#ffffff',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  border: '1px solid rgba(255,255,255,0.22)',
  borderRadius: '2rem',
  boxShadow: '0 0 14px 3px rgba(0,200,228,0.22), 0 2px 6px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
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
  paddingTop: 'clamp(2.5rem, 5vw, 4.5rem)',
  paddingBottom: 'clamp(3rem, 6vw, 5rem)',
  boxSizing: 'border-box',
};

const inlineFooterDividerStyle = {
  width: '100%',
  height: '1px',
  background: 'rgba(42, 36, 32, 0.12)',
  margin: 'clamp(2.5rem, 5vw, 4rem) 0',
};

const inlineFooterNewsletterStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'clamp(1.25rem, 2.5vw, 2rem)',
  textAlign: 'center',
  width: '100%',
};

const inlineFooterHeadingStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 1.8vw, 1.3rem)',
  fontWeight: 600,
  letterSpacing: '-0.02em',
  color: '#2a2420',
};

const inlineFooterSignatureStyle = {
  width: 'min(110px, 31vw)',
  height: 'auto',
  display: 'block',
};

const inlineFooterSubStyle = {
  margin: 0,
  fontSize: 'clamp(0.8rem, 1.1vw, 0.88rem)',
  color: 'rgba(42, 36, 32, 0.5)',
  maxWidth: '36ch',
};

const aboutMeBlockStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '0.75rem',
  maxWidth: '54ch',
};

const aboutMeQuoteStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 2.4vw, 1.75rem)',
  lineHeight: 1.4,
  letterSpacing: '-0.02em',
  fontStyle: 'italic',
  fontWeight: 400,
  color: 'rgba(42, 36, 32, 0.82)',
  textAlign: 'center',
  textWrap: 'balance',
};

const aboutMeBylineStyle = {
  fontSize: 'clamp(0.78rem, 1vw, 0.875rem)',
  fontWeight: 500,
  letterSpacing: '0.01em',
  color: 'rgba(42, 36, 32, 0.4)',
};

const footerValueIntroStyle = {
  margin: 0,
  fontSize: 'clamp(1rem, 2.4vw, 1.75rem)',
  lineHeight: 1.4,
  letterSpacing: '-0.02em',
  fontStyle: 'italic',
  fontWeight: 400,
  color: 'rgba(42, 36, 32, 0.82)',
  textAlign: 'center',
  maxWidth: '100%',
  textWrap: 'balance',
};

const footerValueFollowStyle = {
  margin: 0,
  fontSize: 'clamp(0.95rem, 1.5vw, 1.1rem)',
  lineHeight: 1.4,
  color: '#2a2420',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  textAlign: 'center',
  maxWidth: '36ch',
};

const footerBridgeLabelStyle = {
  margin: 0,
  fontSize: 'clamp(0.78rem, 1vw, 0.875rem)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'rgba(42, 36, 32, 0.75)',
  textAlign: 'center',
};

const footerBulletListStyle = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  maxWidth: '54ch',
  textAlign: 'center',
};

const footerBulletItemStyle = {
  fontSize: 'clamp(0.78rem, 1vw, 0.85rem)',
  lineHeight: 1.5,
  color: 'rgba(42, 36, 32, 0.72)',
  padding: '0.75rem 0',
  borderTop: '1px solid rgba(42, 36, 32, 0.1)',
};

const footerBulletMarkStyle = {};

const footerClosingStyle = {
  margin: 0,
  fontSize: 'clamp(0.78rem, 1vw, 0.875rem)',
  lineHeight: 1.6,
  color: 'rgba(42, 36, 32, 0.42)',
  fontWeight: 500,
  fontStyle: 'italic',
  letterSpacing: '0.01em',
  textAlign: 'center',
  width: '100%',
  maxWidth: '54ch',
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
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.45rem 1.6rem 0.45rem 0.45rem',
  background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), linear-gradient(135deg, hsl(185,100%,45%) 0%, hsl(262,100%,55%) 52%, hsl(314,100%,50%) 100%)',
  border: '1px solid rgba(255,255,255,0.22)',
  borderRadius: '2rem',
  boxShadow: '0 0 14px 3px rgba(0,200,228,0.22), 0 2px 6px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
  color: '#ffffff',
  fontSize: 'clamp(0.9rem, 1.3vw, 1rem)',
  fontWeight: 700,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const agencyMarqueeShellStyle = {
  width: '100%',
  maxWidth: '325px',
  overflow: 'hidden',
  maskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
};

const agencyMarqueeTrackStyle = {
  display: 'flex',
  alignItems: 'center',
  width: 'max-content',
  willChange: 'transform',
  backfaceVisibility: 'hidden',
  transform: 'translate3d(0, 0, 0)',
};

const agencyMarqueeSetStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '2rem',
  paddingRight: '2rem',
  flexShrink: 0,
};

const agencyLogoStyle = {
  height: '22px',
  width: 'auto',
  display: 'block',
  opacity: 0.45,
  filter: 'grayscale(1)',
  flexShrink: 0,
};

const inlineFooterCreditRowStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 'clamp(1.25rem, 2.5vw, 2rem)',
};

const inlineFooterCreditLineStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '0.5rem',
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
  fontSize: '1.4rem',
  color: 'rgba(42, 36, 32, 0.4)',
  textDecoration: 'none',
  cursor: 'pointer',
};

const particleGearButtonStyle = {
  position: 'absolute',
  top: '0.5rem',
  right: '0.5rem',
  zIndex: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '1.75rem',
  height: '1.75rem',
  background: 'rgba(42, 36, 32, 0.55)',
  border: '1px solid rgba(42, 36, 32, 0.2)',
  borderRadius: '0.4rem',
  color: 'rgba(245, 241, 223, 0.8)',
  cursor: 'pointer',
  backdropFilter: 'blur(6px)',
};

const debugPanelStyle = {
  position: 'fixed',
  top: '50%',
  right: '1.25rem',
  transform: 'translateY(-50%)',
  zIndex: 10000,
  width: '260px',
  background: 'rgba(18, 15, 12, 0.96)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '0.875rem',
  boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
  backdropFilter: 'blur(16px)',
  color: '#f5f1df',
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: '0.8rem',
  overflow: 'hidden',
};

const debugPanelHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.75rem 1rem',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
};

const debugPanelTitleStyle = {
  fontSize: '0.75rem',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'rgba(245,241,223,0.6)',
};

const debugPanelSmallBtnStyle = {
  background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '0.3rem',
  color: 'rgba(245,241,223,0.7)',
  fontSize: '0.68rem',
  padding: '0.2rem 0.6rem',
  cursor: 'pointer',
};

const debugPanelPresetsStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.35rem',
  padding: '0.6rem 1rem',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
};

const debugPresetTagStyle = {
  fontSize: '0.65rem',
  color: 'rgba(245,241,223,0.4)',
  background: 'rgba(255,255,255,0.06)',
  borderRadius: '0.25rem',
  padding: '0.1rem 0.4rem',
};

const debugSlidersStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  padding: '0.5rem 1rem 1rem',
  maxHeight: '60vh',
  overflowY: 'auto',
};

const debugSliderRowStyle = {
  paddingTop: '0.55rem',
  paddingBottom: '0.1rem',
};

const debugSliderLabelRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: '0.25rem',
};

const debugSliderLabelStyle = {
  fontSize: '0.72rem',
  color: 'rgba(245,241,223,0.65)',
};

const debugSliderValueStyle = {
  fontSize: '0.7rem',
  fontVariantNumeric: 'tabular-nums',
  color: 'rgba(245,241,223,0.45)',
};

const debugRangeStyle = {
  width: '100%',
  accentColor: '#f5f1df',
  cursor: 'pointer',
};

export default StackedSlidesSection;
