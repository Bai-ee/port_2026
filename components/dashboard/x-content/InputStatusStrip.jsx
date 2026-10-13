'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { workerHealthLine } from '../../../features/x-strategy/ui-model.js';

// Input status for Content Management: what the daily runner and the chat are working from, each with source,
// age, and a direct fix. Data = the shared server context (`content-context` action); nothing is computed here
// except the label. Honest about what the app cannot see: it has NO heartbeat from the local refresh/scan worker.

const ORDER = ['brain', 'plan', 'corpora', 'scan', 'queue'];
const LABEL = { brain: 'Brain', plan: 'Strategy plan', corpora: 'Account data', scan: 'Scan', queue: 'Posting queue' };

function fix(input, { onOpenStrategy }) {
  if (input.usable && !input.caveats.some((c) => /stale|No saved plan|failed to load/i.test(c))) return null;
  switch (input.id) {
    case 'brain': return { text: 'Approve the Client Brain in the Client Brain card (Brain tab), then regenerate. Until then drafts use a plain, unapproved voice.' };
    case 'plan': return { text: 'Save a plan in Strategy so cadence, floors and caps are explicit.', action: onOpenStrategy, actionLabel: 'Open Strategy' };
    case 'corpora': return { text: 'Refresh the handles in Strategy (needs the local refresh worker).', action: onOpenStrategy, actionLabel: 'Open Strategy' };
    case 'queue': return { text: 'Reload in a minute. Recommendations stay paused so they cannot conflict with scheduled posts.' };
    case 'scan': return { text: 'Run the local quote scan on the Mac that holds the browser cookies (see Setup). The app cannot start it.' };
    default: return null;
  }
}

// Standalone mount: <InputStatusStrip clientId call onNavigate /> ('strategy' target replaces onOpenStrategy).
export default function InputStatusStrip({ call, clientKey: clientKeyProp, clientId, onOpenStrategy: onOpenStrategyProp, onNavigate, defaultOpen = true, hideRefresh = false }) {
  const clientKey = clientKeyProp ?? clientId;
  const onOpenStrategy = onOpenStrategyProp || (() => onNavigate?.('strategy'));
  const [inputs, setInputs] = useState(null);
  const [workerLine, setWorkerLine] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Open by default only where it matters (Today); the operator's own toggle always wins. On Queue & Calendar it starts
  // collapsed so the calendar is the first thing on screen.
  const [userOpen, setUserOpen] = useState(null);
  const keyRef = useRef(clientKey);
  keyRef.current = clientKey;

  const load = useCallback(async () => {
    const startedFor = keyRef.current;
    setLoading(true);
    setError('');
    try {
      const res = await call('content-context');
      if (keyRef.current !== startedFor) return; // client switched while loading: drop the late response
      setInputs(res?.context?.inputs || []);
      // Heartbeat is best-effort: any failure keeps the 'status unknown' fallback.
      let line = null;
      try { line = workerHealthLine((await call('strategy-refresh-status', { clientId: startedFor, workerOnly: true }))?.workerHealth); } catch { line = null; }
      if (keyRef.current === startedFor) setWorkerLine(line);
    } catch (err) {
      if (keyRef.current === startedFor) setError(err.message || 'Could not read input status.');
    } finally {
      if (keyRef.current === startedFor) setLoading(false);
    }
  }, [call]);

  useEffect(() => { setInputs(null); setWorkerLine(null); load(); }, [clientKey, load]);

  const rows = (inputs || []).filter((i) => ORDER.includes(i.id)).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
  const attention = rows.filter((i) => !i.usable || i.caveats.some((c) => /stale|No saved plan|failed to load/i.test(c)));

  return (
    <details id="x-content-input-status-strip" className="xce-is" open={userOpen ?? (defaultOpen && attention.length > 0)} onToggle={(e) => { if (e.currentTarget.open !== (userOpen ?? (defaultOpen && attention.length > 0))) setUserOpen(e.currentTarget.open); }}>
      <summary id="x-content-input-status-summary" className="xce-is-summary">
        <span className="xce-is-title">Inputs</span>
        {error ? <span className="xce-is-bad">status unavailable</span>
          : inputs == null ? <span className="xce-is-muted">checking…</span>
            : <span className={attention.length ? 'xce-is-warn' : 'xce-is-ok'}>{attention.length ? `${attention.length} need attention` : 'all current'}</span>}
        {!hideRefresh ? (
          <button id="x-content-input-status-refresh" type="button" className="xce-is-refresh" aria-label="Re-check inputs" disabled={loading} onClick={(e) => { e.preventDefault(); load(); }}>
            <RefreshCw size={12} />
          </button>
        ) : null}
      </summary>
      <ul id="x-content-input-status-list" className="xce-is-list">
        {error ? <li className="xce-is-bad">{error}</li> : null}
        {rows.map((i) => {
          const f = fix(i, { onOpenStrategy });
          const ok = !f;
          return (
            <li key={i.id} id={`x-content-input-status-${i.id}`} className={`xce-is-item ${ok ? 'xce-is-item-ok' : 'xce-is-item-warn'}`}>
              <div className="xce-is-head">
                <strong>{LABEL[i.id]}</strong>
                <span className={ok ? 'xce-is-ok' : 'xce-is-warn'}>{ok ? 'ok' : i.usable ? 'check' : 'not usable'}</span>
                <span className="xce-is-muted">{i.asOf ? `as of ${i.asOf.slice(0, 16).replace('T', ' ')}Z` : 'no date'} · {i.source}</span>
              </div>
              {i.caveats.map((c) => <p key={c} className="xce-is-caveat">{c}</p>)}
              {f ? (
                <p className="xce-is-fix">
                  {f.text}{' '}
                  {f.action ? <button type="button" className="xce-btn-ghost" onClick={f.action}>{f.actionLabel}</button> : null}
                </p>
              ) : null}
            </li>
          );
        })}
        <li id="x-content-input-status-worker" className="xce-is-item xce-is-item-warn">
          <div className="xce-is-head">
            <strong>Refresh worker</strong>
            <span id="x-content-input-status-worker-state" className="xce-is-warn">{workerLine || 'status unknown'}</span>
          </div>
          <p className="xce-is-caveat">{workerLine ? 'Based on the worker’s last check-in. A refresh you request shows “queued” until the worker picks it up.' : 'The app has no heartbeat from the local refresh/scan worker. A refresh you request shows “queued” until the worker finishes it; if it stays queued, the worker is not running.'}</p>
        </li>
      </ul>
      <details id="x-content-input-status-setup" className="xce-is-setup">
        <summary className="xce-is-muted">Setup &amp; help (local worker, publishing)</summary>
        <p className="xce-is-caveat">Quote scan (daily, needs this Mac&apos;s browser cookies): <code>scripts/x-content/install-scan-schedule.sh install &lt;clientId&gt;</code>. Strategy refresh: <code>node scripts/x-content/strategy-refresh-worker.mjs --once</code>. Scheduled posts publish through the daily cron and, only if enabled, the GitHub publish sweep. Full runbook: docs/source-of-truth/CONTENT-MANAGEMENT.md.</p>
      </details>
    </details>
  );
}
