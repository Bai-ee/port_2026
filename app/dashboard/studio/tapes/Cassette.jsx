'use client';

// One cassette deck: an original SVG cassette (generic shell, paper label,
// two reel windows with tape packs that shrink/grow with progress) inside a
// pressable button. Artwork is our own; no real-brand marks or typefaces.

import React from 'react';
import { GLASS } from '../components/rail-ui';
import { labelTitle, packRadii } from './tape-deck-sync';

const SKINS = {
  original: { body: '#46423c', bodyEdge: '#2c2925', paper: '#efe6d2', band: '#d9a441', ink: '#2d2a26', tag: 'ORIGINAL' },
  enhanced: { body: '#27413f', bodyEdge: '#182827', paper: '#e8efeb', band: '#4aa39a', ink: '#17302e', tag: 'ENHANCED' },
};

const HUB_X = { left: 112, right: 208 };
const HUB_Y = 82;
const TEETH = [0, 60, 120, 180, 240, 300];

function Reel({ cx, spinning, delay }) {
  return (
    <g className={'tape-deck-reel' + (spinning ? ' tape-deck-reel--spinning' : '')} style={{ transformOrigin: `${cx}px ${HUB_Y}px`, animationDelay: delay }}>
      <circle cx={cx} cy={HUB_Y} r="15" fill="#f4f1ea" stroke="#bdb7aa" strokeWidth="1" />
      {TEETH.map((deg) => (
        <rect key={deg} x={cx - 2} y={HUB_Y - 15} width="4" height="8" fill="#6c665c" transform={`rotate(${deg} ${cx} ${HUB_Y})`} />
      ))}
      <circle cx={cx} cy={HUB_Y} r="5" fill="#6c665c" />
    </g>
  );
}

export default function Cassette({ id, side, variant, title, active, spinning, progress, onPress }) {
  const skin = SKINS[variant] || SKINS.original;
  const { supply, takeUp } = packRadii(progress);
  const clipId = `tape-deck-${side.toLowerCase()}-window-clip`;
  return (
    <button
      id={id}
      type="button"
      onClick={onPress}
      aria-pressed={active}
      aria-label={`Deck ${side}: ${skin.tag.toLowerCase()} tape${active ? ', now audible' : ', press to listen'}`}
      className={'tape-deck-cassette' + (active ? ' tape-deck-cassette--active' : '')}
      style={{ fontFamily: GLASS.sans }}
    >
      <svg viewBox="0 0 320 204" role="img" aria-hidden="true" focusable="false" style={{ display: 'block', width: '100%', height: 'auto' }}>
        <defs>
          <clipPath id={clipId}><rect x="78" y="56" width="164" height="52" rx="26" /></clipPath>
        </defs>
        <rect x="4" y="4" width="312" height="196" rx="16" fill={skin.body} stroke={skin.bodyEdge} strokeWidth="2" />
        {[[16, 16], [304, 16], [16, 188], [304, 188]].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="3.2" fill={skin.bodyEdge} />
        ))}
        {/* paper label */}
        <rect x="24" y="16" width="272" height="34" rx="5" fill={skin.paper} />
        <rect x="24" y="16" width="272" height="8" rx="4" fill={skin.band} />
        <text x="36" y="43" fontSize="14" fontWeight="700" fill={skin.ink} letterSpacing="0.2">{labelTitle(title)}</text>
        <text x="284" y="43" fontSize="16" fontWeight="800" fill={skin.band} textAnchor="end" stroke={skin.ink} strokeWidth="0.4">{side}</text>
        {/* reel window */}
        <rect x="78" y="56" width="164" height="52" rx="26" fill="#14110f" />
        <g clipPath={`url(#${clipId})`}>
          <circle cx={HUB_X.left} cy={HUB_Y} r={supply} fill="#3a2a20" />
          <circle cx={HUB_X.right} cy={HUB_Y} r={takeUp} fill="#3a2a20" />
        </g>
        <Reel cx={HUB_X.left} spinning={spinning} delay="0s" />
        <Reel cx={HUB_X.right} spinning={spinning} delay="0s" />
        {/* side tag and slot under the window */}
        <rect x="24" y="116" width="272" height="14" rx="3" fill={skin.paper} opacity="0.92" />
        <text x="160" y="126.5" fontSize="8" fontWeight="700" fill={skin.ink} textAnchor="middle" letterSpacing="3">{skin.tag}</text>
        {/* base */}
        <path d="M62 200 L76 140 H244 L258 200 Z" fill={skin.bodyEdge} />
        <rect x="104" y="150" width="112" height="22" rx="4" fill="#14110f" opacity="0.55" />
        {[96, 128, 192, 224].map((x) => <circle key={x} cx={x} cy="186" r="4" fill="#14110f" opacity="0.7" />)}
        <circle cx="160" cy="161" r="6.5" fill="#14110f" opacity="0.7" />
      </svg>
      <span className="tape-deck-cassette-foot">
        <span className={'tape-deck-led' + (active ? ' tape-deck-led--on' : '')} aria-hidden="true" />
        <span className="tape-deck-cassette-name">{side} · {skin.tag}</span>
        <span className="tape-deck-cassette-caption">{active ? 'Now listening' : 'Press to listen'}</span>
      </span>
    </button>
  );
}
