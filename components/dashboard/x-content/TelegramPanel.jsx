'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../../../firebase';
import Card from '../content-ui/ui/Card.jsx';
import { XCE_COLORS, XCE_RADII, XCE_TYPE } from '../content-ui/xce-tokens';

// TelegramPanel — connect/disconnect the owner's Telegram account and edit notification settings.
//
// PROPS
//   getIdToken     async () => Firebase ID token string (same prop XContentEngineCard receives).
//   activeClientId string, optional; sent as `clientId` with every request (server may ignore it).
//
// Talks to GET|POST /api/dashboard/telegram (see docs/plans/TELEGRAM-COMMAND-CENTER-CONTRACTS.md, Routes).
// Linking completes ONLY here: the bot `/start <code>` just attaches a pending challenge.
// STYLING: inline styles from xce-tokens, mobile-first (no large horizontal padding).

const ENDPOINT = '/api/dashboard/telegram';
const POLL_MS = 4000;
const POLL_MAX_MS = 10 * 60 * 1000;

const ZONES = [
  'America/Chicago', 'America/New_York', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Mexico_City', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Athens', 'Africa/Johannesburg',
  'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney',
  'Pacific/Auckland', 'UTC',
];

const HOW_IT_WORKS = [
  ["What's happening?", 'A read-only summary of the latest brief, conversations and what needs review.'],
  ["Today's posts", 'Each post with its status: proposed, approved, scheduled, manual or posted.'],
  ['Calendar', 'The coming week, with gaps against your daily target.'],
  ['Upload content', 'Send media to the bot to add it to your content library.'],
  ['Settings', 'Quick toggles in the bot; full settings live on this page.'],
];

const S = {
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  h: { ...XCE_TYPE.label, margin: 0, color: XCE_COLORS.ink },
  p: { margin: 0, fontSize: 13, lineHeight: 1.5, color: XCE_COLORS.inkSoft },
  row: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0 },
  btn: { minHeight: 40, padding: '0 14px', borderRadius: XCE_RADII.sm, border: `1px solid ${XCE_COLORS.borderStrong}`, background: XCE_COLORS.surface, color: XCE_COLORS.ink, fontSize: 13, fontWeight: 600, cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' },
  btnPrimary: { background: XCE_COLORS.ink, color: XCE_COLORS.onInk, borderColor: XCE_COLORS.ink },
  btnDanger: { color: XCE_COLORS.red, borderColor: XCE_COLORS.redBorder },
  field: { display: 'grid', gap: 4, fontSize: 13, color: XCE_COLORS.ink, minWidth: 0 },
  input: { minHeight: 40, padding: '0 10px', borderRadius: XCE_RADII.sm, border: `1px solid ${XCE_COLORS.borderStrong}`, fontSize: 14, background: XCE_COLORS.surface, color: XCE_COLORS.ink, minWidth: 0, width: '100%', boxSizing: 'border-box' },
  check: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: XCE_COLORS.ink, minHeight: 32 },
  grid: { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' },
};

const toneStyle = (tone) => {
  const map = {
    green: [XCE_COLORS.greenBg, XCE_COLORS.greenBorder, XCE_COLORS.green],
    amber: [XCE_COLORS.amberBg, XCE_COLORS.amberBorder, XCE_COLORS.amber],
    blue: [XCE_COLORS.blueBg, XCE_COLORS.blueBorder, XCE_COLORS.blue],
    red: [XCE_COLORS.redBg, XCE_COLORS.redBorder, XCE_COLORS.red],
    grey: [XCE_COLORS.greyBg, XCE_COLORS.greyBorder, XCE_COLORS.inkSoft],
  }[tone] || [];
  return { background: map[0], border: `1px solid ${map[1]}`, color: map[2] };
};

function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(typeof iso === 'object' && iso.seconds ? iso.seconds * 1000 : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

// Standalone mount: <TelegramPanel clientId={...} /> (getIdToken falls back to the signed-in Firebase user; onNavigate unused).
const authTokenFallback = async () => (auth?.currentUser ? auth.currentUser.getIdToken() : null);

export default function TelegramPanel({ getIdToken: getIdTokenProp, activeClientId: activeClientIdProp, clientId, onNavigate: _onNavigate }) {
  const getIdToken = getIdTokenProp || authTokenFallback;
  const activeClientId = activeClientIdProp || clientId;
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const [link, setLink] = useState(null); // { deepLink, expiresAt }
  const [now, setNow] = useState(() => Date.now());
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [form, setForm] = useState(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveError, setSaveError] = useState('');
  const pollStartRef = useRef(0);

  const request = useCallback(async (method, body) => {
    const token = getIdToken ? await getIdToken() : null;
    const qs = method === 'GET' && activeClientId ? `?clientId=${encodeURIComponent(activeClientId)}` : '';
    const res = await fetch(`${ENDPOINT}${qs}`, {
      method,
      cache: 'no-store',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify({ ...(activeClientId ? { clientId: activeClientId } : {}), ...body }) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || `Request failed (${res.status}).`);
    return data;
  }, [getIdToken, activeClientId]);

  const refresh = useCallback(async () => {
    try {
      const data = await request('GET');
      setState(data);
      setLoadError('');
      return data;
    } catch (err) {
      setLoadError(err.message || 'Could not load Telegram status.');
      return null;
    }
  }, [request]);

  useEffect(() => { setState(null); setForm(null); setLink(null); refresh(); }, [refresh]);

  // Seed the form once from the server settings; re-seed only after a save/refresh replaces them.
  useEffect(() => {
    if (state?.settings && !form) setForm({ ...state.settings, quietHours: { enabled: false, start: 22, end: 7, ...(state.settings.quietHours || {}) } });
  }, [state, form]);

  const status = !state ? 'loading'
    : !state.configured ? 'unconfigured'
      : state.binding?.status === 'linked' || state.binding?.status === 'active' ? 'linked'
        : state.pending ? 'pending'
          : 'unlinked';

  // Poll while a link is open (or a pending confirmation is awaited), max 10 minutes.
  const polling = !!link && status !== 'linked';
  useEffect(() => {
    if (!polling) return undefined;
    pollStartRef.current = pollStartRef.current || Date.now();
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - pollStartRef.current > POLL_MAX_MS) { setLink(null); pollStartRef.current = 0; return; }
      refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [polling, refresh]);

  useEffect(() => {
    if (!link) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [link]);

  const run = async (name, fn) => {
    setBusy(name);
    setActionError('');
    try { await fn(); } catch (err) { setActionError(err.message || 'Action failed.'); } finally { setBusy(''); }
  };

  const startLink = () => run('start', async () => {
    const res = await request('POST', { action: 'link-start' });
    pollStartRef.current = Date.now();
    setLink({ deepLink: res.deepLink, expiresAt: res.expiresAt });
    setNow(Date.now());
  });
  const confirmLink = () => run('confirm', async () => {
    await request('POST', { action: 'link-confirm' });
    setLink(null);
    pollStartRef.current = 0;
    await refresh();
  });
  const unlink = () => run('unlink', async () => {
    await request('POST', { action: 'unlink' });
    setConfirmUnlink(false);
    setLink(null);
    await refresh();
  });
  const saveSettings = async () => {
    setBusy('save'); setSaveError(''); setSaveMsg('');
    try {
      const res = await request('POST', { action: 'save-settings', settings: form });
      setSaveMsg('Settings saved.');
      if (res?.settings) setForm({ ...res.settings, quietHours: { enabled: false, start: 22, end: 7, ...(res.settings.quietHours || {}) } });
    } catch (err) { setSaveError(err.message || 'Could not save settings.'); } finally { setBusy(''); }
  };

  const set = (patch) => { setSaveMsg(''); setForm((f) => ({ ...f, ...patch })); };
  const setQuiet = (patch) => set({ quietHours: { ...form.quietHours, ...patch } });

  const zones = useMemo(() => {
    const cur = form?.timezone;
    return cur && !ZONES.includes(cur) ? [cur, ...ZONES] : ZONES;
  }, [form?.timezone]);

  const expiresMs = link?.expiresAt ? new Date(link.expiresAt).getTime() - now : 0;
  const expired = !!link && expiresMs <= 0;

  const badge = {
    loading: ['grey', 'Checking…'],
    unconfigured: ['amber', 'Not configured'],
    unlinked: ['grey', 'Not linked'],
    pending: ['blue', 'Pending confirmation'],
    linked: ['green', `Linked${state?.binding?.telegramUsername ? ` as @${state.binding.telegramUsername}` : ''}`],
  }[status];

  return (
    <div id="telegram-connect-panel" style={S.stack}>
      <Card id="telegram-link-status-card">
        <div style={S.stack}>
          <div id="telegram-link-status-row" style={{ ...S.row, justifyContent: 'space-between' }}>
            <h3 style={S.h}>Telegram</h3>
            <span id="telegram-link-status-badge" style={{ ...toneStyle(badge[0]), borderRadius: XCE_RADII.pill, padding: '3px 10px', fontSize: 12, fontWeight: 600 }}>{badge[1]}</span>
          </div>

          {loadError ? <p id="telegram-load-error" role="alert" style={{ ...S.p, color: XCE_COLORS.red }}>{loadError}</p> : null}

          {status === 'unconfigured' ? (
            <p id="telegram-unconfigured-note" style={S.p}>
              Bot not activated yet. The owner must create the bot and set TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME and TELEGRAM_WEBHOOK_SECRET.
            </p>
          ) : null}

          {status === 'linked' ? (
            <div id="telegram-linked-content" style={S.stack}>
              <p style={S.p}>
                Linked{state.binding.telegramUsername ? ` as @${state.binding.telegramUsername}` : ''}
                {state.binding.linkedAt ? ` on ${fmtDate(state.binding.linkedAt)}` : ''}.
              </p>
              {confirmUnlink ? (
                <div id="telegram-unlink-confirm-row" style={S.row}>
                  <span style={S.p}>Disconnect Telegram? The bot will stop sending you anything.</span>
                  <button type="button" id="telegram-unlink-confirm-button" style={{ ...S.btn, ...S.btnDanger }} disabled={busy === 'unlink'} onClick={unlink}>Yes, disconnect</button>
                  <button type="button" id="telegram-unlink-cancel-button" style={S.btn} onClick={() => setConfirmUnlink(false)}>Cancel</button>
                </div>
              ) : (
                <div style={S.row}>
                  <button type="button" id="telegram-unlink-button" style={{ ...S.btn, ...S.btnDanger }} onClick={() => setConfirmUnlink(true)}>Disconnect</button>
                </div>
              )}
            </div>
          ) : null}

          {status === 'pending' ? (
            <div id="telegram-pending-confirm-row" style={S.stack}>
              <p style={S.p}>
                Confirm @{state.pending.telegramUsername || 'unknown'}
                {state.pending.firstName ? ` (${state.pending.firstName})` : ''} as your Telegram account?
                Only confirm if that is you.
              </p>
              <div style={S.row}>
                <button type="button" id="telegram-confirm-link-button" style={{ ...S.btn, ...S.btnPrimary }} disabled={busy === 'confirm'} onClick={confirmLink}>
                  Confirm @{state.pending.telegramUsername || 'account'}
                </button>
              </div>
            </div>
          ) : null}

          {(status === 'unlinked' || status === 'pending') ? (
            <div id="telegram-connect-content" style={S.stack}>
              {link && !expired ? (
                <div id="telegram-deep-link-row" style={S.row}>
                  <a id="telegram-open-bot-link" href={link.deepLink} target="_blank" rel="noopener noreferrer" style={{ ...S.btn, ...S.btnPrimary }}>Open bot</a>
                  <span id="telegram-link-countdown" style={{ ...S.p, fontVariantNumeric: 'tabular-nums' }}>
                    Expires in {fmtCountdown(expiresMs)}{status === 'unlinked' ? ' · waiting for you to press Start…' : ''}
                  </span>
                </div>
              ) : (
                <div style={S.row}>
                  <button type="button" id="telegram-connect-button" style={{ ...S.btn, ...S.btnPrimary }} disabled={busy === 'start'} onClick={startLink}>
                    {expired ? 'Link expired — connect again' : 'Connect Telegram'}
                  </button>
                </div>
              )}
              <p id="telegram-link-explainer" style={S.p}>
                The link works only once and expires in 10 minutes. Pressing Start in Telegram only attaches a request; linking completes here, when you confirm.
              </p>
            </div>
          ) : null}

          {actionError ? <p id="telegram-action-error" role="alert" style={{ ...S.p, color: XCE_COLORS.red }}>{actionError}</p> : null}
        </div>
      </Card>

      {form && status !== 'unconfigured' ? (
        <Card id="telegram-settings-card">
          <form id="telegram-settings-form" style={S.stack} onSubmit={(e) => { e.preventDefault(); saveSettings(); }}>
            <h3 style={S.h}>Notification settings</h3>
            <div id="telegram-settings-basics-row" style={S.grid}>
              <label style={S.field}>Timezone
                <select id="telegram-timezone-select" style={S.input} value={form.timezone || ''} onChange={(e) => set({ timezone: e.target.value })}>
                  {zones.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </label>
              <label style={S.field}>Review lead time (minutes)
                <input id="telegram-lead-minutes-input" type="number" min={0} max={240} style={S.input} value={form.leadMinutes ?? ''} onChange={(e) => set({ leadMinutes: e.target.value === '' ? '' : Number(e.target.value) })} />
              </label>
            </div>

            <div id="telegram-briefing-row" style={S.row}>
              <label style={S.check}><input id="telegram-briefing-enabled-checkbox" type="checkbox" checked={!!form.briefingEnabled} onChange={(e) => set({ briefingEnabled: e.target.checked })} /> Daily briefing</label>
              <select id="telegram-briefing-hour-select" aria-label="Briefing hour" style={{ ...S.input, width: 'auto' }} disabled={!form.briefingEnabled} value={form.briefingHour ?? 8} onChange={(e) => set({ briefingHour: Number(e.target.value) })}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>

            <div id="telegram-quiet-hours-row" style={S.row}>
              <label style={S.check}><input id="telegram-quiet-enabled-checkbox" type="checkbox" checked={!!form.quietHours.enabled} onChange={(e) => setQuiet({ enabled: e.target.checked })} /> Quiet hours</label>
              <select id="telegram-quiet-start-select" aria-label="Quiet hours start" style={{ ...S.input, width: 'auto' }} disabled={!form.quietHours.enabled} value={form.quietHours.start} onChange={(e) => setQuiet({ start: Number(e.target.value) })}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
              <span style={S.p}>to</span>
              <select id="telegram-quiet-end-select" aria-label="Quiet hours end" style={{ ...S.input, width: 'auto' }} disabled={!form.quietHours.enabled} value={form.quietHours.end} onChange={(e) => setQuiet({ end: Number(e.target.value) })}>
                {HOURS.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>

            <div id="telegram-toggles-row" style={{ display: 'grid', gap: 2 }}>
              <label style={S.check}><input id="telegram-paused-checkbox" type="checkbox" checked={!!form.notificationsPaused} onChange={(e) => set({ notificationsPaused: e.target.checked })} /> Pause notifications</label>
              <label style={S.check}><input id="telegram-slot-alerts-checkbox" type="checkbox" checked={!!form.slotAlerts} onChange={(e) => set({ slotAlerts: e.target.checked })} /> Time-to-post alerts (empty posting slots, with media)</label>
              <label style={S.check}><input id="telegram-notify-failures-checkbox" type="checkbox" checked={!!form.notifyFailures} onChange={(e) => set({ notifyFailures: e.target.checked })} /> Actionable failure alerts</label>
              <label style={S.check}><input id="telegram-notify-success-checkbox" type="checkbox" checked={!!form.notifySuccessSummary} onChange={(e) => set({ notifySuccessSummary: e.target.checked })} /> Grouped success summary</label>
            </div>

            <p id="telegram-quiet-hours-note" style={S.p}>Quiet hours and pausing only affect Telegram notifications — they never move or cancel scheduled posts.</p>

            <div id="telegram-save-row" style={S.row}>
              <button type="submit" id="telegram-save-settings-button" style={{ ...S.btn, ...S.btnPrimary }} disabled={busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button>
              {saveMsg ? <span id="telegram-save-ok" role="status" style={{ ...S.p, color: XCE_COLORS.green }}>{saveMsg}</span> : null}
            </div>
            {saveError ? <p id="telegram-save-error" role="alert" style={{ ...S.p, color: XCE_COLORS.red }}>{saveError}</p> : null}
          </form>
        </Card>
      ) : null}

      <Card id="telegram-how-it-works-card">
        <div style={S.stack}>
          <h3 style={S.h}>How it works</h3>
          <ul id="telegram-how-it-works-list" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 13, lineHeight: 1.5, color: XCE_COLORS.inkSoft }}>
            {HOW_IT_WORKS.map(([k, v]) => <li key={k}><strong style={{ color: XCE_COLORS.ink }}>{k}</strong> — {v}</li>)}
            <li>Manual handoff is the default: the bot sends you the post when it is due and you post it yourself.</li>
            <li><strong style={{ color: XCE_COLORS.ink }}>Post myself</strong> removes the post from automatic publishing.</li>
            <li><strong style={{ color: XCE_COLORS.ink }}>I&apos;ve posted it</strong> records that you posted it (self-reported; optionally add the link).</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}
