'use client';

import React from 'react';

/*
 * Static, hard-coded recreations of the HITLOOP dashboard deliverable cards,
 * matching the real card design (uppercase title → asset shell with a download
 * circle → GENERATED timestamp → STATUS: PASSED + description → ACTIVE footer
 * with action buttons). Shown as floating hover previews for the homepage
 * deliverables table rows (desktop only). Values are NOT dynamic — every asset
 * URL is HITLOOP's own existing render, pulled from the published Creative Brief.
 */

// All HITLOOP renders saved locally in the repo (the Firebase download tokens
// are permission-locked), so they load reliably and match the dashboard.
const ASSETS = {
  mockup: '/img/deliverables/hitloop-device-mockup.png',
  fullpage: '/img/deliverables/hitloop-fullpage.jpg',
  social: '/img/deliverables/hitloop-social.jpg',
  video: '/img/deliverables/hitloop-video.mp4',
  postme: '/img/deliverables/hitloop-postme-frame.png',
  brief: '/creative-brief-hitloop.html',
};

// Auto-scroll tease for the Creative Brief iframe — mirrors the dashboard's
// startBriefTease: after a short delay, scroll the (same-origin) brief from the
// top down at a steady pace so the cover reads first, then reveals the page.
// Duration-based tease (NOT the dashboard's slow px/s, which is imperceptible in
// a hover): ease the brief from top to bottom over ~6s, pause, loop back. This
// reads as a clear "scroll through the brief" while hovered.
function briefTease(iframe) {
  if (!iframe) return;
  let win, doc;
  try { win = iframe.contentWindow; doc = iframe.contentDocument; } catch { return; }
  if (!win || !doc) return;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  if (iframe._teaseRaf) cancelAnimationFrame(iframe._teaseRaf);
  if (iframe._teaseTimer) clearTimeout(iframe._teaseTimer);
  const START_DELAY_MS = 600;
  const DURATION_MS = 25350; // 30% slower than 19.5s
  const PAUSE_MS = 1600;
  const maxScroll = () => Math.max(0, (doc.documentElement?.scrollHeight || doc.body?.scrollHeight || 0) - win.innerHeight);
  const runPass = () => {
    const max = maxScroll();
    if (max < 4) { iframe._teaseTimer = setTimeout(runPass, PAUSE_MS); return; }
    let startTs = null;
    const step = (ts) => {
      if (startTs == null) startTs = ts;
      const p = Math.min(1, (ts - startTs) / DURATION_MS);
      // Linear — constant speed the whole pass (no ease-in/out acceleration).
      win.scrollTo(0, max * p);
      if (p < 1) { iframe._teaseRaf = requestAnimationFrame(step); return; }
      // Reached bottom → pause, reset, loop.
      iframe._teaseTimer = setTimeout(() => { win.scrollTo(0, 0); iframe._teaseTimer = setTimeout(runPass, 400); }, PAUSE_MS);
    };
    iframe._teaseRaf = requestAnimationFrame(step);
  };
  win.scrollTo(0, 0);
  iframe._teaseTimer = setTimeout(runPass, START_DELAY_MS);
}

const FONT = "'Space Grotesk', system-ui, sans-serif";
const MONO = "'Space Mono', monospace";

// Shell fill gradient: cream → lavender (F7F0EA → D6CBD7).
const SHELL_GRAD = 'linear-gradient(135deg, #F7F0EA 0%, #D6CBD7 100%)';

const cardStyle = {
  width: 'clamp(320px, 25vw, 380px)',
  boxSizing: 'border-box',
  // Glass: mostly transparent so the blurred background shows through.
  background: 'rgba(252,250,246,0.18)',
  backdropFilter: 'blur(18px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(18px) saturate(1.2)',
  border: '1px solid rgba(255,255,255,0.55)',
  borderRadius: '14px',
  boxShadow: '0 30px 90px rgba(0,0,0,0.34), 0 4px 14px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.6)',
  padding: '1.1rem 1.1rem 0.95rem',
  fontFamily: FONT,
  color: '#1c1814',
};
const titleStyle = { margin: '0 0 0.85rem', fontSize: '1.4rem', fontWeight: 800, lineHeight: 1, letterSpacing: '-0.01em', textTransform: 'uppercase' };
const shellStyle = {
  position: 'relative',
  width: '100%',
  aspectRatio: '16 / 10',
  borderRadius: '12px',
  overflow: 'hidden',
  background: SHELL_GRAD,
  border: '1px solid rgba(42,36,32,0.1)',
};
const imgCover = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const genStyle = { display: 'block', margin: '0.8rem 0 0.5rem', fontFamily: MONO, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.45)' };
const descStyle = { margin: 0, fontSize: '0.92rem', lineHeight: 1.4, color: '#2a2420' };
const statusTagStyle = { display: 'inline', fontFamily: MONO, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#15803d', background: 'rgba(34,197,94,0.16)', padding: '0.12rem 0.4rem', borderRadius: '4px', marginRight: '0.45rem', whiteSpace: 'nowrap' };
const footStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', gap: '0.6rem' };
const footStatusStyle = { display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontFamily: MONO, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.55)' };
const dotStyle = { width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 5px 2px rgba(34,197,94,0.45)', flexShrink: 0 };
const btnGroupStyle = { display: 'inline-flex', alignItems: 'center', gap: '0.4rem' };
const btnStyle = { display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontFamily: MONO, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#2a2420', background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(42,36,32,0.2)', borderRadius: '7px', padding: '0.45rem 0.6rem', whiteSpace: 'nowrap' };

// Per-item shell visuals (the embedded preview each dashboard card renders).
const SHELLS = {
  'creative-brief': (
    <div style={shellStyle}>
      <iframe
        title="Creative Brief preview"
        src={ASSETS.brief}
        onLoad={(e) => briefTease(e.currentTarget)}
        style={{ position: 'absolute', top: 0, left: 0, width: '400%', height: '400%', border: 0, transform: 'scale(0.25)', transformOrigin: 'top left', pointerEvents: 'none', background: '#fff' }}
      />
    </div>
  ),
  'social-preview': (
    <div style={shellStyle}>
      <img src={ASSETS.social} alt="HITLOOP social share preview" style={imgCover} />
    </div>
  ),
  'device-mockups': (
    <div style={shellStyle}>
      <img src={ASSETS.mockup} alt="HITLOOP multi-device mockup" style={imgCover} />
    </div>
  ),
  'full-page': (
    <div style={shellStyle}>
      <img src={ASSETS.fullpage} alt="HITLOOP full-page screenshot" style={{ ...imgCover, objectPosition: 'center top' }} />
    </div>
  ),
  'video-post': (
    <div style={shellStyle}>
      <video src={ASSETS.video} autoPlay muted loop playsInline style={imgCover} />
    </div>
  ),
  'post-me': (
    // Post format kept (postme frame, media area blacked out) with the live
    // website video sitting in that region — objectFit:contain preserves the
    // video's ratio; its letterbox is black, matching the blacked media area.
    <div style={{ ...shellStyle, background: '#000', aspectRatio: '542 / 362' }}>
      <img src={ASSETS.postme} alt="HITLOOP social post" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block' }} />
      <video
        src={ASSETS.video}
        autoPlay muted loop playsInline
        style={{ position: 'absolute', left: '7.75%', top: '26.2%', width: '84.9%', height: '63.3%', objectFit: 'contain', display: 'block' }}
      />
    </div>
  ),
};

// Card chrome content per item.
const CARDS = {
  'creative-brief': {
    title: 'Creative Brief',
    desc: 'A visual audit of your site delivered as a Creative Brief that replaces traditional onboarding.',
    action: 'Open Brief',
  },
  'social-preview': {
    title: 'Social Preview',
    desc: 'See how your site appears when shared across platforms.',
    action: 'View',
  },
  'device-mockups': {
    title: 'Device Mockups',
    desc: 'See how your homepage loads across different devices.',
    action: 'View',
  },
  'full-page': {
    title: 'Full Page Views',
    desc: 'See full-page screenshots to confirm content and consistency.',
    action: 'View',
  },
  'video-post': {
    title: 'Video Mockup',
    desc: 'Turn your site into a social-ready promo video, ready to post.',
    action: 'Run Video',
  },
  'post-me': {
    title: 'Post Me',
    desc: 'See your brand as a finished social post, ready to publish.',
    action: 'View',
  },
};

const GENERATED = 'GENERATED JUN 23, 2026, 1:59 PM EST';

export default function DeliverableHoverCard({ id, shown = true, rot = 3.2, offX = 520, width, noShadow = false }) {
  const card = CARDS[id];
  if (!card) return null;
  return (
    <>
      <article
        aria-hidden="true"
        style={{
          ...cardStyle,
          ...(width ? { width } : null),
          // Flat variant (deck): drop the heavy cast shadow and define each card
          // edge with a visible border instead, so a stack doesn't read as heavy.
          ...(noShadow
            ? {
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
                border: '1px solid rgba(42,36,32,0.28)',
              }
            : null),
          transformOrigin: rot >= 0 ? 'center left' : 'center right',
          // Smooth slide (from the off-screen side) + fade + rotation, in and out.
          transition: 'opacity 0.55s cubic-bezier(0.22, 1, 0.36, 1), transform 0.72s cubic-bezier(0.22, 1, 0.36, 1)',
          opacity: shown ? 1 : 0,
          // scale(0.8) → cards 20% smaller (uniform: chrome, type, media).
          transform: shown ? `translateX(0) rotate(${rot}deg) scale(0.8)` : `translateX(${offX}px) rotate(${rot * 1.8}deg) scale(0.8)`,
        }}
      >
        <h3 style={titleStyle}>{card.title}</h3>
        {SHELLS[id]}
        <span style={genStyle}>{GENERATED}</span>
        <p style={descStyle}><span style={statusTagStyle}>STATUS: PASSED</span>{card.desc}</p>
        <div style={footStyle}>
          <span style={footStatusStyle}><span style={dotStyle} />Active</span>
          <span style={btnGroupStyle}>
            <span style={btnStyle}>{card.action}</span>
            <span style={btnStyle}>Details <span aria-hidden="true">↗</span></span>
          </span>
        </div>
      </article>
    </>
  );
}

export const DELIVERABLE_CARD_IDS = Object.keys(CARDS);

// Asset URLs to warm-cache before first hover so cards render without a flash.
export const PRELOAD_ASSETS = {
  images: [ASSETS.mockup, ASSETS.fullpage, ASSETS.social, ASSETS.postme],
  video: ASSETS.video,
  brief: ASSETS.brief,
};
