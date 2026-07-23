'use client';

import { memo } from 'react';

// Horizontal showcase strip for recreated sites. Real finished clone jobs are
// passed in as `sites` and render first with their live hostname + a LIVE dot;
// the archetype placeholders below fill the rest of the belt so the strip
// reads as a full row before the queue has enough real runs in it.
//
// The placeholders deliberately carry NO invented hostnames — inventing client
// domains on a commercial page would read as fabricated proof. They show the
// kind of site instead, which also tells a visitor what this thing handles.
const PLACEHOLDER_SITES = [
  { id: 'ph-restaurant', label: 'Restaurant', variant: 'hero', hue: 18 },
  { id: 'ph-portfolio', label: 'Portfolio', variant: 'grid', hue: 262 },
  { id: 'ph-storefront', label: 'Storefront', variant: 'shop', hue: 185 },
  { id: 'ph-studio', label: 'Design Studio', variant: 'editorial', hue: 314 },
  { id: 'ph-local', label: 'Local Service', variant: 'hero', hue: 152 },
  { id: 'ph-editorial', label: 'Magazine', variant: 'editorial', hue: 262 },
  { id: 'ph-landing', label: 'Product Landing', variant: 'grid', hue: 185 },
  { id: 'ph-directory', label: 'Directory', variant: 'shop', hue: 18 },
];

const MIN_TILES = 8;

// ── Wireframe thumbnails ──────────────────────────────────────────────────
// Flat vector site sketches instead of stock photography: they stay on-palette,
// need no network fetch, and never look like someone else's screenshot.

const INK = 'rgba(42,36,32,0.10)';
const INK_SOFT = 'rgba(42,36,32,0.06)';
const INK_LINE = 'rgba(42,36,32,0.14)';

function accentOf(hue) {
  return `hsla(${hue}, 58%, 52%, 0.42)`;
}

function Chrome({ hue }) {
  return (
    <g>
      <rect x="0" y="0" width="320" height="26" fill={INK_SOFT} />
      <circle cx="16" cy="13" r="4.5" fill={accentOf(hue)} />
      <rect x="232" y="9" width="30" height="8" rx="4" fill={INK} />
      <rect x="268" y="9" width="36" height="8" rx="4" fill={INK} />
    </g>
  );
}

function Wireframe({ variant, hue }) {
  const accent = accentOf(hue);
  return (
    <svg viewBox="0 0 320 200" width="100%" height="100%" role="presentation" focusable="false" style={{ display: 'block' }}>
      <rect x="0" y="0" width="320" height="200" fill="#fbf8f4" />
      <Chrome hue={hue} />

      {variant === 'hero' ? (
        <g>
          <rect x="16" y="46" width="150" height="16" rx="4" fill={INK_LINE} />
          <rect x="16" y="70" width="112" height="9" rx="4" fill={INK} />
          <rect x="16" y="85" width="132" height="9" rx="4" fill={INK} />
          <rect x="16" y="108" width="58" height="18" rx="9" fill={accent} />
          <rect x="186" y="46" width="118" height="80" rx="7" fill={INK} />
          <rect x="16" y="146" width="90" height="38" rx="6" fill={INK_SOFT} />
          <rect x="115" y="146" width="90" height="38" rx="6" fill={INK_SOFT} />
          <rect x="214" y="146" width="90" height="38" rx="6" fill={INK_SOFT} />
        </g>
      ) : null}

      {variant === 'grid' ? (
        <g>
          <rect x="16" y="42" width="96" height="11" rx="4" fill={INK_LINE} />
          <rect x="16" y="66" width="88" height="52" rx="6" fill={INK} />
          <rect x="112" y="66" width="88" height="52" rx="6" fill={accent} />
          <rect x="208" y="66" width="96" height="52" rx="6" fill={INK} />
          <rect x="16" y="126" width="88" height="52" rx="6" fill={INK} />
          <rect x="112" y="126" width="88" height="52" rx="6" fill={INK_SOFT} />
          <rect x="208" y="126" width="96" height="52" rx="6" fill={INK} />
        </g>
      ) : null}

      {variant === 'editorial' ? (
        <g>
          <rect x="16" y="42" width="72" height="136" rx="6" fill={INK_SOFT} />
          <rect x="26" y="54" width="52" height="7" rx="3" fill={INK} />
          <rect x="26" y="68" width="44" height="7" rx="3" fill={INK} />
          <rect x="26" y="82" width="50" height="7" rx="3" fill={INK} />
          <rect x="100" y="42" width="204" height="66" rx="7" fill={INK} />
          <rect x="100" y="120" width="168" height="12" rx="4" fill={INK_LINE} />
          <rect x="100" y="142" width="204" height="8" rx="4" fill={INK} />
          <rect x="100" y="156" width="188" height="8" rx="4" fill={INK} />
          <rect x="100" y="170" width="64" height="8" rx="4" fill={accent} />
        </g>
      ) : null}

      {variant === 'shop' ? (
        <g>
          <rect x="16" y="40" width="288" height="46" rx="7" fill={accent} />
          <rect x="16" y="98" width="66" height="48" rx="6" fill={INK} />
          <rect x="90" y="98" width="66" height="48" rx="6" fill={INK} />
          <rect x="164" y="98" width="66" height="48" rx="6" fill={INK} />
          <rect x="238" y="98" width="66" height="48" rx="6" fill={INK} />
          <rect x="16" y="154" width="40" height="7" rx="3" fill={INK_LINE} />
          <rect x="90" y="154" width="40" height="7" rx="3" fill={INK_LINE} />
          <rect x="164" y="154" width="40" height="7" rx="3" fill={INK_LINE} />
          <rect x="238" y="154" width="40" height="7" rx="3" fill={INK_LINE} />
        </g>
      ) : null}
    </svg>
  );
}

// ── Tile ──────────────────────────────────────────────────────────────────

// Thumbnail only. The hostname / Live-Sample chips under each tile were
// removed — the belt reads as a texture strip, and a real run still gets its
// preview link from the nav.
const SiteTile = memo(function SiteTile({ site, ariaHidden }) {
  const inner = (
    <span className="recreate-site-tile-frame">
      <Wireframe variant={site.variant} hue={site.hue} />
    </span>
  );

  if (site.href && !ariaHidden) {
    return (
      <a
        className="recreate-site-tile"
        href={site.href}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open the recreated preview of ${site.label}`}
      >
        {inner}
      </a>
    );
  }

  return (
    <span className="recreate-site-tile" aria-hidden={ariaHidden ? 'true' : undefined}>
      {inner}
    </span>
  );
});

// ── Belt ──────────────────────────────────────────────────────────────────

export default function RecreatedSitesMarquee({ sites = [] }) {
  const live = sites.slice(0, MIN_TILES);
  const filler = PLACEHOLDER_SITES.slice(0, Math.max(MIN_TILES - live.length, 0));
  const belt = [...live, ...filler];
  if (!belt.length) return null;

  // Constant per-tile pace so adding real sites lengthens the loop instead of
  // speeding it up. One full pass = half the duplicated track.
  const durationMs = belt.length * 4200;

  return (
    <section id="recreate-showcase-section" aria-label="Sites recreated with HITLOOP">
      <div id="recreate-showcase-belt-shell">
        <div id="recreate-showcase-belt-track" style={{ animationDuration: `${durationMs}ms` }}>
          <div className="recreate-showcase-belt-set">
            {belt.map((site) => (
              <SiteTile key={`belt-a-${site.id}`} site={site} />
            ))}
          </div>
          <div className="recreate-showcase-belt-set" aria-hidden="true">
            {belt.map((site) => (
              <SiteTile key={`belt-b-${site.id}`} site={site} ariaHidden />
            ))}
          </div>
        </div>
      </div>

      <style>{`
        #recreate-showcase-section {
          position: relative;
          z-index: 2;
          width: 100%;
          margin: clamp(2rem, 6vh, 3.25rem) 0 clamp(1.5rem, 5vh, 2.5rem);
        }
        #recreate-showcase-belt-shell {
          width: 100%;
          overflow: hidden;
          -webkit-mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
          mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
        }
        #recreate-showcase-belt-track {
          display: flex;
          width: max-content;
          will-change: transform;
          animation-name: recreateShowcaseBelt;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        #recreate-showcase-belt-shell:hover #recreate-showcase-belt-track,
        #recreate-showcase-belt-shell:focus-within #recreate-showcase-belt-track {
          animation-play-state: paused;
        }
        .recreate-showcase-belt-set {
          display: flex;
          align-items: flex-start;
          gap: clamp(0.75rem, 1.6vw, 1.15rem);
          padding-right: clamp(0.75rem, 1.6vw, 1.15rem);
          flex-shrink: 0;
        }
        @keyframes recreateShowcaseBelt {
          from { transform: translate3d(0, 0, 0); }
          to { transform: translate3d(-50%, 0, 0); }
        }

        .recreate-site-tile {
          display: block;
          width: clamp(13rem, 21vw, 16.5rem);
          flex-shrink: 0;
          text-decoration: none;
          transition: transform 320ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        a.recreate-site-tile:hover,
        a.recreate-site-tile:focus-visible {
          transform: translateY(-4px);
        }
        a.recreate-site-tile:focus-visible {
          outline: 2px solid rgba(47, 111, 237, 0.55);
          outline-offset: 4px;
          border-radius: 0.95rem;
        }
        .recreate-site-tile-frame {
          display: block;
          aspect-ratio: 16 / 10;
          overflow: hidden;
          border-radius: 0.85rem;
          background: rgba(255, 255, 255, 0.5);
          border: 1px solid rgba(212, 196, 171, 0.82);
          box-shadow: 0 1px 0 rgba(255,255,255,0.65), inset 0 1px 0 rgba(255,255,255,0.4);
          transition: box-shadow 320ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        a.recreate-site-tile:hover .recreate-site-tile-frame {
          box-shadow: 0 14px 28px -16px rgba(42, 36, 32, 0.35), inset 0 1px 0 rgba(255,255,255,0.5);
        }
        @media (prefers-reduced-motion: reduce) {
          #recreate-showcase-belt-shell {
            overflow-x: auto;
            scrollbar-width: none;
          }
          #recreate-showcase-belt-track { animation: none; }
        }
      `}</style>
    </section>
  );
}
