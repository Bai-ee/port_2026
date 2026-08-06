'use client';

// UNDER-CANVAS TIMELINE STRIP — pure UI relocation. Ports the Mockup Video
// studio's own under-canvas transport (page.jsx ~L2408-2546: the circular
// Play/Stop/Reset transport row + `#studio-timeline-transport`'s pill track
// with progress fill / playhead line+ball / diamond markers / inline
// DURATION field — TL_PAD, tlLeft, the track geometry, all ported 1:1) into
// ClothStudio's stage column, taking over the track/gesture/transport UI
// that used to live inside the right-rail StudioTimelineCard (that card is
// now a slimmed settings card — see its own header comment).
//
// Every prop below is the SAME handler ClothStudio.jsx already wired into
// the old card (plus `onAddKeyframe`, a second call site into the very same
// `addKeyframe` handler — see ClothStudio.jsx's own render site). NO
// playback/blend/keyframe logic lives here or changed anywhere in this
// pass — the gesture math (trackUFromEvent/snapU/onTrack*/onPlayhead*) is
// copied verbatim from the old StudioTimelineCard.jsx.
//
// Chrome: even though the stage box above it fills #0b0b0f, the STRIP
// itself sits on the studio board's own light chrome (GLASS.bg — the same
// cream gradient the right rail sits on), same as page.jsx's own
// #studio-timeline-transport does under its (also dark) artboard. So the
// strip's colors are ported VERBATIM from page.jsx (L2440-2545), not
// recolored — circles/track/playhead/markers/duration field all use the
// same GLASS.hair/ink/inkMute + rgba(255,255,255,*) light-glass values, via
// the shared `GLASS`/`ui` imported from './rail-ui' (identical token values
// to page.jsx's own local GLASS object). Accent: `#ec4899` for the
// playhead/progress-fill (same value page.jsx's own playhead uses, and the
// same pink this studio's HUD "SHOT CAM LIVE" label / BACKGROUND+CAMERA
// rail cards already use), `GLASS.accent` (cyan→purple→pink gradient) for
// the active-button gradient-hairline ring, matching page.jsx's own
// transport circles 1:1.

import React, { useCallback, useRef } from 'react';
import {
  Play, Square, RotateCcw, Download, Repeat, Monitor, Smartphone, Tablet, Trash2,
} from 'lucide-react';
import { GLASS, ui } from './rail-ui';
import { MAX_TIMELINE_KEYFRAMES } from '../timeline';

const ACCENT = '#ec4899';

// Same TL_PAD/tlLeft convention as both page.jsx and the old card — the
// track's usable region is inset by this many px on each side so the
// first/last keys and the playhead ball sit fully within the pill.
const TL_PAD = 14;
const tlLeft = (t) => `calc(${TL_PAD}px + ${t} * (100% - ${TL_PAD * 2}px))`;

function trackUFromEvent(e, trackEl) {
  const rect = trackEl?.getBoundingClientRect();
  if (!rect) return 0;
  const span = rect.width - TL_PAD * 2;
  return Math.min(1, Math.max(0, (e.clientX - rect.left - TL_PAD) / span));
}

// Snaps a scrub position to a nearby keyframe (threshold 0.022) — ported
// verbatim from the old card / page.jsx's own snapU.
function snapU(u, keyframes) {
  let best = u, bestD = 0.022;
  keyframes.forEach((k) => {
    const d = Math.abs(k.t - u);
    if (d < bestD) { bestD = d; best = k.t; }
  });
  return best;
}

export default function StudioTimelineStrip({
  timeline,
  scrubU,
  playing,
  selectedKeyframeId, onSelectKeyframe,
  onAddKeyframeAt,
  onAddKeyframe,
  onDeleteKeyframe,
  onRetimeKeyframe,
  onScrubTo,
  onPlay, onReset, onStop,
  onExport,
  onTotalSecondsChange,
  onLoopToggle,
  onClearKeyframes,
  // Camera moves (Mockup Video's authored templates, ported): a picker next
  // to Clear — choosing one replaces the timeline with that camera ride.
  cameraTemplates, onApplyCameraTemplate,
  recording,
  // Device zone (owner direction, 2026-08-01 — mirror the Mockup Video
  // bar): Desktop/Mobile/Tablet buttons in the left zone. `deviceActive`
  // = the Device subject is the current primary shape; clicking a button
  // both switches the subject to Device and picks that viewport.
  deviceViewport, deviceActive, onSelectDevice,
}) {
  const keyframes = timeline?.keyframes || [];
  // Same "editing locked while playing/recording" rule as the old card —
  // a playback session snapshots `timeline` at Play/Loop/Export time, so a
  // mutation mid-playback would silently diverge from what's animating.
  const locked = playing || recording;
  const canAdd = keyframes.length < MAX_TIMELINE_KEYFRAMES;
  const canExport = keyframes.length >= 2 && !recording && !playing;

  const trackRef = useRef(null);
  const dragRef = useRef(null); // { keyId, downU, moved, longFired, timer } while dragging a marker, { scrub: true } while dragging the playhead
  const lastTapRef = useRef({ time: 0, u: 0, keyId: null });

  // ── Gesture handlers — copied verbatim from StudioTimelineCard.jsx. ──
  const onTrackPointerDown = useCallback((e) => {
    if (locked) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const keyId = e.target.dataset?.keyId || null;
    const downU = trackUFromEvent(e, trackRef.current);
    const drag = { keyId, downU, moved: false, longFired: false, timer: null };
    if (keyId) {
      onSelectKeyframe(keyId);
      drag.timer = setTimeout(() => {
        if (dragRef.current && !dragRef.current.moved) { dragRef.current.longFired = true; onDeleteKeyframe(keyId); }
      }, 450);
    }
    dragRef.current = drag;
  }, [locked, onSelectKeyframe, onDeleteKeyframe]);

  const onTrackPointerMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag || drag.scrub) return;
    const u = trackUFromEvent(e, trackRef.current);
    if (!drag.moved && Math.abs(u - drag.downU) > 0.01) {
      drag.moved = true;
      if (drag.timer) { clearTimeout(drag.timer); drag.timer = null; }
    }
    if (drag.moved && drag.keyId && !drag.longFired) {
      onRetimeKeyframe(drag.keyId, u);
    }
  }, [onRetimeKeyframe]);

  const onTrackPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.scrub) return;
    if (drag.timer) clearTimeout(drag.timer);
    if (drag.longFired || drag.moved) return; // already deleted, or it was a drag-retime
    const now = Date.now();
    const last = lastTapRef.current;
    const isDouble = (now - last.time) < 320 && Math.abs(drag.downU - last.u) < 0.05 && last.keyId === drag.keyId;
    if (isDouble) {
      lastTapRef.current = { time: 0, u: 0, keyId: null };
      if (drag.keyId) onDeleteKeyframe(drag.keyId); else onAddKeyframeAt(drag.downU);
      return;
    }
    // Single tap — already selected on pointer-down; also jumps the
    // playhead to this keyframe's own t (deviation from page.jsx's own
    // track, ported from the old card as-is).
    if (drag.keyId) {
      const kf = keyframes.find((k) => k.id === drag.keyId);
      if (kf) onScrubTo(kf.t);
    }
    lastTapRef.current = { time: now, u: drag.downU, keyId: drag.keyId };
  }, [onDeleteKeyframe, onAddKeyframeAt, onScrubTo, keyframes]);

  // Playhead ball — the only scrub handle. Drag it to move the playhead; it
  // snaps to keyframes.
  const onPlayheadPointerDown = useCallback((e) => {
    if (locked) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { scrub: true };
  }, [locked]);

  const onPlayheadPointerMove = useCallback((e) => {
    if (!dragRef.current?.scrub) return;
    const u = trackUFromEvent(e, trackRef.current);
    onScrubTo(snapU(u, keyframes));
  }, [onScrubTo, keyframes]);

  const onPlayheadPointerUp = useCallback(() => { dragRef.current = null; }, []);

  // Row 1 — circular transport: Play / Stop / Reset, matching page.jsx's
  // own 3-button set (page.jsx L2437-2441) icon-for-icon — Play size={17}
  // fill="currentColor", Stop (Square) size={15} fill="currentColor", Reset
  // (RotateCcw) size={16} strokeWidth={2.5}. No separate Loop button (a
  // previous round ported page.jsx's own extra "Play" label semantics as an
  // explicit-loop shortcut — removed; see playTimeline's own comment in
  // ClothStudio.jsx). Looping is the persisted `timeline.loop` preference
  // (rail StudioTimelineCard toggle) that Play already honors.
  //
  // Disabled gating keeps this studio's own pre-existing safety rule (never
  // let Stop/Reset touch playback/scene state mid-recording — the old rail
  // card's timeline-reset-btn/play-btn already disabled on `recording`)
  // layered on top of page.jsx's own per-button gates (Play: keyframes<2,
  // Stop: !playing).
  const transportBtns = [
    { key: 'play', label: 'Play', icon: <Play size={17} fill="currentColor" />, onClick: onPlay, active: playing, disabled: recording || keyframes.length < 2 },
    { key: 'stop', label: 'Stop', icon: <Square size={15} fill="currentColor" />, onClick: onStop, active: false, disabled: recording || !playing },
    { key: 'reset', label: 'Reset', icon: <RotateCcw size={16} strokeWidth={2.5} />, onClick: onReset, active: false, disabled: recording },
    // Clear — wipes EVERY keyframe (owner ask). Not undoable; the disabled
    // gates (empty timeline, mid-playback/recording) are the only guard —
    // matches the strip's confirm-free delete idiom (double-click/long-press).
    { key: 'clear', label: 'Clear', icon: <Trash2 size={15} strokeWidth={2.5} />, onClick: onClearKeyframes, active: false, disabled: locked || keyframes.length === 0, title: 'Remove ALL keyframes from the timeline' },
  ];

  return (
    // Outer gap:10 matches page.jsx's own #studio-under-canvas-controls
    // (the flex-column wrapper around its whole undercanvas-row + timeline
    // block) — row1→row2 gets ADDITIONAL spacing from the row2 wrapper's
    // own marginTop:16 below, compounding to the same visual weight
    // page.jsx's stack has, since this strip is a single flat flex column
    // rather than page.jsx's nested wrapper-of-a-wrapper.
    <div id="studio-cloth-timeline-strip" style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12, flexShrink: 0 }}>
      <style id="cloth-timeline-strip-styles">{`
        @media (max-width: 480px) {
          .cloth-timeline-ctrl-label { display: none; }
        }
      `}</style>

      {/* Row 1 — 3-zone flex, matching page.jsx's own studio-undercanvas-row
          (device-sizes zone | player-controls zone | right-actions zone).
          The left zone now carries the SAME device toggles the Mockup Video
          bar has (owner direction): rounded-square Desktop/Mobile/Tablet
          buttons; the active one gets the gradient hairline ring. Clicking
          switches the primary Subject to Device with that viewport. */}
      <div id="cloth-timeline-transport-row" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div id="cloth-timeline-device-zone" style={{ display: 'flex', flex: 1, gap: 10, alignItems: 'flex-start' }}>
          {[
            { id: 'desktop', label: 'Desktop', icon: <Monitor size={18} strokeWidth={2} /> },
            { id: 'mobile', label: 'Mobile', icon: <Smartphone size={18} strokeWidth={2} /> },
            { id: 'tablet', label: 'Tablet', icon: <Tablet size={18} strokeWidth={2} /> },
          ].map((d) => {
            const active = Boolean(deviceActive) && deviceViewport === d.id;
            return (
              <div key={d.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                <button
                  type="button"
                  id={`cloth-timeline-device-${d.id}-btn`}
                  title={active ? `${d.label} device is live` : `Switch the subject to the ${d.label} device`}
                  onClick={() => onSelectDevice?.(d.id)}
                  style={{
                    width: 46, height: 46, borderRadius: 14,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    border: '1px solid ' + (active ? 'transparent' : GLASS.hair),
                    background: active ? 'linear-gradient(#fff,#fff) padding-box, ' + GLASS.accent + ' border-box' : 'rgba(255,255,255,0.6)',
                    color: active ? GLASS.ink : GLASS.inkMute,
                    boxShadow: '0 1px 4px rgba(42,36,32,0.1)',
                    cursor: 'pointer',
                    transition: 'background 0.18s ease, color 0.18s ease',
                  }}
                >
                  {d.icon}
                </button>
                <span className="cloth-timeline-ctrl-label" style={{ ...ui.label, fontSize: 8, color: active ? GLASS.ink : GLASS.inkMute }}>{d.label}</span>
              </div>
            );
          })}
        </div>
        <div id="cloth-timeline-transport-center" style={{ display: 'flex', gap: 14 }}>
          {transportBtns.map((b) => (
            <div key={b.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <button
                type="button"
                title={b.title || b.label}
                disabled={b.disabled}
                onClick={b.onClick}
                style={{
                  width: 46, height: 46, borderRadius: '50%',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  // Active → gradient hairline border; inactive → plain grey/glass —
                  // page.jsx L2451-2454, verbatim.
                  border: '1px solid ' + (b.active ? 'transparent' : GLASS.hair),
                  background: b.active ? 'linear-gradient(#fff,#fff) padding-box, ' + GLASS.accent + ' border-box' : 'rgba(255,255,255,0.6)',
                  color: GLASS.ink,
                  boxShadow: '0 1px 4px rgba(42,36,32,0.1)',
                  cursor: b.disabled ? 'default' : 'pointer',
                  opacity: b.disabled ? 0.4 : 1,
                  transition: 'background 0.18s ease, color 0.18s ease',
                }}
              >
                {b.icon}
              </button>
              <span className="cloth-timeline-ctrl-label" style={{ ...ui.label, fontSize: 8 }}>{b.label}</span>
            </div>
          ))}
          {Array.isArray(cameraTemplates) && cameraTemplates.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <select
                id="cloth-timeline-camera-move-select"
                value=""
                disabled={locked}
                title="Apply an authored camera move — replaces the current keyframes"
                onChange={(e) => { if (e.target.value) { onApplyCameraTemplate?.(e.target.value); e.target.value = ''; } }}
                style={{
                  height: 46, borderRadius: 23, padding: '0 14px',
                  border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.6)',
                  color: GLASS.ink, fontFamily: GLASS.sans, fontSize: 12, fontWeight: 600,
                  cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.4 : 1,
                  boxShadow: '0 1px 4px rgba(42,36,32,0.1)', appearance: 'none',
                }}
              >
                <option value="">Camera move…</option>
                {cameraTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.label} · {t.seconds}s</option>
                ))}
              </select>
              <span className="cloth-timeline-ctrl-label" style={{ ...ui.label, fontSize: 8 }}>Moves</span>
            </div>
          ) : null}
        </div>
        <div id="cloth-timeline-actions" style={{ display: 'flex', flex: 1, justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            title={canAdd ? 'Add a keyframe at the current playhead' : `Max ${MAX_TIMELINE_KEYFRAMES} keyframes reached`}
            disabled={!canAdd || locked}
            onClick={() => (onAddKeyframe ? onAddKeyframe() : onAddKeyframeAt())}
            style={{ ...ui.btn(true), border: '1px solid rgba(255,255,255,0.25)', opacity: (canAdd && !locked) ? 1 : 0.4 }}
          >
            Add Keyframe
          </button>
          {/* Same treatment as the Mockup Video bar's Render CTA (owner
              direction): the global .cta-pill-btn animated comet border
              (colors.css, imported app-wide) over the navCta-style gradient
              sheen fill. Inline padding wins over the class's own 1rem. */}
          <button
            type="button"
            className="cta-pill-btn"
            title={canExport ? 'Export the whole sequence as one video' : 'Add at least 2 keyframes to export a timeline'}
            disabled={!canExport}
            onClick={onExport}
            style={{
              ...ui.cta,
              background: 'linear-gradient(175deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 52%), ' + GLASS.accent,
              boxShadow: '0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.1)',
              opacity: canExport ? 1 : 0.4, display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <Download size={13} strokeWidth={2.5} /> Export Timeline
          </button>
        </div>
      </div>

      {/* Row 2 wrapper — mirrors page.jsx's own #studio-timeline-transport
          (marginTop:16 off row 1, gap:8) 1:1; contains the single track row
          below, same as page.jsx's own (also single-child) wrapper. */}
      <div id="cloth-timeline-transport" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
      {/* Row 2 — pill track (progress fill / playhead / diamond markers) +
          inline DURATION field, mirroring page.jsx's own
          #studio-timeline-row structure 1:1. */}
      <div id="cloth-timeline-row" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          id="cloth-timeline-track"
          ref={trackRef}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          style={{
            flex: 1, position: 'relative', height: 32, borderRadius: 999,
            background: 'rgba(255,255,255,0.7)', border: '1px solid ' + GLASS.hair,
            cursor: locked ? 'default' : 'pointer', touchAction: 'none', userSelect: 'none',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.06)',
          }}
        >
          {keyframes.length === 0 ? (
            <span style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: GLASS.sans, fontSize: 11, color: GLASS.inkMute, pointerEvents: 'none', textAlign: 'center', padding: '0 16px',
            }}>
              Double-click the track to add a keyframe from the current scene
            </span>
          ) : null}
          <div style={{ position: 'absolute', left: TL_PAD, top: 0, bottom: 0, width: `calc(${scrubU} * (100% - ${TL_PAD * 2}px))`, background: 'rgba(236,72,153,0.14)', borderRadius: 999, pointerEvents: 'none' }} />
          {/* Playhead — bold pink line; ONLY the top ball is interactive (drag to scrub).
              Structure + geometry ported verbatim from page.jsx L2501-2515. */}
          <div style={{ position: 'absolute', left: tlLeft(scrubU), top: -3, bottom: -3, width: 3, marginLeft: -1.5, background: ACCENT, borderRadius: 999, boxShadow: '0 0 0 1px rgba(255,255,255,0.85)', pointerEvents: 'none', zIndex: 4 }}>
            <div
              onPointerDown={onPlayheadPointerDown}
              onPointerMove={onPlayheadPointerMove}
              onPointerUp={onPlayheadPointerUp}
              title="Drag to scrub — snaps to keyframes"
              style={{
                position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)',
                width: 22, height: 22, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: locked ? 'none' : 'auto', touchAction: 'none', cursor: 'grab', zIndex: 5,
              }}
            >
              <div style={{ width: 13, height: 13, borderRadius: '50%', background: ACCENT, boxShadow: '0 1px 3px rgba(0,0,0,0.3), 0 0 0 2px #fff', pointerEvents: 'none' }} />
            </div>
          </div>
          {keyframes.map((k) => (
            <div
              key={k.id}
              data-key-id={k.id}
              title={`${(k.t * (timeline?.totalSeconds || 0)).toFixed(1)}s — drag to retime, double-click to remove`}
              style={{
                position: 'absolute', left: tlLeft(k.t), top: '50%',
                width: 9, height: 9, marginLeft: -4.5, marginTop: -4.5,
                transform: 'rotate(45deg)',
                background: selectedKeyframeId === k.id ? GLASS.ink : '#fff',
                border: '1px solid ' + (selectedKeyframeId === k.id ? '#fff' : GLASS.inkMute),
                borderRadius: 2, boxShadow: '0 1px 2px rgba(0,0,0,0.15)', cursor: locked ? 'default' : 'grab',
              }}
            />
          ))}
        </div>
        {/* Duration — inline numeric field, right of the track; ported
            verbatim from page.jsx's own #studio-duration-field. */}
        <div id="cloth-timeline-duration" style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <input
            type="number" min={1} max={120} value={timeline?.totalSeconds ?? 8}
            disabled={locked}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v > 0) onTotalSecondsChange(v);
            }}
            title="Timeline duration (seconds)"
            style={{ width: 54, height: 32, textAlign: 'center', borderRadius: 10, border: '1px solid ' + GLASS.hair, background: 'rgba(255,255,255,0.7)', color: GLASS.ink, fontFamily: GLASS.mono, fontSize: 13, padding: '0 4px' }}
          />
          <span style={{ ...ui.label, color: GLASS.inkMute }}>S</span>
          {/* Persisted loop preference — lived in the (removed) rail
              Timeline card; Play honors timeline.loop, so this is the loop
              control now. Same light-glass treatment as the duration box. */}
          <button
            id="cloth-timeline-loop-toggle"
            title={timeline?.loop ? 'Loop on — playback repeats' : 'Loop off — playback runs once'}
            disabled={locked}
            onClick={() => onLoopToggle?.(!timeline?.loop)}
            style={{
              width: 32, height: 32, borderRadius: 10,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid ' + (timeline?.loop ? 'transparent' : GLASS.hair),
              background: timeline?.loop
                ? 'linear-gradient(#fff,#fff) padding-box, ' + GLASS.accent + ' border-box'
                : 'rgba(255,255,255,0.7)',
              color: timeline?.loop ? GLASS.ink : GLASS.inkMute,
              cursor: locked ? 'default' : 'pointer', opacity: locked ? 0.5 : 1,
            }}
          >
            <Repeat size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
      </div>

      {/* Selected-keyframe editor row REMOVED (owner direction, 2026-08-01):
          it appeared under the track on selection and shifted the whole
          strip's layout. Keyframe interactions live entirely ON the track
          now — click selects + jumps the playhead, drag retimes,
          double-click/long-press removes, double-click empty space adds.
          Renaming/re-capturing a shot is no longer surfaced here. */}
    </div>
  );
}
