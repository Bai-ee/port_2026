// gsap-kit.js — Shared animation presets for lead gen preview sites.
// Every generated site copies this file and references it after GSAP CDN loads.
// Sections declare animations via data-gsap="presetName"; no custom GSAP code needed.
// Dependencies: GSAP 3.12+ and ScrollTrigger loaded via CDN before this file.

(function () {
  'use strict';

  gsap.registerPlugin(ScrollTrigger);

  const DEFAULTS = {
    duration: 0.8,
    ease: 'power2.out',
    triggerOffset: 'top 85%',
    stagger: 0.1,
  };

  // ─── PRESETS ─────────────────────────────────────────────────────────────────

  const presets = {

    // Hero parallax — background image moves slower than scroll
    heroParallax: (el) => {
      const bg = el.querySelector('[data-parallax]') || el.querySelector('img');
      if (!bg) return;
      gsap.to(bg, {
        yPercent: 30,
        ease: 'none',
        scrollTrigger: {
          trigger: el,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
        },
      });
    },

    // Text reveal — elements stagger in from below
    textReveal: (el) => {
      el.querySelectorAll('[data-reveal]').forEach((target) => {
        gsap.from(target, {
          y: 40,
          opacity: 0,
          duration: DEFAULTS.duration,
          ease: DEFAULTS.ease,
          scrollTrigger: {
            trigger: target,
            start: DEFAULTS.triggerOffset,
            toggleActions: 'play none none none',
          },
        });
      });
    },

    // Fade up — universal section entrance
    fadeUp: (el) => {
      const items = el.querySelectorAll('[data-animate]');
      const targets = items.length ? items : [el];
      gsap.from(targets, {
        y: 30,
        opacity: 0,
        duration: DEFAULTS.duration,
        ease: DEFAULTS.ease,
        stagger: DEFAULTS.stagger,
        scrollTrigger: {
          trigger: el,
          start: DEFAULTS.triggerOffset,
          toggleActions: 'play none none none',
        },
      });
    },

    // Stagger grid — cards/items appear one by one
    staggerGrid: (el) => {
      const items = el.querySelectorAll('[data-animate]');
      if (!items.length) return;
      gsap.from(items, {
        y: 40,
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out',
        stagger: 0.12,
        scrollTrigger: {
          trigger: el,
          start: DEFAULTS.triggerOffset,
          toggleActions: 'play none none none',
        },
      });
    },

    // Slide cards — horizontal entrance for testimonials / card carousels
    slideCards: (el) => {
      const items = el.querySelectorAll('[data-animate]');
      if (!items.length) return;
      gsap.from(items, {
        x: 60,
        opacity: 0,
        duration: 0.7,
        ease: 'power2.out',
        stagger: 0.15,
        scrollTrigger: {
          trigger: el,
          start: DEFAULTS.triggerOffset,
          toggleActions: 'play none none none',
        },
      });
    },

    // Counter up — number counts from 0 to data-counter value
    counterUp: (el) => {
      el.querySelectorAll('[data-counter]').forEach((counter) => {
        const target = parseInt(counter.dataset.counter, 10);
        if (isNaN(target)) return;
        const obj = { val: 0 };
        gsap.to(obj, {
          val: target,
          duration: 2,
          ease: 'power1.out',
          scrollTrigger: {
            trigger: counter,
            start: DEFAULTS.triggerOffset,
            toggleActions: 'play none none none',
          },
          onUpdate: () => {
            counter.textContent = Math.round(obj.val).toLocaleString();
          },
        });
      });
    },

    // Scale in — for logos, badges, trust indicators
    scaleIn: (el) => {
      const items = el.querySelectorAll('[data-animate]');
      const targets = items.length ? items : [el];
      gsap.from(targets, {
        scale: 0.8,
        opacity: 0,
        duration: 0.6,
        ease: 'back.out(1.4)',
        stagger: 0.08,
        scrollTrigger: {
          trigger: el,
          start: DEFAULTS.triggerOffset,
          toggleActions: 'play none none none',
        },
      });
    },

    // Line draw — for decorative SVG paths
    lineDraw: (el) => {
      el.querySelectorAll('path[data-draw]').forEach((path) => {
        const length = path.getTotalLength();
        gsap.set(path, { strokeDasharray: length, strokeDashoffset: length });
        gsap.to(path, {
          strokeDashoffset: 0,
          duration: 1.5,
          ease: 'power2.inOut',
          scrollTrigger: {
            trigger: path,
            start: DEFAULTS.triggerOffset,
            toggleActions: 'play none none none',
          },
        });
      });
    },
  };

  // ─── AUTO-INIT ───────────────────────────────────────────────────────────────
  // Sections declare their animation via data-gsap="presetName"

  function init() {
    document.querySelectorAll('[data-gsap]').forEach((el) => {
      const name = el.dataset.gsap;
      if (presets[name]) presets[name](el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.GsapKit = { presets, init, DEFAULTS };
})();
