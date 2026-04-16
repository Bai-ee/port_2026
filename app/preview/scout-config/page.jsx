'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../AuthContext';

// Dev preview — fetches the signed-in user's scoutConfig from Firestore and
// renders it readable. Mirrors /preview/brief's pattern. User-authed; no
// admin role required.

export default function ScoutConfigPreviewRoute() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  const [regenState, setRegenState] = useState({ running: false, message: '' });
  const [scoutRun, setScoutRun] = useState({ running: false, message: '', result: null });
  const [tab, setTab] = useState('config');

  useEffect(() => {
    if (!loading && !user) router.replace('/login?redirect=/preview/scout-config');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setState({ status: 'loading', data: null, error: '' });
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/dashboard/scout-config-preview', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        if (!cancelled) setState({ status: 'ready', data: body, error: '' });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', data: null, error: err.message || String(err) });
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading || !user) {
    return <div style={{ padding: 24, fontFamily: 'system-ui' }}>Resolving session…</div>;
  }

  const data = state.data;
  const cfg = data?.scoutConfig;
  const currentUrl = data?.currentWebsiteUrl;
  const cachedUrl = cfg?._meta?.websiteUrl;
  // Stale when either the cached URL is missing (pre-patch doc) or
  // doesn't match the current site.
  const stale = cfg && currentUrl && (!cachedUrl || cachedUrl !== currentUrl);

  async function runScouts() {
    if (!user || scoutRun.running) return;
    setScoutRun({ running: true, message: '', result: null });
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/dashboard/scout-run', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setScoutRun({
        running: false,
        message: `Run complete · ${body.totalMs}ms · $${Number(body.totalCostUsd || 0).toFixed(4)}`,
        result: body,
      });
    } catch (err) {
      setScoutRun({ running: false, message: `Error: ${err.message || err}`, result: null });
    }
  }

  async function regenerate() {
    if (!user || regenState.running) return;
    setRegenState({ running: true, message: '' });
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/dashboard/scout-config-regenerate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // Refetch the preview so the new config appears.
      const prevRes = await fetch('/api/dashboard/scout-config-preview', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const prev = await prevRes.json();
      setState({ status: 'ready', data: prev, error: '' });
      const cost = body?.cost?.estimatedCostUsd;
      setRegenState({ running: false, message: `Regenerated${cost != null ? ` · $${Number(cost).toFixed(4)}` : ''}` });
    } catch (err) {
      setRegenState({ running: false, message: `Error: ${err.message || err}` });
    }
  }

  return (
    <div style={pageStyle}>
      <style>{`
        .sc-root { max-width: 960px; margin: 0 auto; padding: 24px; color: #2a2420; font-family: "Space Grotesk", system-ui, sans-serif; }
        .sc-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: #1a1614; color: #F5F1DF; font-family: "Space Mono", monospace; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; margin: -24px -24px 24px -24px; }
        .sc-stale { background: rgba(215,25,33,0.1); border: 1px solid rgba(215,25,33,0.4); color: #b61319; padding: 12px 14px; border-radius: 10px; margin-bottom: 20px; font-family: "Space Mono", monospace; font-size: 12px; letter-spacing: 0.08em; }
        .sc-section { padding: 16px 18px; background: rgba(255,252,244,0.85); border: 1px solid rgba(212, 196, 171, 0.82); border-radius: 14px; margin-bottom: 14px; }
        .sc-label { font-family: "Space Mono", monospace; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(42,36,32,0.55); margin-bottom: 10px; }
        .sc-row { display: grid; grid-template-columns: 180px 1fr; gap: 14px; padding: 6px 0; border-bottom: 1px dashed rgba(42,36,32,0.1); }
        .sc-row:last-child { border-bottom: 0; }
        .sc-row .k { font-family: "Space Mono", monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(42,36,32,0.5); padding-top: 3px; }
        .sc-row .v { font-family: "Space Grotesk", system-ui, sans-serif; font-size: 14px; line-height: 1.5; color: #2a2420; word-break: break-word; }
        .sc-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .sc-chip { font-family: "Space Mono", monospace; font-size: 11px; padding: 4px 10px; border: 1px solid rgba(212, 196, 171, 0.82); background: #fff; border-radius: 999px; }
        .sc-plan { padding: 12px 0; border-top: 1px solid rgba(42,36,32,0.1); }
        .sc-plan:first-child { border-top: 0; }
        .sc-plan .num { font-family: "Space Mono", monospace; font-size: 10px; letter-spacing: 0.14em; color: rgba(42,36,32,0.55); margin-bottom: 4px; }
        .sc-plan .title { font-family: "Space Grotesk"; font-weight: 600; font-size: 15px; margin-bottom: 4px; }
        .sc-plan .query { font-family: "Space Mono", monospace; font-size: 12px; background: #fff; border: 1px solid rgba(212, 196, 171, 0.82); padding: 6px 10px; border-radius: 8px; margin-bottom: 4px; word-break: break-word; }
        .sc-plan .goal { font-size: 13px; color: rgba(42,36,32,0.65); }
        .sc-empty { color: rgba(42,36,32,0.4); font-style: italic; }
        .sc-tabs { display: flex; gap: 6px; margin-bottom: 18px; }
        .sc-tab { font-family: "Space Mono", monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; padding: 8px 14px; background: #fff; color: rgba(42,36,32,0.6); border: 1px solid rgba(212, 196, 171, 0.82); border-radius: 8px; cursor: pointer; }
        .sc-tab.is-active { background: #1a1614; color: #F5F1DF; border-color: #1a1614; }
        .sc-note { padding: 12px 14px; background: #fff; border: 1px solid rgba(212, 196, 171, 0.82); border-radius: 10px; margin-bottom: 10px; }
        .sc-note-meta { font-family: "Space Mono", monospace; font-size: 10px; color: rgba(42,36,32,0.5); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 6px; display: flex; gap: 10px; flex-wrap: wrap; }
        .sc-note-anchor { font-family: "Space Mono", monospace; font-size: 11px; color: #4A7C7E; word-break: break-all; }
        .sc-note-text { font-size: 13px; line-height: 1.5; color: #2a2420; margin-top: 6px; }
        .sc-note-status { padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(42,36,32,0.2); }
        .sc-note-status.open { background: rgba(215,25,33,0.08); color: #b61319; border-color: rgba(215,25,33,0.3); }
        .sc-note-status.addressed { background: rgba(74,158,92,0.12); color: #166534; border-color: rgba(74,158,92,0.4); }
        .sc-note-status.dismissed { background: rgba(42,36,32,0.05); color: rgba(42,36,32,0.5); }
        .sc-note-form { display: grid; gap: 8px; padding: 14px; background: #fff; border: 1px dashed rgba(212, 196, 171, 0.82); border-radius: 10px; margin-bottom: 16px; }
        .sc-note-form input, .sc-note-form textarea { font-family: "Space Mono", monospace; font-size: 12px; padding: 8px 10px; border: 1px solid rgba(212, 196, 171, 0.82); border-radius: 6px; background: #fdfaf2; color: #2a2420; }
        .sc-note-form textarea { min-height: 72px; font-family: "Space Grotesk", system-ui, sans-serif; font-size: 13px; }
        .sc-note-form button { justify-self: start; font-family: "Space Mono", monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; padding: 8px 14px; background: #1a1614; color: #F5F1DF; border: 0; border-radius: 6px; cursor: pointer; }
        .sc-note-form button:disabled { opacity: 0.5; cursor: default; }
        .dm-group { margin-bottom: 24px; }
        .dm-group-title { font-family: "Space Mono", monospace; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(42,36,32,0.55); margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid rgba(42,36,32,0.12); }
        .dm-card { padding: 22px 24px; background: rgba(255,252,244,0.85); border: 1px solid rgba(212, 196, 171, 0.82); border-radius: 14px; margin-bottom: 20px; }
        .dm-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 14px; flex-wrap: wrap; }
        .dm-card-title { font-family: "Space Grotesk"; font-weight: 700; font-size: 28px; color: #2a2420; line-height: 1.15; }
        .dm-card-sub { font-family: "Space Mono", monospace; font-size: 13px; color: rgba(42,36,32,0.6); letter-spacing: 0.05em; margin-top: 6px; }
        .dm-card-src-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; align-items: center; }
        .dm-card-src-row .hint { font-family: "Space Mono", monospace; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(42,36,32,0.5); }
        .dm-card-src-row .chip { font-family: "Space Mono", monospace; font-size: 12px; padding: 3px 10px; border: 1px solid rgba(74,124,126,0.4); background: rgba(74,124,126,0.1); color: #4A7C7E; border-radius: 6px; }
        .dm-card-src-row .none { font-family: "Space Mono", monospace; font-size: 11px; color: rgba(215,25,33,0.7); letter-spacing: 0.04em; }
        .dm-chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .dm-chip { font-family: "Space Mono", monospace; font-size: 12px; padding: 3px 10px; border: 1px solid rgba(212, 196, 171, 0.82); background: #fff; border-radius: 999px; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.7); }
        .dm-chip.action-describe      { border-color: rgba(42,36,32,0.25); }
        .dm-chip.action-diagnose      { background: rgba(215,25,33,0.08); color: #b61319; border-color: rgba(215,25,33,0.3); }
        .dm-chip.action-recommend     { background: rgba(74,158,92,0.1); color: #166534; border-color: rgba(74,158,92,0.4); }
        .dm-chip.action-service-offer { background: rgba(176,90,255,0.12); color: #6b21a8; border-color: rgba(176,90,255,0.4); }
        .dm-chip.action-runtime       { background: rgba(42,36,32,0.05); color: rgba(42,36,32,0.5); }
        .dm-chip.tier-paid            { background: #1a1614; color: #F5F1DF; border-color: #1a1614; }
        .dm-sub { margin-top: 14px; padding-top: 12px; border-top: 1px dashed rgba(42,36,32,0.14); }
        .dm-sub-label { font-family: "Space Mono", monospace; font-size: 12px; color: rgba(42,36,32,0.6); letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; font-weight: 600; }
        .dm-rule { padding: 10px 12px; background: #fff; border: 1px solid rgba(212, 196, 171, 0.6); border-radius: 8px; margin-bottom: 8px; }
        .dm-rule .rid { font-family: "Space Mono", monospace; font-size: 12px; color: #6b21a8; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600; }
        .dm-rule .rwhen { font-family: "Space Mono", monospace; font-size: 13px; color: rgba(42,36,32,0.75); margin-top: 4px; }
        .dm-rule .rtext { margin-top: 6px; color: #2a2420; line-height: 1.5; font-size: 14px; }
        .dm-rule .rrow { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
        .dm-note-btn { font-family: "Space Mono", monospace; font-size: 12px; padding: 4px 10px; background: #fff; color: rgba(42,36,32,0.65); border: 1px solid rgba(42,36,32,0.25); border-radius: 999px; cursor: pointer; letter-spacing: 0.04em; white-space: nowrap; }
        .dm-note-btn.has { background: #FFF7CC; color: #78350f; border-color: rgba(234,179,8,0.5); }
        .dm-inline-form { margin-top: 10px; padding: 10px; background: #fff; border: 1px dashed rgba(42,36,32,0.2); border-radius: 8px; display: grid; gap: 6px; }
        .dm-inline-form textarea { font-family: "Space Grotesk", system-ui, sans-serif; font-size: 13px; padding: 8px 10px; border: 1px solid rgba(212, 196, 171, 0.82); border-radius: 6px; background: #fdfaf2; color: #2a2420; min-height: 60px; }
        .dm-inline-form .row { display: flex; gap: 6px; align-items: center; justify-content: space-between; }
        .dm-inline-form .anchor { font-family: "Space Mono", monospace; font-size: 10px; color: #4A7C7E; word-break: break-all; }
        .dm-inline-form button { font-family: "Space Mono", monospace; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; padding: 6px 12px; background: #1a1614; color: #F5F1DF; border: 0; border-radius: 6px; cursor: pointer; }
        .dm-inline-form button.ghost { background: transparent; color: rgba(42,36,32,0.6); border: 1px solid rgba(42,36,32,0.2); }
        .dm-existing { margin-top: 6px; padding: 6px 8px; background: rgba(255,247,204,0.4); border-left: 2px solid rgba(234,179,8,0.6); font-size: 12px; line-height: 1.4; }
        .dm-existing-meta { font-family: "Space Mono", monospace; font-size: 9px; color: rgba(120,53,15,0.7); letter-spacing: 0.08em; }
        .dm-src { padding: 14px 16px; background: #fff; border: 1px solid rgba(212, 196, 171, 0.6); border-radius: 10px; margin-bottom: 10px; }
        .dm-src .hd { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 6px; }
        .dm-src .name { font-family: "Space Grotesk"; font-weight: 600; font-size: 16px; color: #2a2420; }
        .dm-src .method { font-family: "Space Mono", monospace; font-size: 12px; color: #4A7C7E; margin-top: 3px; }
        .dm-src .detail { font-size: 14px; color: rgba(42,36,32,0.75); line-height: 1.5; margin-top: 6px; }
        .dm-src .meta { font-family: "Space Mono", monospace; font-size: 12px; color: rgba(42,36,32,0.6); margin-top: 8px; display: flex; flex-wrap: wrap; gap: 12px; }
        .dm-src .fields { font-family: "Space Mono", monospace; font-size: 13px; background: #fdfaf2; border: 1px solid rgba(42,36,32,0.1); border-radius: 6px; padding: 10px 12px; margin-top: 8px; line-height: 1.7; color: rgba(42,36,32,0.85); word-break: break-word; }
        .dm-cat-title { font-family: "Space Mono", monospace; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(42,36,32,0.6); margin: 10px 0 8px 0; font-weight: 600; }
        .dm-data-block { padding: 12px 14px; background: rgba(74,124,126,0.06); border: 1px solid rgba(74,124,126,0.2); border-radius: 10px; margin-top: 10px; }
        .dm-data-src { padding: 10px 0; border-bottom: 1px dashed rgba(74,124,126,0.25); }
        .dm-data-src:last-child { border-bottom: 0; padding-bottom: 2px; }
        .dm-data-src:first-child { padding-top: 2px; }
        .dm-data-src .dsrc-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; flex-wrap: wrap; }
        .dm-data-src .dsrc-name { font-family: "Space Grotesk"; font-weight: 600; font-size: 14px; color: #2a2420; }
        .dm-data-src .dsrc-method { font-family: "Space Mono", monospace; font-size: 11px; color: #4A7C7E; }
        .dm-data-src .dsrc-fields { font-family: "Space Mono", monospace; font-size: 12px; color: rgba(42,36,32,0.8); margin-top: 6px; line-height: 1.7; padding-left: 14px; border-left: 2px solid rgba(74,124,126,0.3); }
        .dm-empty-note { font-size: 13px; font-style: italic; color: rgba(42,36,32,0.55); padding: 8px 0; }
        .dm-live { margin-top: 12px; padding: 14px 16px; background: rgba(74,158,92,0.08); border: 1px solid rgba(74,158,92,0.3); border-radius: 10px; }
        .dm-live.empty { background: rgba(215,25,33,0.06); border-color: rgba(215,25,33,0.25); }
        .dm-live-hd { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; }
        .dm-live-title { font-family: "Space Mono", monospace; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: #166534; font-weight: 600; }
        .dm-live.empty .dm-live-title { color: #b61319; }
        .dm-live-stamp { font-family: "Space Mono", monospace; font-size: 11px; color: rgba(42,36,32,0.5); }
        .dm-live-sub { font-family: "Space Mono", monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.55); margin: 10px 0 4px; font-weight: 600; }
        .dm-live-short { font-family: "Space Grotesk"; font-size: 14px; line-height: 1.55; color: #2a2420; padding: 8px 10px; background: #fff; border: 1px solid rgba(42,36,32,0.12); border-radius: 6px; }
        .dm-live-expanded { font-family: "Space Grotesk"; font-size: 14px; line-height: 1.6; color: #2a2420; padding: 10px 12px; background: #fff; border: 1px solid rgba(42,36,32,0.12); border-radius: 6px; white-space: pre-wrap; }
        .dm-live-raw { font-family: "Space Mono", monospace; font-size: 12px; line-height: 1.55; color: rgba(42,36,32,0.8); padding: 10px 12px; background: #fdfaf2; border: 1px solid rgba(42,36,32,0.08); border-radius: 6px; white-space: pre-wrap; max-height: 280px; overflow: auto; }
        .dm-skill { margin-top: 10px; padding: 12px 14px; background: rgba(107,33,168,0.06); border: 1px solid rgba(107,33,168,0.25); border-radius: 10px; }
        .dm-skill.missing { background: rgba(42,36,32,0.04); border-color: rgba(42,36,32,0.15); }
        .dm-skill-hd { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
        .dm-skill-title { font-family: "Space Mono", monospace; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: #6b21a8; font-weight: 600; }
        .dm-skill.missing .dm-skill-title { color: rgba(42,36,32,0.55); }
        .dm-skill-meta { font-family: "Space Mono", monospace; font-size: 11px; color: rgba(42,36,32,0.55); }
        .dm-readiness { font-family: "Space Mono", monospace; font-size: 11px; padding: 3px 10px; border-radius: 999px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600; }
        .dm-readiness.healthy  { background: rgba(74,158,92,0.15);  color: #166534; }
        .dm-readiness.partial  { background: rgba(234,179,8,0.18);  color: #854d0e; }
        .dm-readiness.critical { background: rgba(215,25,33,0.12);  color: #b61319; }
        .dm-finding { padding: 8px 10px; background: #fff; border: 1px solid rgba(107,33,168,0.15); border-radius: 6px; margin-bottom: 6px; font-size: 13px; line-height: 1.5; }
        .dm-finding-head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 4px; flex-wrap: wrap; }
        .dm-sev { font-family: "Space Mono", monospace; font-size: 10px; padding: 2px 8px; border-radius: 999px; letter-spacing: 0.06em; text-transform: uppercase; font-weight: 600; }
        .dm-sev.critical { background: rgba(215,25,33,0.12); color: #b61319; border: 1px solid rgba(215,25,33,0.3); }
        .dm-sev.warning  { background: rgba(234,179,8,0.18); color: #854d0e; border: 1px solid rgba(234,179,8,0.4); }
        .dm-sev.info     { background: rgba(74,124,126,0.12); color: #4A7C7E; border: 1px solid rgba(74,124,126,0.3); }
        .dm-finding-label { font-family: "Space Grotesk"; font-weight: 600; font-size: 13px; color: #2a2420; }
        .dm-finding-citation { font-family: "Space Mono", monospace; font-size: 11px; color: rgba(42,36,32,0.55); margin-top: 2px; word-break: break-word; }
        .dm-highlight { display: inline-block; margin: 2px 6px 2px 0; padding: 3px 10px; background: rgba(107,33,168,0.08); color: #6b21a8; border: 1px solid rgba(107,33,168,0.25); border-radius: 999px; font-size: 11px; font-family: "Space Mono", monospace; }
      `}</style>
      <div className="sc-root">
        <div className="sc-bar">
          <span>Scout Config Preview</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ opacity: 0.6 }}>{state.status.toUpperCase()}</span>
            {state.status === 'ready' && (
              <>
                <button
                  type="button"
                  onClick={regenerate}
                  disabled={regenState.running}
                  style={{
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    padding: '6px 12px',
                    background: regenState.running ? 'rgba(245,241,223,0.25)' : '#F5F1DF',
                    color: regenState.running ? 'rgba(245,241,223,0.7)' : '#1a1614',
                    border: '1px solid rgba(245,241,223,0.4)',
                    borderRadius: 6,
                    cursor: regenState.running ? 'default' : 'pointer',
                  }}
                >
                  {regenState.running ? 'Regenerating…' : 'Regenerate Now'}
                </button>
                <button
                  type="button"
                  onClick={runScouts}
                  disabled={scoutRun.running || !data?.hasConfig}
                  style={{
                    fontFamily: '"Space Mono", monospace',
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    padding: '6px 12px',
                    background: scoutRun.running ? 'rgba(74,158,92,0.25)' : '#4A9E5C',
                    color: scoutRun.running ? 'rgba(245,241,223,0.7)' : '#F5F1DF',
                    border: '1px solid rgba(74,158,92,0.6)',
                    borderRadius: 6,
                    cursor: scoutRun.running ? 'default' : 'pointer',
                  }}
                >
                  {scoutRun.running ? 'Running Scouts…' : 'Run Scouts'}
                </button>
              </>
            )}
          </span>
        </div>
        <div className="sc-tabs">
          <button type="button" className={`sc-tab${tab === 'config' ? ' is-active' : ''}`} onClick={() => setTab('config')}>Config</button>
          <button type="button" className={`sc-tab${tab === 'datamap' ? ' is-active' : ''}`} onClick={() => setTab('datamap')}>Data Map</button>
          <button type="button" className={`sc-tab${tab === 'runs' ? ' is-active' : ''}`} onClick={() => setTab('runs')}>Runs</button>
          <button type="button" className={`sc-tab${tab === 'notes' ? ' is-active' : ''}`} onClick={() => setTab('notes')}>Notes</button>
        </div>

        {tab === 'datamap' && <DataMapTab user={user} />}
        {tab === 'runs' && <RunsTab user={user} />}
        {tab === 'notes' && <NotesTab user={user} />}

        {tab === 'config' && (<>

        {regenState.message && (
          <div style={{
            padding: '8px 14px',
            fontFamily: '"Space Mono", monospace',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: regenState.message.startsWith('Error') ? '#b61319' : 'rgba(42,36,32,0.7)',
          }}>
            {regenState.message}
          </div>
        )}

        {scoutRun.message && (
          <div style={{
            padding: '10px 14px',
            marginBottom: 14,
            fontFamily: '"Space Mono", monospace',
            fontSize: 11,
            letterSpacing: '0.08em',
            color: scoutRun.message.startsWith('Error') ? '#b61319' : 'rgba(42,36,32,0.7)',
            background: 'rgba(74,158,92,0.08)',
            border: '1px solid rgba(74,158,92,0.3)',
            borderRadius: 10,
          }}>
            {scoutRun.message}
          </div>
        )}

        {scoutRun.result && (
          <div className="sc-section">
            <div className="sc-label">Scout Run · {scoutRun.result.runAt}</div>
            {scoutRun.result.runs.map((r, i) => (
              <div key={i} className="sc-row">
                <div className="k">{r.key}</div>
                <div className="v">
                  <strong style={{ color: r.status === 'ok' ? '#166534' : r.status === 'error' ? '#b61319' : 'rgba(42,36,32,0.5)' }}>{r.status}</strong>
                  {' · '}{r.ranMs}ms
                  {r.cost != null ? ` · $${Number(r.cost).toFixed(4)}` : ''}
                  {r.error ? ` · ${r.error}` : ''}
                  {r.reason ? ` · ${r.reason}` : ''}
                </div>
              </div>
            ))}
            {scoutRun.result.externalSignals?.reddit && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(42,36,32,0.1)' }}>
                <div className="sc-label">Reddit · {scoutRun.result.externalSignals.reddit.mentionCount} mentions · {scoutRun.result.externalSignals.reddit.participationOpportunityCount} opportunities</div>
                {(scoutRun.result.externalSignals.reddit.mentions || []).slice(0, 3).map((m, i) => (
                  <div key={i} style={{ padding: '8px 0', borderBottom: '1px dashed rgba(42,36,32,0.1)' }}>
                    <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 10, color: 'rgba(42,36,32,0.5)' }}>{m.subreddit}</div>
                    <div style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', fontSize: 13 }}>{m.title}</div>
                    {m.summary && <div style={{ fontSize: 12, color: 'rgba(42,36,32,0.7)', marginTop: 2 }}>{m.summary}</div>}
                    {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#4A7C7E' }}>open →</a>}
                  </div>
                ))}
              </div>
            )}
            {scoutRun.result.externalSignals?.weather && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(42,36,32,0.1)' }}>
                <div className="sc-label">Weather · {scoutRun.result.externalSignals.weather.neighborhoods?.length || 0} neighborhood(s)</div>
                <div className="sc-row">
                  <div className="k">overall</div>
                  <div className="v">{scoutRun.result.externalSignals.weather.overall?.summary || '—'}</div>
                </div>
              </div>
            )}
            {scoutRun.result.externalSignals?.reviews && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(42,36,32,0.1)' }}>
                <div className="sc-label">Reviews · {scoutRun.result.externalSignals.reviews.overallStatus}</div>
                {(scoutRun.result.externalSignals.reviews.sources || []).slice(0, 3).map((s, i) => (
                  <div key={i} className="sc-row">
                    <div className="k">{s.label || s.key}</div>
                    <div className="v">{s.rating != null ? `${s.rating} stars` : ''}{s.count != null ? ` · ${s.count} reviews` : ''}{s.lastReviewedAt ? ` · ${s.lastReviewedAt}` : ''}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {state.status === 'loading' && <div style={{ padding: 24 }}>Loading…</div>}
        {state.status === 'error' && (
          <div className="sc-stale">Error: {state.error}</div>
        )}

        {state.status === 'ready' && !data?.hasConfig && (
          <div className="sc-section">
            <div className="sc-label">No scoutConfig yet</div>
            <div>Run the pipeline once to generate it. You'll see the config here after the next successful run.</div>
          </div>
        )}

        {state.status === 'ready' && (
          <div style={{ padding: '10px 14px', marginBottom: 14, background: 'rgba(42,36,32,0.04)', border: '1px solid rgba(42,36,32,0.1)', borderRadius: 10, fontFamily: '"Space Mono", monospace', fontSize: 12 }}>
            <span style={{ color: 'rgba(42,36,32,0.5)', letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 10 }}>Currently crawling</span>
            <div style={{ fontSize: 15, marginTop: 4, color: '#2a2420' }}>{currentUrl || <em>(no websiteUrl on clients/{data?.clientId})</em>}</div>
            <div style={{ fontSize: 10, color: 'rgba(42,36,32,0.5)', marginTop: 4 }}>Client id: {data?.clientId}</div>
          </div>
        )}

        {state.status === 'ready' && cfg && (
          <>
            {stale && (
              <div className="sc-stale">
                {!cachedUrl
                  ? <>Stale — this config was generated before the URL-tracking patch. Click <strong>Regenerate Now</strong> above to re-crawl and rebuild against the current site ({currentUrl}).</>
                  : <>Stale — cached for <strong>{cachedUrl}</strong> but current site is <strong>{currentUrl}</strong>. Click <strong>Regenerate Now</strong> above or reseed from the dashboard.</>}
              </div>
            )}

            <Section label="Meta">
              <Row k="clientType"       v={cfg._meta?.clientType} />
              <Row k="websiteUrl (cached)" v={cachedUrl} />
              <Row k="generatedAt"      v={cfg._meta?.generatedAt} />
              <Row k="genCost"          v={cfg._meta?.runCostData?.estimatedCostUsd != null ? `$${Number(cfg._meta.runCostData.estimatedCostUsd).toFixed(4)}` : '—'} />
              <Row k="capabilities on"  v={(cfg._meta?.capabilitiesActive || []).join(' · ')} />
              <Row k="capabilities off" v={(cfg._meta?.capabilitiesInactive || []).map((x) => `${x.id}(${x.reason})`).join(' · ')} />
            </Section>

            <Section label="Identity">
              <Row k="clientName" v={cfg.clientName} />
              <Row k="timeZone"   v={cfg.timeZone} />
            </Section>

            <ChipSection label="Brand Keywords" items={cfg.brandKeywords} />
            <ChipSection label="Competitors (inferred)" items={cfg.competitors} />
            <ChipSection label="Category Terms" items={cfg.categoryTerms} />
            <ChipSection label="KOLs" items={cfg.kols} />

            {cfg.reddit && (
              <Section label="Reddit">
                <Row k="subreddits"         v={cfg.reddit.subreddits?.join(' · ')} />
                <Row k="mentionQueries"     v={cfg.reddit.mentionQueries?.join(' · ')} />
                <Row k="opportunityQueries" v={cfg.reddit.opportunityQueries?.join(' · ')} />
              </Section>
            )}

            <Capability label="Weather" data={cfg.weather}>
              {(w) => (
                <>
                  <Row k="provider"      v={w.provider} />
                  <Row k="neighborhoods" v={(w.serviceNeighborhoods || []).map((n) => `${n.name} (${n.latitude?.toFixed(3)}, ${n.longitude?.toFixed(3)})`).join(' · ')} />
                  <Row k="window"        v={`${w.operationalWindowStartHour}h → +${w.operationalWindowHours}h`} />
                </>
              )}
            </Capability>

            <Capability label="Reviews" data={cfg.reviews}>
              {(r) => (
                <>
                  <Row k="provider" v={r.provider} />
                  {(r.sources || []).map((s, i) => <Row key={i} k={s.label || s.key} v={s.query} />)}
                </>
              )}
            </Capability>

            <Capability label="Instagram" data={cfg.instagram}>
              {(ig) => (
                <>
                  <Row k="provider"   v={ig.provider} />
                  <Row k="handle"     v={`@${ig.handle}`} />
                  <Row k="profileUrl" v={ig.profileUrl} />
                </>
              )}
            </Capability>

            {cfg.scout && (
              <Section label="Scout · Search Plan">
                <Row k="freshnessDays"        v={cfg.scout.freshnessDays} />
                <Row k="sourceFocus"          v={cfg.scout.sourceFocus} />
                <Row k="analysisInstructions" v={cfg.scout.analysisInstructions} />
                <div style={{ marginTop: 12 }}>
                  {(cfg.scout.searchPlan || []).map((p, i) => (
                    <div className="sc-plan" key={i}>
                      <div className="num">{String(i + 1).padStart(2, '0')}</div>
                      <div className="title">{p.label}</div>
                      <div className="query">{p.query}</div>
                      <div className="goal">goal: {p.goal}</div>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        </>)}
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div className="sc-section">
      <div className="sc-label">{label}</div>
      {children}
    </div>
  );
}

function Row({ k, v }) {
  return (
    <div className="sc-row">
      <div className="k">{k}</div>
      <div className="v">{v == null || v === '' ? <span className="sc-empty">—</span> : v}</div>
    </div>
  );
}

function ChipSection({ label, items }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return (
    <div className="sc-section">
      <div className="sc-label">{label} ({list.length})</div>
      {list.length ? (
        <div className="sc-chips">
          {list.map((item, i) => <span className="sc-chip" key={i}>{item}</span>)}
        </div>
      ) : (
        <span className="sc-empty">(empty)</span>
      )}
    </div>
  );
}

function Capability({ label, data, children }) {
  return (
    <Section label={label}>
      {data ? children(data) : <span className="sc-empty">inactive for this client</span>}
    </Section>
  );
}

function DataMapTab({ user }) {
  const [state, setState] = useState({ status: 'loading', sources: [], cards: [], error: '' });
  const [notesByAnchor, setNotesByAnchor] = useState({});
  const [writeAllowed, setWriteAllowed] = useState(false);
  const [openAnchor, setOpenAnchor] = useState(null);
  const [liveCopy, setLiveCopy] = useState({ status: 'loading', cards: {}, lastRunAt: null, hasScribe: false, error: '' });

  async function loadMap() {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/scout-data-map', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setState({ status: 'ready', sources: body.sources || [], cards: body.cards || [], error: '' });
    } catch (err) {
      setState({ status: 'error', sources: [], cards: [], error: err.message || String(err) });
    }
  }

  async function loadLiveCopy() {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/scout-card-copy', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLiveCopy({ status: 'error', cards: {}, lastRunAt: null, hasScribe: false, error: body.error || `HTTP ${res.status}` });
        return;
      }
      setLiveCopy({
        status: 'ready',
        cards: body.cards || {},
        lastRunAt: body.lastRunAt || null,
        hasScribe: Boolean(body.hasScribe),
        analyzerFlagEnabled: Boolean(body.analyzerFlagEnabled),
        analyzerOutputCount: Number(body.analyzerOutputCount || 0),
        skillWarnings: Array.isArray(body.skillWarnings) ? body.skillWarnings : [],
        allWarnings:   Array.isArray(body.allWarnings)   ? body.allWarnings   : [],
        error: '',
      });
    } catch (err) {
      setLiveCopy({ status: 'error', cards: {}, lastRunAt: null, hasScribe: false, error: err.message || String(err) });
    }
  }

  async function loadNotes() {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/scout-map-notes', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setWriteAllowed(Boolean(body.writeAllowed));
      const byAnchor = {};
      for (const n of body.notes || []) {
        if (!byAnchor[n.anchor]) byAnchor[n.anchor] = [];
        byAnchor[n.anchor].push(n);
      }
      setNotesByAnchor(byAnchor);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!user) return;
    loadMap();
    loadNotes();
    loadLiveCopy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function addNote(anchor, text) {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/scout-map-notes', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ anchor, text }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    await loadNotes();
  }

  if (state.status === 'loading') return <div style={{ padding: 12 }}>Loading data map…</div>;
  if (state.status === 'error')   return <div className="sc-stale">Error: {state.error}</div>;

  const sourcesByCat = groupBy(state.sources, 'category');
  const sourcesById  = Object.fromEntries(state.sources.map((s) => [s.id, s]));
  const freeCards    = state.cards.filter((c) => c.tier === 'all');
  const paidCards    = state.cards.filter((c) => c.tier === 'paid');

  const srcCategoryOrder  = ['site', 'llm', 'intelligence', 'external-scout', 'scout-config', 'user'];

  return (
    <div>
      <div className="sc-section">
        <div className="sc-label" style={{ fontSize: 13 }}>Scout Data Map</div>
        <div style={{ fontSize: 15, color: 'rgba(42,36,32,0.75)', lineHeight: 1.55 }}>
          Complete mapping of every data source the system collects and how it influences each dashboard card —
          free tier, paid tier, and runtime chrome all rendered. Click any <span className="dm-note-btn" style={{ display: 'inline-block' }}>note</span> button on any row to annotate. Notes persist to
          <code style={{ padding: '2px 7px', background: 'rgba(42,36,32,0.06)', borderRadius: 4, marginLeft: 6, fontSize: 13 }}>docs/scout-data-map.notes.json</code>.
          {!writeAllowed && <div style={{ marginTop: 10, color: '#b61319', fontSize: 14 }}>Write disabled (production or non-admin session). Read-only view.</div>}
        </div>
      </div>

      {/* ── Analyzer Skills flag banner (P1 status) ── */}
      {(() => {
        const flagOn = liveCopy.analyzerFlagEnabled;
        const outputs = liveCopy.analyzerOutputCount || 0;
        const skillWarnings = liveCopy.skillWarnings || [];
        // Three states: flag off, flag on + skill warnings, flag on + outputs, flag on + nothing
        const tone =
          !flagOn                          ? 'off'
          : skillWarnings.length > 0       ? 'warn'
          : outputs > 0                    ? 'good'
          : 'neutral';
        const bg = {
          off:     'rgba(215,25,33,0.06)',
          warn:    'rgba(234,179,8,0.12)',
          good:    'rgba(74,158,92,0.1)',
          neutral: 'rgba(42,36,32,0.04)',
        }[tone];
        const border = {
          off:     'rgba(215,25,33,0.3)',
          warn:    'rgba(234,179,8,0.45)',
          good:    'rgba(74,158,92,0.35)',
          neutral: 'rgba(42,36,32,0.18)',
        }[tone];
        const color = {
          off:     '#b61319',
          warn:    '#854d0e',
          good:    '#166534',
          neutral: 'rgba(42,36,32,0.7)',
        }[tone];
        return (
          <div className="sc-section" style={{ background: bg, borderColor: border }}>
            <div className="dm-sub-label" style={{ margin: 0, fontSize: 12, color }}>
              Analyzer Skills · {flagOn ? 'FLAG ON' : 'FLAG OFF'}
              {flagOn && skillWarnings.length > 0 && ` · ${skillWarnings.length} warning${skillWarnings.length === 1 ? '' : 's'}`}
              {flagOn && skillWarnings.length === 0 && ` · ${outputs} output${outputs === 1 ? '' : 's'}`}
            </div>
            <div style={{ fontSize: 14, marginTop: 6, color, lineHeight: 1.55 }}>
              {!flagOn && (
                <>Set <code style={{ padding: '2px 6px', background: 'rgba(42,36,32,0.06)', borderRadius: 4 }}>SCOUT_ANALYZER_SKILLS_ENABLED=1</code> in <code style={{ padding: '2px 6px', background: 'rgba(42,36,32,0.06)', borderRadius: 4 }}>.env.local</code>, restart dev server, re-run the pipeline.</>
              )}
              {flagOn && outputs > 0 && skillWarnings.length === 0 && (
                <>Last run produced <strong>{outputs}</strong> analyzer output{outputs === 1 ? '' : 's'}. P1 acceptance met.</>
              )}
              {flagOn && outputs === 0 && skillWarnings.length === 0 && (
                <>Flag is on but the last run produced no analyzer outputs and no skill warnings. Likely cause: the flag was not live in the server process at run time. Kill the dev server completely and restart with <code style={{ padding: '2px 6px', background: 'rgba(42,36,32,0.06)', borderRadius: 4 }}>SCOUT_ANALYZER_SKILLS_ENABLED=1 npm run dev</code>, then re-run.</>
              )}
              {flagOn && skillWarnings.length > 0 && (
                <>
                  <div style={{ marginBottom: 8 }}>Skill step ran but failed. Details:</div>
                  {skillWarnings.map((w, i) => (
                    <div key={i} style={{ padding: '8px 10px', background: '#fff', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 6, marginBottom: 6, fontSize: 13 }}>
                      <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 11, color: '#854d0e', letterSpacing: '0.06em' }}>
                        {w.code || 'warning'}{w.stage ? ` · ${w.stage}` : ''}
                      </div>
                      <div style={{ marginTop: 4, color: '#2a2420' }}>{w.message || '(no message)'}</div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Live run banner ── */}
      <div className="sc-section" style={{ background: liveCopy.status === 'ready' && liveCopy.hasScribe ? 'rgba(74,158,92,0.08)' : 'rgba(215,25,33,0.06)', borderColor: liveCopy.status === 'ready' && liveCopy.hasScribe ? 'rgba(74,158,92,0.3)' : 'rgba(215,25,33,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <div className="dm-sub-label" style={{ margin: 0, fontSize: 12, color: liveCopy.hasScribe ? '#166534' : '#b61319' }}>
              {liveCopy.status === 'loading' && 'Loading live run…'}
              {liveCopy.status === 'error'   && `Live run unavailable: ${liveCopy.error}`}
              {liveCopy.status === 'ready'   && (liveCopy.hasScribe ? 'Live pipeline data available' : 'No Scribe output yet — run the pipeline to populate card copy')}
            </div>
            {liveCopy.lastRunAt && (
              <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 12, color: 'rgba(42,36,32,0.6)', marginTop: 4 }}>
                last run: {liveCopy.lastRunAt}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Summary of every card, jump-to-anchor ── */}
      <div className="sc-section">
        <div className="dm-sub-label" style={{ fontSize: 13 }}>
          All cards on the dashboard ({state.cards.length} total · {freeCards.length} free · {paidCards.length} paid)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
          {state.cards.map((c) => (
            <a
              key={c.id}
              href={`#anchor-card:${c.id}`}
              style={{
                fontFamily: '"Space Mono", monospace',
                fontSize: 12,
                padding: '4px 10px',
                background: c.tier === 'paid' ? '#1a1614' : '#fff',
                color:      c.tier === 'paid' ? '#F5F1DF' : '#2a2420',
                border: '1px solid ' + (c.tier === 'paid' ? '#1a1614' : 'rgba(212,196,171,0.82)'),
                borderRadius: 999,
                textDecoration: 'none',
                letterSpacing: '0.04em',
              }}
              title={`${c.navTitle} · ${c.category} · ${c.actionClass}`}
            >
              {c.navLabel}
            </a>
          ))}
        </div>
      </div>

      {/* ── SOURCES ───────────────────────────────────────────── */}
      <div className="dm-group">
        <div className="dm-group-title">1 · Source Inventory — what Scout collects</div>
        {srcCategoryOrder.map((cat) => {
          const list = sourcesByCat[cat] || [];
          if (!list.length) return null;
          return (
            <div key={cat} style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.5)', margin: '6px 0' }}>
                {cat}
              </div>
              {list.map((s) => {
                const anchor = `source:${s.id}`;
                return (
                  <div key={s.id} className="dm-src" id={`anchor-${anchor}`}>
                    <div className="hd">
                      <div>
                        <div className="name">{s.label}</div>
                        <div className="method">{s.collection.method}</div>
                      </div>
                      <NoteButton
                        anchor={anchor}
                        notes={notesByAnchor[anchor]}
                        isOpen={openAnchor === anchor}
                        onToggle={() => setOpenAnchor(openAnchor === anchor ? null : anchor)}
                      />
                    </div>
                    <div className="detail">{s.collection.detail}</div>
                    <div className="meta">
                      <span>auth: {s.collection.auth}</span>
                      <span>cost: {s.collection.costPerRun}</span>
                      <span>file: {s.collection.file}</span>
                      <span>freshness: {s.freshness}</span>
                    </div>
                    <div className="fields">
                      {(s.payloadFields || []).map((f, i) => <div key={i}>• {f}</div>)}
                    </div>
                    <ExistingNotes notes={notesByAnchor[anchor]} />
                    {openAnchor === anchor && writeAllowed && (
                      <InlineNoteForm
                        anchor={anchor}
                        onSubmit={(text) => addNote(anchor, text)}
                        onCancel={() => setOpenAnchor(null)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ── CARDS ─────────────────────────────────────────────── */}
      <div className="dm-group">
        <div className="dm-group-title">
          2 · Dashboard Cards ({state.cards.length}) — every card, in contract order
        </div>
        <div style={{ fontSize: 13, color: 'rgba(42,36,32,0.6)', marginBottom: 12 }}>
          Flat list of every card on the dashboard. Tier badge shows free vs paid. Each card's
          data sources, missing-state rules, and Scribe budgets are below its name. Click any
          <span className="dm-note-btn" style={{ display: 'inline-block', margin: '0 4px' }}>note</span>
          button to annotate.
        </div>
        {state.cards.map((c) => (
          <CardRow
            key={c.id}
            card={c}
            sourcesById={sourcesById}
            notesByAnchor={notesByAnchor}
            openAnchor={openAnchor}
            setOpenAnchor={setOpenAnchor}
            writeAllowed={writeAllowed}
            onAddNote={addNote}
            liveCopy={liveCopy.cards?.[c.id] || null}
            liveStatus={liveCopy.status}
            lastRunAt={liveCopy.lastRunAt}
          />
        ))}
      </div>
    </div>
  );
}

function CardRow({ card, sourcesById, notesByAnchor, openAnchor, setOpenAnchor, writeAllowed, onAddNote, liveCopy, liveStatus, lastRunAt }) {
  const anchor = `card:${card.id}`;
  const srcList  = Array.isArray(card.sources) ? card.sources : [];
  const hasSources = srcList.length > 0;
  const hasRules   = Array.isArray(card.missingStateRules) && card.missingStateRules.length > 0;

  return (
    <div className="dm-card" id={`anchor-${anchor}`}>
      <div className="dm-card-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="dm-card-title">{card.navTitle}</div>
          <div className="dm-card-sub">id: {card.id} · nav: {card.navLabel} · category: {card.category} · role: {card.role}</div>
          <div className="dm-card-src-row">
            <span className="hint">Sources ({srcList.length}):</span>
            {hasSources
              ? srcList.map((s) => <span key={s} className="chip">{s}</span>)
              : <span className="none">none declared</span>}
          </div>
        </div>
        <div className="dm-chips">
          <span className={`dm-chip action-${card.actionClass}`}>{card.actionClass}</span>
          <span className={`dm-chip tier-${card.tier}`}>{card.tier}</span>
          <NoteButton
            anchor={anchor}
            notes={notesByAnchor[anchor]}
            isOpen={openAnchor === anchor}
            onToggle={() => setOpenAnchor(openAnchor === anchor ? null : anchor)}
          />
        </div>
      </div>

      {/* ── Data Received — concrete fields from every wired source ── */}
      <div className="dm-sub">
        <div className="dm-sub-label">Data received by this card</div>
        {hasSources ? (
          <div className="dm-data-block">
            {srcList.map((srcId) => {
              const src = sourcesById?.[srcId];
              if (!src) {
                return (
                  <div key={srcId} className="dm-data-src">
                    <div className="dsrc-head">
                      <span className="dsrc-name">{srcId}</span>
                      <span className="dsrc-method" style={{ color: '#b61319' }}>source not in inventory</span>
                    </div>
                  </div>
                );
              }
              return (
                <div key={srcId} className="dm-data-src">
                  <div className="dsrc-head">
                    <span className="dsrc-name">{src.label}</span>
                    <span className="dsrc-method">{src.collection.method}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(42,36,32,0.7)', marginTop: 4, lineHeight: 1.5 }}>
                    {src.collection.detail}
                  </div>
                  {Array.isArray(src.payloadFields) && src.payloadFields.length > 0 && (
                    <div className="dsrc-fields">
                      {src.payloadFields.map((f, i) => <div key={i}>• {f}</div>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="dm-empty-note">
            {card.tier === 'paid'
              ? 'Upgrade-tier preview — not yet wired to pipeline data. Scribe treats as service-offer placeholder.'
              : card.actionClass === 'runtime'
                ? 'Runtime/chrome card — no pipeline data by design.'
                : 'No sources declared. Either unwired or contract needs an update — add a note.'}
          </div>
        )}
      </div>

      {/* ── Missing-state rules ── */}
      {hasRules && (
        <div className="dm-sub">
          <div className="dm-sub-label">Missing-state rules ({card.missingStateRules.length}) — trigger Scribe to surface a recommendation</div>
          {card.missingStateRules.map((r) => {
            const rAnchor = `card:${card.id}.missing-state.${r.id}`;
            return (
              <div key={r.id} className="dm-rule" id={`anchor-${rAnchor}`}>
                <div className="rrow">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="rid">{r.id}</div>
                    <div className="rwhen">when: {r.when}</div>
                    <div className="rtext"><strong>reason:</strong> {r.reason}</div>
                    <div className="rtext"><strong>offer:</strong> {r.offer}</div>
                  </div>
                  <NoteButton
                    anchor={rAnchor}
                    notes={notesByAnchor[rAnchor]}
                    isOpen={openAnchor === rAnchor}
                    onToggle={() => setOpenAnchor(openAnchor === rAnchor ? null : rAnchor)}
                  />
                </div>
                <ExistingNotes notes={notesByAnchor[rAnchor]} />
                {openAnchor === rAnchor && writeAllowed && (
                  <InlineNoteForm
                    anchor={rAnchor}
                    onSubmit={(text) => onAddNote(rAnchor, text)}
                    onCancel={() => setOpenAnchor(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Scribe copy budgets + intake field pointer ── */}
      <div className="dm-sub">
        <div className="dm-sub-label">Scribe · copy budgets + intake pointer</div>
        <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 13, color: 'rgba(42,36,32,0.75)', lineHeight: 1.7 }}>
          {card.copy
            ? <div>budgets: short {card.copy.short.min}–{card.copy.short.max}ch · expanded {card.copy.expanded.min}–{card.copy.expanded.max}ch</div>
            : <div style={{ fontStyle: 'italic', color: 'rgba(42,36,32,0.55)' }}>no copy generated (runtime card)</div>}
          {card.sourceField && (
            <div>intake field: <span style={{ color: '#4A7C7E' }}>{card.sourceField}</span>{card.fallbackField ? <> ↩ fallback: <span style={{ color: '#4A7C7E' }}>{card.fallbackField}</span></> : null}</div>
          )}
          {card.analyzer?.impl && (
            <div>analyzer impl: <span style={{ color: '#6b21a8' }}>{card.analyzer.impl}</span></div>
          )}
        </div>
      </div>

      {/* ── Live Copy · rendered content from the last pipeline run ── */}
      <LiveCopyBlock live={liveCopy} status={liveStatus} lastRunAt={lastRunAt} card={card} />

      <ExistingNotes notes={notesByAnchor[anchor]} />
      {openAnchor === anchor && writeAllowed && (
        <InlineNoteForm
          anchor={anchor}
          onSubmit={(text) => onAddNote(anchor, text)}
          onCancel={() => setOpenAnchor(null)}
        />
      )}
    </div>
  );
}

function LiveCopyBlock({ live, status, lastRunAt, card }) {
  if (status === 'loading') {
    return (
      <div className="dm-live empty">
        <div className="dm-live-hd"><span className="dm-live-title">Rendered copy · loading…</span></div>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="dm-live empty">
        <div className="dm-live-hd"><span className="dm-live-title">Rendered copy · unavailable</span></div>
      </div>
    );
  }

  const hasScribe = Boolean(live?.scribe && (live.scribe.short || live.scribe.expanded));
  const hasRaw    = live?.present;
  const staticCopy = live?.staticCopy || null;
  const hasStatic  = Boolean(staticCopy?.description);
  const analyzerOutput = live?.analyzerOutput || null;
  const analyzerSkill  = live?.analyzerSkill || null;

  return (
    <div className={`dm-live${!hasScribe && !hasRaw && !hasStatic ? ' empty' : ''}`}>
      <div className="dm-live-hd">
        <span className="dm-live-title">
          Rendered copy · {hasScribe ? 'live scribe' : hasStatic ? 'static baseline' : 'no copy'}
        </span>
        <span className="dm-live-stamp">{lastRunAt || '—'}</span>
      </div>

      {/* ── Analyzer skill block ── */}
      {(analyzerSkill || analyzerOutput) && (
        <div className={`dm-skill${analyzerSkill && !analyzerOutput ? ' missing' : ''}`}>
          <div className="dm-skill-hd">
            <span className="dm-skill-title">
              Analyzer skill · {analyzerSkill || '(none attached)'}
              {analyzerSkill && !analyzerOutput && ' — did not run last pipeline'}
              {analyzerOutput && ` · ${analyzerOutput.findings?.length || 0} finding${analyzerOutput.findings?.length === 1 ? '' : 's'}`}
            </span>
            {analyzerOutput?.readiness && (
              <span className={`dm-readiness ${analyzerOutput.readiness}`}>{analyzerOutput.readiness}</span>
            )}
          </div>
          {analyzerOutput && (
            <>
              <div className="dm-skill-meta">
                model: {analyzerOutput.metadata?.model || '—'} · cost: ${Number(analyzerOutput.metadata?.estimatedCostUsd || 0).toFixed(4)} · tokens in/out: {analyzerOutput.metadata?.inputTokens || 0}/{analyzerOutput.metadata?.outputTokens || 0} · run: {analyzerOutput.runAt?.slice(0, 19).replace('T', ' ') || '—'}
              </div>
              {Array.isArray(analyzerOutput.highlights) && analyzerOutput.highlights.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {analyzerOutput.highlights.map((h, i) => <span key={i} className="dm-highlight">{h}</span>)}
                </div>
              )}
              {Array.isArray(analyzerOutput.findings) && analyzerOutput.findings.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="dm-live-sub" style={{ margin: '0 0 6px 0' }}>Findings</div>
                  {analyzerOutput.findings.map((f, i) => (
                    <div key={i} className="dm-finding">
                      <div className="dm-finding-head">
                        <span className={`dm-sev ${f.severity || 'info'}`}>{f.severity || 'info'}</span>
                        <span className="dm-finding-label">{f.label || '(no label)'}</span>
                      </div>
                      {f.detail && <div style={{ color: 'rgba(42,36,32,0.8)' }}>{f.detail}</div>}
                      {f.citation && <div className="dm-finding-citation">cite: {f.citation}</div>}
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(analyzerOutput.gaps) && analyzerOutput.gaps.filter((g) => g.triggered).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="dm-live-sub" style={{ margin: '0 0 6px 0' }}>Gaps triggered</div>
                  {analyzerOutput.gaps.filter((g) => g.triggered).map((g, i) => (
                    <div key={i} className="dm-finding">
                      <div className="dm-finding-head">
                        <span className="dm-sev critical">gap</span>
                        <span className="dm-finding-label">{g.ruleId}</span>
                      </div>
                      {g.evidence && <div className="dm-finding-citation">evidence: {g.evidence}</div>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {hasStatic && (
        <>
          <div className="dm-live-sub">
            Static description (dashboard baseline · {staticCopy.description.length}ch)
          </div>
          <div className="dm-live-expanded" style={{ background: '#fff', borderColor: 'rgba(42,36,32,0.14)' }}>
            {staticCopy.description}
          </div>
          {staticCopy.alternateDescription && (
            <>
              <div className="dm-live-sub">
                Alt description · {staticCopy.altLabel || 'alternate state'}
              </div>
              <div className="dm-live-expanded" style={{ background: '#fff', borderColor: 'rgba(42,36,32,0.14)' }}>
                {staticCopy.alternateDescription}
              </div>
            </>
          )}
          {staticCopy.placeholderLabel && (
            <div className="dm-live-sub" style={{ color: 'rgba(42,36,32,0.5)' }}>
              placeholder label: <code style={{ fontSize: 11 }}>{staticCopy.placeholderLabel}</code>
            </div>
          )}
          {staticCopy.dynamicOverride && (
            <div className="dm-live-sub" style={{ color: '#6b21a8' }}>
              dynamic override: <code style={{ fontSize: 11 }}>{staticCopy.dynamicOverride}</code>
            </div>
          )}
        </>
      )}

      {!hasScribe && !hasRaw && !hasStatic && (
        <div style={{ fontSize: 13, color: 'rgba(42,36,32,0.65)', lineHeight: 1.5 }}>
          {card.tier === 'paid'
            ? 'Upgrade-tier card — not fed by pipeline yet.'
            : card.actionClass === 'runtime'
              ? 'Runtime/chrome card — no pipeline data by design.'
              : 'No static copy mapped and no pipeline data found. Add a note.'}
        </div>
      )}

      {hasScribe && live.scribe.short && (
        <>
          <div className="dm-live-sub">Scribe · short ({live.scribe.short.length}ch)</div>
          <div className="dm-live-short">{live.scribe.short}</div>
        </>
      )}
      {hasScribe && live.scribe.expanded && (
        <>
          <div className="dm-live-sub">Scribe · expanded ({live.scribe.expanded.length}ch)</div>
          <div className="dm-live-expanded">{live.scribe.expanded}</div>
        </>
      )}

      {live?.sourceField && (hasData(live.rawValue) || hasData(live.fallbackValue)) && (
        <>
          <div className="dm-live-sub">
            Raw intake · {live.sourceField}
            {live.fallbackField && hasData(live.fallbackValue) ? ` ↩ ${live.fallbackField}` : ''}
          </div>
          <div className="dm-live-raw">{formatLiveValue(hasData(live.rawValue) ? live.rawValue : live.fallbackValue)}</div>
        </>
      )}
    </div>
  );
}

function hasData(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

function formatLiveValue(v) {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function NoteButton({ anchor, notes, isOpen, onToggle }) {
  const openCount = (notes || []).filter((n) => n.status === 'open').length;
  const total = (notes || []).length;
  const hasAny = total > 0;
  const label = hasAny ? `📝 ${openCount || total}` : '📝 note';
  return (
    <button
      type="button"
      className={`dm-note-btn${hasAny ? ' has' : ''}`}
      onClick={onToggle}
      title={`anchor: ${anchor}${hasAny ? ` · ${openCount} open / ${total} total` : ''}`}
    >
      {isOpen ? '✕ close' : label}
    </button>
  );
}

function ExistingNotes({ notes }) {
  if (!Array.isArray(notes) || !notes.length) return null;
  const openNotes = notes.filter((n) => n.status === 'open');
  if (!openNotes.length) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {openNotes.map((n) => (
        <div key={n.id} className="dm-existing">
          <div className="dm-existing-meta">{n.author} · {n.createdAt?.slice(0, 10)}</div>
          <div>{n.text}</div>
        </div>
      ))}
    </div>
  );
}

function InlineNoteForm({ anchor, onSubmit, onCancel }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function handle(e) {
    e.preventDefault();
    if (!text.trim() || saving) return;
    setSaving(true);
    setErr('');
    try {
      await onSubmit(text.trim());
      setText('');
      onCancel();
    } catch (e2) {
      setErr(e2.message || String(e2));
      setSaving(false);
    }
  }

  return (
    <form className="dm-inline-form" onSubmit={handle}>
      <div className="row">
        <div className="anchor">anchor: {anchor}</div>
      </div>
      <textarea
        placeholder="Your note for this row…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        autoFocus
      />
      {err && <div style={{ color: '#b61319', fontSize: 11 }}>{err}</div>}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" disabled={saving || !text.trim()}>{saving ? 'Saving…' : 'Save note'}</button>
      </div>
    </form>
  );
}

function groupBy(arr, key) {
  const out = {};
  for (const item of arr) {
    const k = item[key] || '_';
    (out[k] = out[k] || []).push(item);
  }
  return out;
}

function RunsTab({ user }) {
  const [state, setState] = useState({ status: 'loading', runs: [], clientId: null, error: '' });

  async function load() {
    setState({ status: 'loading', runs: [], clientId: null, error: '' });
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/scout-recent-runs?limit=10', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setState({ status: 'ready', runs: body.runs || [], clientId: body.clientId || null, error: '' });
    } catch (err) {
      setState({ status: 'error', runs: [], clientId: null, error: err.message || String(err) });
    }
  }

  useEffect(() => { if (user) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user]);

  if (state.status === 'loading') return <div style={{ padding: 12 }}>Loading recent runs…</div>;
  if (state.status === 'error')   return <div className="sc-stale">Error: {state.error}</div>;
  if (!state.clientId)            return <div className="sc-section">No client bound to your account.</div>;

  return (
    <div>
      <div className="sc-section">
        <div className="dm-sub-label" style={{ fontSize: 13 }}>Recent brief_runs ({state.runs.length})</div>
        <div style={{ fontSize: 13, color: 'rgba(42,36,32,0.65)', marginTop: 4 }}>
          Last 10 pipeline runs for client <code style={{ padding: '2px 6px', background: 'rgba(42,36,32,0.06)', borderRadius: 4 }}>{state.clientId}</code>.
          Look for <strong>multiple runs</strong> (duplicate reseeds) or <strong>high <code>attempts</code></strong> (worker retried).
        </div>
        <button
          type="button"
          className="sc-tab"
          style={{ marginTop: 10 }}
          onClick={load}
        >↻ Refresh</button>
      </div>

      {state.runs.length === 0 && (
        <div className="sc-section"><span className="sc-empty">No brief_runs found.</span></div>
      )}

      {state.runs.map((r, i) => <RunRow key={r.runId || i} run={r} index={i} />)}
    </div>
  );
}

function RunRow({ run, index }) {
  const statusColor = {
    succeeded: { bg: 'rgba(74,158,92,0.12)',  fg: '#166534', bd: 'rgba(74,158,92,0.4)' },
    failed:    { bg: 'rgba(215,25,33,0.10)',  fg: '#b61319', bd: 'rgba(215,25,33,0.4)' },
    running:   { bg: 'rgba(234,179,8,0.14)',  fg: '#854d0e', bd: 'rgba(234,179,8,0.4)' },
    queued:    { bg: 'rgba(74,124,126,0.1)',  fg: '#4A7C7E', bd: 'rgba(74,124,126,0.4)' },
  }[run.status] || { bg: 'rgba(42,36,32,0.05)', fg: 'rgba(42,36,32,0.7)', bd: 'rgba(42,36,32,0.2)' };

  const warnStages = Object.keys(run.warnings?.byStage || {});

  return (
    <div className="sc-section" style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: '"Space Mono", monospace',
              fontSize: 11,
              padding: '3px 10px',
              background: statusColor.bg,
              color: statusColor.fg,
              border: `1px solid ${statusColor.bd}`,
              borderRadius: 999,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>{run.status || 'unknown'}</span>
            {run.trigger && (
              <span style={{ fontFamily: '"Space Mono", monospace', fontSize: 11, padding: '3px 10px', background: '#fff', border: '1px solid rgba(42,36,32,0.15)', borderRadius: 999, color: 'rgba(42,36,32,0.7)' }}>{run.trigger}</span>
            )}
            {typeof run.attempts === 'number' && run.attempts > 1 && (
              <span style={{ fontFamily: '"Space Mono", monospace', fontSize: 11, padding: '3px 10px', background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.4)', borderRadius: 999, color: '#854d0e', fontWeight: 600 }}>
                ⟲ attempts: {run.attempts}
              </span>
            )}
            {run.warningCount > 0 && (
              <span style={{ fontFamily: '"Space Mono", monospace', fontSize: 11, padding: '3px 10px', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 999, color: '#854d0e' }}>
                {run.warningCount} warning{run.warningCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div style={{ fontFamily: '"Space Grotesk"', fontSize: 15, fontWeight: 600, marginTop: 8, color: '#2a2420' }}>
            #{index + 1} · {run.sourceUrl || '(no sourceUrl)'}
          </div>
          <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 11, color: 'rgba(42,36,32,0.55)', marginTop: 4, wordBreak: 'break-all' }}>
            runId: {run.runId}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 4, columnGap: 10, fontSize: 12, fontFamily: '"Space Mono", monospace', color: 'rgba(42,36,32,0.75)', marginTop: 10 }}>
        <div style={{ color: 'rgba(42,36,32,0.5)' }}>createdAt</div>
        <div>{fmtTs(run.createdAt)}</div>
        <div style={{ color: 'rgba(42,36,32,0.5)' }}>startedAt</div>
        <div>{fmtTs(run.startedAt)}</div>
        <div style={{ color: 'rgba(42,36,32,0.5)' }}>completedAt</div>
        <div>{fmtTs(run.completedAt)}</div>
        <div style={{ color: 'rgba(42,36,32,0.5)' }}>pipeline</div>
        <div>{run.pipelineType || '—'}</div>
        <div style={{ color: 'rgba(42,36,32,0.5)' }}>artifacts</div>
        <div>{run.artifactCount}</div>
        <div style={{ color: 'rgba(42,36,32,0.5)' }}>scribe</div>
        <div>{run.hasSummary ? 'produced' : '—'}</div>
      </div>

      {run.error && (
        <div style={{ marginTop: 10, padding: '10px 12px', background: 'rgba(215,25,33,0.06)', border: '1px solid rgba(215,25,33,0.25)', borderRadius: 8 }}>
          <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 11, color: '#b61319', letterSpacing: '0.08em', marginBottom: 4 }}>ERROR</div>
          <div style={{ fontSize: 13, color: '#2a2420', lineHeight: 1.5 }}>
            {typeof run.error === 'string' ? run.error : JSON.stringify(run.error, null, 2)}
          </div>
        </div>
      )}

      {warnStages.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="dm-sub-label" style={{ fontSize: 11, margin: '0 0 6px 0' }}>Warnings by stage</div>
          {warnStages.map((stage) => (
            <div key={stage} style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 11, color: '#854d0e', fontWeight: 600, marginBottom: 4 }}>
                {stage} ({run.warnings.byStage[stage].length})
              </div>
              {run.warnings.byStage[stage].map((w, i) => (
                <div key={i} style={{ padding: '8px 10px', background: '#fff', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 6, marginBottom: 4, fontSize: 12, lineHeight: 1.5 }}>
                  <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 10, color: '#854d0e', letterSpacing: '0.06em' }}>{w.code || 'warning'}</div>
                  <div style={{ color: '#2a2420', marginTop: 2 }}>{w.message || '(no message)'}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmtTs(v) {
  if (!v) return '—';
  if (typeof v === 'string') return v.replace('T', ' ').slice(0, 19);
  return String(v);
}

function NotesTab({ user }) {
  const [notes, setNotes] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [writeAllowed, setWriteAllowed] = useState(false);
  const [filter, setFilter] = useState('open');
  const [form, setForm] = useState({ anchor: '', text: '', saving: false });
  const [diagnostic, setDiagnostic] = useState(null);

  async function load() {
    setStatus('loading');
    setError('');
    setDiagnostic(null);
    try {
      const token = await user.getIdToken();
      const qs = filter === 'all' ? '' : `?status=${filter}`;
      const res = await fetch(`/api/admin/scout-map-notes${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.diagnostic) setDiagnostic(body.diagnostic);
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setNotes(Array.isArray(body.notes) ? body.notes : []);
      setWriteAllowed(Boolean(body.writeAllowed));
      setStatus('ready');
    } catch (err) {
      setError(err.message || String(err));
      setStatus('error');
    }
  }

  useEffect(() => { if (user) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user, filter]);

  async function submit(e) {
    e.preventDefault();
    if (!form.anchor.trim() || !form.text.trim() || form.saving) return;
    setForm((f) => ({ ...f, saving: true }));
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/scout-map-notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ anchor: form.anchor.trim(), text: form.text.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setForm({ anchor: '', text: '', saving: false });
      await load();
    } catch (err) {
      setForm((f) => ({ ...f, saving: false }));
      setError(err.message || String(err));
    }
  }

  async function updateStatus(id, newStatus) {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/scout-map-notes', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, status: newStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await load();
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  return (
    <div>
      <div className="sc-section">
        <div className="sc-label">Review Notes</div>
        <div style={{ fontSize: 13, color: 'rgba(42,36,32,0.7)', marginBottom: 12 }}>
          Admin-only annotations on the scout data map + card contract. Notes persist to
          <code style={{ padding: '1px 6px', background: 'rgba(42,36,32,0.06)', borderRadius: 4, marginLeft: 6 }}>docs/scout-data-map.notes.json</code>
          {' '}so the assistant can read every open note in one file read.
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['open', 'addressed', 'dismissed', 'all'].map((s) => (
            <button
              key={s}
              type="button"
              className={`sc-tab${filter === s ? ' is-active' : ''}`}
              onClick={() => setFilter(s)}
            >{s}</button>
          ))}
        </div>
      </div>

      {writeAllowed && (
        <form className="sc-note-form" onSubmit={submit}>
          <div style={{ fontFamily: '"Space Mono", monospace', fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgba(42,36,32,0.55)' }}>
            New Note
          </div>
          <input
            type="text"
            placeholder="anchor (e.g. card:brand-identity-design.missing-state.no-favicon)"
            value={form.anchor}
            onChange={(e) => setForm((f) => ({ ...f, anchor: e.target.value }))}
          />
          <textarea
            placeholder="note text (max 2000 chars)"
            value={form.text}
            onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
            maxLength={2000}
          />
          <button type="submit" disabled={form.saving || !form.anchor.trim() || !form.text.trim()}>
            {form.saving ? 'Saving…' : 'Add Note'}
          </button>
        </form>
      )}

      {status === 'loading' && <div style={{ padding: 12 }}>Loading notes…</div>}
      {status === 'error' && (
        <div className="sc-stale">
          <div>Error: {error}</div>
          {diagnostic && (
            <pre style={{ marginTop: 10, padding: 10, background: 'rgba(42,36,32,0.04)', border: '1px solid rgba(42,36,32,0.1)', borderRadius: 8, fontSize: 11, fontFamily: '"Space Mono", monospace', color: '#2a2420', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(diagnostic, null, 2)}
            </pre>
          )}
        </div>
      )}

      {status === 'ready' && notes.length === 0 && (
        <div className="sc-section">
          <span className="sc-empty">No {filter === 'all' ? '' : filter + ' '}notes yet.</span>
        </div>
      )}

      {status === 'ready' && notes.map((n) => (
        <div key={n.id} className="sc-note">
          <div className="sc-note-meta">
            <span className={`sc-note-status ${n.status}`}>{n.status}</span>
            <span>{n.author}</span>
            <span>{n.createdAt?.slice(0, 19).replace('T', ' ')}</span>
            <span className="sc-note-anchor">{n.anchor}</span>
          </div>
          <div className="sc-note-text">{n.text}</div>
          {writeAllowed && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {n.status !== 'addressed' && (
                <button type="button" className="sc-tab" onClick={() => updateStatus(n.id, 'addressed')}>Mark addressed</button>
              )}
              {n.status !== 'dismissed' && (
                <button type="button" className="sc-tab" onClick={() => updateStatus(n.id, 'dismissed')}>Dismiss</button>
              )}
              {n.status !== 'open' && (
                <button type="button" className="sc-tab" onClick={() => updateStatus(n.id, 'open')}>Reopen</button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const pageStyle = {
  minHeight: '100dvh',
  background:
    'radial-gradient(600px 380px at 0% 6%, rgba(255,120,90,0.18) 0%, transparent 65%), radial-gradient(520px 340px at 100% 14%, rgba(176,90,255,0.14) 0%, transparent 65%), linear-gradient(180deg, #fefdf9 0%, #fbf8f0 50%, #fdfaf2 100%)',
  padding: 24,
};
