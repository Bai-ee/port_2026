'use client';

// Loop Studio — EDITTRAX player panel. Presentational + iframe-lifecycle
// component: owns nothing about the studio's own state (LoopStudio.jsx owns
// `slots` — a PART SEQUENCE of loop indices, same loop may repeat — via
// useState + this component's `onSlotsChange`), and is responsible for:
//   1. the part slot strip (drag a loop from the LOOPS list to append/
//      replace a part; a real <button> clears a part — never a button
//      nested inside a button, see the chip markup below),
//   2. turning the current slot assignment into per-loop WAV blob: URLs
//      (engine-repaired bytes preferred, local re-encode fallback — the
//      SAME audio-bytes policy the WAV export path uses, see LoopStudio.jsx
//      `downloadLoop`/`downloadAllZip`), cached per loop index and revoked
//      when no longer referenced or on unmount,
//   3. rebuilding the EDITTRAX player's srcdoc (via ../edittrax-export.js's
//      `generateTrackJs` + ./edittrax-embed.js's `buildEmbedSrcdoc`)
//      whenever the part assignment / bpm / bars-per-loop / track name
//      changes, while best-effort preserving the loop-repeat COUNTS the
//      player's own up/down UI has set (`readLivePartLoops`, read off the
//      currently-mounted iframe's `contentWindow.parts` BEFORE it gets torn
//      down for the next rebuild).
//
// Every part add/remove/replace reloads the iframe (the player engine reads
// its config synchronously at parse time — see edittrax-embed.js's top
// comment) — playback resets on rebuild, accepted for this POC.

import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { X } from 'lucide-react';
import { GLASS, ui } from '../../components/rail-ui';
import { fetchEngineAudioBytes } from '../loopcore-client';
import { encodeWavPcm16 } from '../wav-encode';
import { buildEmbedSrcdoc, readLivePartLoops } from './edittrax-embed';
import { generateTrackJs, sanitizePlayerProjectBase } from './edittrax-export';

const ACCENT = '#ec4899';

// The template's index.html never changes at runtime — fetch it once per
// page load and reuse the same text for every srcdoc rebuild. A failed
// fetch clears the cache so the next attempt can retry.
let cachedIndexHtmlPromise = null;
function loadPlayerIndexHtml() {
  if (!cachedIndexHtmlPromise) {
    cachedIndexHtmlPromise = fetch('/edittrax-player/index.html')
      .then((res) => {
        if (!res.ok) throw new Error(`edittrax-player index.html fetch failed (${res.status})`);
        return res.text();
      })
      .catch((err) => {
        cachedIndexHtmlPromise = null;
        throw err;
      });
  }
  return cachedIndexHtmlPromise;
}

// Known SP-16 drop-handler bug (STUDIO-LOOPS-SP16-EXPORT-REVIEW finding 14):
// `e.dataTransfer.getData(...)` returns '' for a foreign/empty drop, and
// `Number('') === 0` would silently assign Loop 01. Guard it here instead.
function parseLoopIndexFromDrop(e) {
  const raw = e.dataTransfer.getData('text/x-hitloop-loop-index');
  if (raw === '') return null;
  const idx = Number(raw);
  return Number.isFinite(idx) ? idx : null;
}

const pad2 = (n) => String(n).padStart(2, '0');

export default function EdittraxPlayerPanel({
  slots, onSlotsChange, frameRef, loops = [], bpm, barsPerLoop, audioBuffer,
  engineLoopByIndex = null, trackBase, setStatus = null,
}) {
  const [srcDoc, setSrcDoc] = useState(null);
  const [buildError, setBuildError] = useState(null);
  const [dragHoverKey, setDragHoverKey] = useState(null);

  // loopIndex -> blob: URL, one per UNIQUE loop index currently assigned to
  // a slot. Survives across rebuilds so re-dropping the same loop doesn't
  // re-encode it.
  const blobUrlsRef = useRef(new Map());
  // Loop-repeat counts, aligned 1:1 with `slots` (default 1 per new part).
  const countsRef = useRef([]);

  // ── Live-count capture (the player's own up/down UI mutates
  // contentWindow.parts directly — this is the only way to read it back).
  // Compares against countsRef's OWN current length (always the synchronous
  // source of truth) rather than the `slots` PROP length — the prop can be
  // one render behind when multiple slot mutations fire in the same tick
  // (e.g. rapid/programmatic drops), and comparing against a stale prop
  // was what let the second call's bookkeeping clobber the first's. The
  // srcdoc-rebuild effect below still self-heals countsRef's length against
  // the committed `slots` on every real prop change, so this only needs to
  // capture a live read when it unambiguously matches what's already known. ──
  const syncCountsFromLive = useCallback(() => {
    const live = readLivePartLoops(frameRef.current);
    if (live && live.length === countsRef.current.length) {
      countsRef.current = live.slice();
    }
  }, [frameRef]);

  // ── Slot mutations — each captures live counts BEFORE changing `slots`,
  // so the counts array and the slots array move in lockstep. `onSlotsChange`
  // is literally `setEdittraxSlots` (a React state setter), so it accepts an
  // updater function: using the functional form (instead of reading the
  // `slots` prop directly) means several mutations fired in the same tick
  // compose against each other correctly instead of the last call's
  // closure-captured `slots` silently winning and dropping the others. ──
  const handleAppendLoop = useCallback((loopIndex) => {
    if (!loops.some((l) => l.index === loopIndex)) return;
    syncCountsFromLive();
    countsRef.current = [...countsRef.current, 1];
    onSlotsChange((prev) => [...prev, loopIndex]);
  }, [loops, onSlotsChange, syncCountsFromLive]);

  const handleReplaceLoop = useCallback((slotPos, loopIndex) => {
    if (!loops.some((l) => l.index === loopIndex)) return;
    syncCountsFromLive();
    onSlotsChange((prev) => prev.map((v, i) => (i === slotPos ? loopIndex : v)));
  }, [loops, onSlotsChange, syncCountsFromLive]);

  const handleRemoveLoop = useCallback((slotPos) => {
    syncCountsFromLive();
    countsRef.current = countsRef.current.filter((_, i) => i !== slotPos);
    onSlotsChange((prev) => prev.filter((_, i) => i !== slotPos));
  }, [onSlotsChange, syncCountsFromLive]);

  // ── Stale-slot validation — a re-slice (new grid) can drop loop indices
  // slots still reference; filter those out additively, same idea as the
  // SP-16 pads reset on a new track. ──
  useEffect(() => {
    if (!slots.length) return;
    const validIndices = new Set(loops.map((l) => l.index));
    const keep = slots.map((loopIndex) => validIndices.has(loopIndex));
    if (keep.every(Boolean)) return;
    const live = readLivePartLoops(frameRef.current);
    const baseCounts = (live && live.length === slots.length) ? live : countsRef.current;
    countsRef.current = baseCounts.filter((_, i) => keep[i]);
    onSlotsChange(slots.filter((_, i) => keep[i]));
  }, [slots, loops, onSlotsChange, frameRef]);

  // ── Blob URL lifecycle — create bytes for any newly-needed loop index,
  // revoke any no-longer-needed one. Engine-repaired bytes preferred (same
  // policy as the WAV export path), local re-encode fallback. ──
  const ensureBlobUrls = useCallback(async (neededIndices) => {
    const needed = new Set(neededIndices);
    const cache = blobUrlsRef.current;

    Array.from(cache.keys()).forEach((idx) => {
      if (!needed.has(idx)) {
        URL.revokeObjectURL(cache.get(idx));
        cache.delete(idx);
      }
    });

    const toCreate = Array.from(needed).filter((idx) => !cache.has(idx));
    await Promise.all(toCreate.map(async (idx) => {
      const loop = loops.find((l) => l.index === idx);
      if (!loop || !audioBuffer) return;

      let bytes = null;
      const engineLoop = engineLoopByIndex ? engineLoopByIndex.get(idx) : null;
      if (engineLoop && engineLoop.path) {
        try {
          bytes = await fetchEngineAudioBytes(engineLoop.path);
        } catch {
          bytes = null; // fall through to the local re-encode below
        }
      }
      if (!bytes) {
        const channelData = Array.from(
          { length: audioBuffer.numberOfChannels },
          (_, c) => audioBuffer.getChannelData(c),
        );
        bytes = encodeWavPcm16({
          channelData,
          sampleRate: audioBuffer.sampleRate,
          startSample: loop.startSample,
          endSample: loop.endSample,
        });
      }
      cache.set(idx, URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
    }));
  }, [loops, audioBuffer, engineLoopByIndex]);

  // ── srcdoc rebuild — fires on any assignment/grid/name change. ──
  useEffect(() => {
    let cancelled = false;

    async function build() {
      if (!slots.length) {
        await ensureBlobUrls([]); // nothing referenced anymore — revoke all
        if (!cancelled) { setSrcDoc(null); setBuildError(null); }
        return;
      }

      // Capture whatever the player's own UI set BEFORE this iframe (still
      // showing the previous config) gets replaced.
      const live = readLivePartLoops(frameRef.current);
      if (live && live.length === slots.length) {
        countsRef.current = live.slice();
      }
      if (countsRef.current.length !== slots.length) {
        countsRef.current = slots.map((_, i) => (
          Number.isFinite(countsRef.current[i]) ? countsRef.current[i] : 1
        ));
      }

      try {
        await ensureBlobUrls([...new Set(slots)]);
        if (cancelled) return;

        const parts = slots.map((loopIndex, i) => ({
          file: blobUrlsRef.current.get(loopIndex),
          length: barsPerLoop,
          loop: countsRef.current[i] ?? 1,
        }));
        if (parts.some((p) => typeof p.file !== 'string' || !p.file)) {
          throw new Error('missing audio for one or more assigned parts');
        }

        const trackConfigScript = generateTrackJs({
          bpm,
          parts,
          downloadName: `${sanitizePlayerProjectBase(trackBase)}_EDIT.wav`,
        });

        const indexHtml = await loadPlayerIndexHtml();
        if (cancelled) return;

        const doc = buildEmbedSrcdoc({ indexHtml, baseHref: '/edittrax-player/', trackConfigScript });
        if (cancelled) return;
        setSrcDoc(doc);
        setBuildError(null);
      } catch (err) {
        if (cancelled) return;
        const message = `EDITTRAX player build failed — ${String(err?.message || err)}`;
        setSrcDoc(null);
        setBuildError(message);
        if (typeof setStatus === 'function') setStatus(message, 'error');
      }
    }

    build();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots, bpm, barsPerLoop, trackBase, ensureBlobUrls]);

  // Revoke every cached blob URL on unmount (e.g. switching export targets).
  useEffect(() => () => {
    blobUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    blobUrlsRef.current.clear();
  }, []);

  return (
    <section
      id="loop-studio-edittrax-panel"
      className="loop-stage-panel"
      style={{
        gap: 12, borderRadius: 16, padding: 14, overflowY: 'auto',
        background: 'repeating-linear-gradient(180deg, rgba(255,255,255,0.035) 0 1px, rgba(0,0,0,0) 1px 3px), linear-gradient(180deg,#2b2d34 0%,#191a1f 52%,#0f1013 100%)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: '0 18px 44px rgba(20,20,30,0.24), inset 0 1px 0 rgba(255,255,255,0.10)',
      }}
    >
      <div
        id="loop-studio-edittrax-panel-header"
        style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}
      >
        <span style={{ fontFamily: GLASS.sans, color: '#fff', fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em' }}>
          EDITTRAX
        </span>
        <span style={{ ...ui.label, color: 'rgba(255,255,255,0.5)' }}>{slots.length} PARTS</span>
      </div>

      <div id="loop-edittrax-slot-row" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        {slots.map((loopIndex, i) => {
          const key = `slot-${i}`;
          const isHover = dragHoverKey === key;
          return (
            <div
              key={key}
              id={`loop-edittrax-slot-${i}`}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragHoverKey(key); }}
              onDragLeave={() => setDragHoverKey((k) => (k === key ? null : k))}
              onDrop={(e) => {
                e.preventDefault();
                setDragHoverKey(null);
                const idx = parseLoopIndexFromDrop(e);
                if (idx == null) return;
                handleReplaceLoop(i, idx);
              }}
              title={`Drop a loop here to replace part ${i + 1}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                borderRadius: 999, padding: '6px 6px 6px 12px',
                background: isHover ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)',
                border: '1px solid ' + (isHover ? ACCENT : 'rgba(255,255,255,0.16)'),
                color: '#fff', fontFamily: GLASS.mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
              }}
            >
              <span>{`PART ${pad2(i + 1)} · LOOP ${pad2(loopIndex + 1)}`}</span>
              <button
                type="button"
                onClick={() => handleRemoveLoop(i)}
                title={`Remove part ${i + 1}`}
                aria-label={`Remove part ${i + 1}`}
                style={{
                  width: 18, height: 18, borderRadius: '50%', border: 'none',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(0,0,0,0.3)', color: '#fff', cursor: 'pointer',
                }}
              >
                <X size={10} />
              </button>
            </div>
          );
        })}

        <div
          id="loop-edittrax-add-drop-zone"
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragHoverKey('add'); }}
          onDragLeave={() => setDragHoverKey((k) => (k === 'add' ? null : k))}
          onDrop={(e) => {
            e.preventDefault();
            setDragHoverKey(null);
            const idx = parseLoopIndexFromDrop(e);
            if (idx == null) return;
            handleAppendLoop(idx);
          }}
          style={{
            borderRadius: 999, padding: '6px 14px',
            border: '1px dashed ' + (dragHoverKey === 'add' ? ACCENT : 'rgba(255,255,255,0.3)'),
            background: dragHoverKey === 'add' ? 'rgba(255,255,255,0.12)' : 'transparent',
            color: 'rgba(255,255,255,0.5)', fontFamily: GLASS.mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
          }}
        >
          DROP LOOP TO ADD PART
        </div>
      </div>

      {buildError ? (
        <span style={{ ...ui.label, textTransform: 'none', color: '#f59e0b' }}>{buildError}</span>
      ) : null}

      {slots.length === 0 ? (
        <div
          id="loop-edittrax-empty-hint"
          style={{
            flex: 1, minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center',
            textAlign: 'center', padding: 24, borderRadius: 12,
            border: '1px dashed rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.4)',
            fontFamily: GLASS.mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
          }}
        >
          DRAG LOOPS FROM THE LOOPS LIST TO BUILD THE PLAYER
        </div>
      ) : (
        <iframe
          id="loop-edittrax-player-frame"
          ref={frameRef}
          srcDoc={srcDoc ?? undefined}
          title="EditTrax player"
          style={{
            width: '100%', height: 640, border: 'none', borderRadius: 12,
            background: '#0f1013', display: 'block',
          }}
        />
      )}
    </section>
  );
}
