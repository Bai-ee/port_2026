'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AtSign, Bookmark, BookmarkX, Check, Copy, FilePlus2, Gauge, Heart, HeartOff,
  Link2, MessageCircle, Pin, RefreshCw, Repeat2, ShieldCheck, Trash2, Unplug,
  UserMinus, UserPlus, UserRound,
} from 'lucide-react';

// X Command Center — admin control surface for the live @bai_ee account over
// OAuth 2.0 user-context (features/social-posting/x-oauth.js). Panels:
// connection, usage meter, bookmarks→content workspace, profile editor,
// per-tweet engagement, audience ops. EVERY metered action is spend-gated:
// the button arms a confirm row that names the exact call count first
// (docs/source-of-truth/X-API-AND-PROFILE-OPERATIONS.md §0 — X spend is
// invisible to the Operating Cost card).
//
// The <style jsx> tag must sit INLINE in the returned JSX (not behind a
// variable) or the compiler skips its scoping pass and the card renders bare.

const POLL_INTERVAL_MS = 4000;
const POLL_MAX_TRIES = 30;

function formatWhen(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function parseTweetId(value) {
  const m = String(value || '').match(/status(?:es)?\/(\d+)/);
  if (m) return m[1];
  const raw = String(value || '').trim();
  return /^\d{5,}$/.test(raw) ? raw : null;
}

export default function XProfileCard({ getIdToken }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);
  const [adminBlocked, setAdminBlocked] = useState(false);
  const [armed, setArmed] = useState(null); // which gated action is showing its confirm row
  const [verifyResult, setVerifyResult] = useState(null);
  const [copiedCallback, setCopiedCallback] = useState(false);

  const [usage, setUsage] = useState(null);
  const [bookmarks, setBookmarks] = useState({ items: [], nextToken: null, fetchedAt: null });
  const [bmNotice, setBmNotice] = useState(null);
  const [sentIds, setSentIds] = useState([]);

  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState(null);
  const [profileNotice, setProfileNotice] = useState(null);

  const [tweetRef, setTweetRef] = useState('');
  const [replyText, setReplyText] = useState('');
  const [engageNotice, setEngageNotice] = useState(null);

  const [handle, setHandle] = useState('');
  const [audienceNotice, setAudienceNotice] = useState(null);

  const pollRef = useRef(null);
  const tweetId = parseTweetId(tweetRef);

  const apiFetch = useCallback(async (body = null) => {
    const token = await getIdToken();
    const options = body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(body),
        }
      : { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' };
    const res = await fetch('/api/social-posting/x-oauth', options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }, [getIdToken]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadStatus = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch();
      setStatus(data);
      setAdminBlocked(false);
      return data;
    } catch (err) {
      if (err.status === 403) setAdminBlocked(true);
      else if (!silent) setNotice({ kind: 'error', text: err.message });
      return null;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    (async () => {
      const data = await loadStatus();
      if (data?.connected) {
        // Cached bookmark browsing is free — no API call.
        try {
          const cached = await apiFetch({ action: 'bookmarks-cached' });
          setBookmarks(cached.bookmarks || { items: [] });
        } catch { /* non-fatal */ }
      }
    })();
    return stopPolling;
  }, [loadStatus, apiFetch, stopPolling]);

  const beginConnectPolling = useCallback(() => {
    stopPolling();
    let tries = 0;
    pollRef.current = setInterval(async () => {
      tries += 1;
      const data = await loadStatus({ silent: true });
      if (data?.connected || tries >= POLL_MAX_TRIES) {
        stopPolling();
        if (data?.connected) setNotice({ kind: 'ok', text: `Connected as @${data.username}.` });
      }
    }, POLL_INTERVAL_MS);
  }, [loadStatus, stopPolling]);

  // One runner for every gated action: fires the route action, routes the
  // result + errors to the right panel notice, disarms the confirm row.
  async function runGated(key, body, { onOk, setPanelNotice }) {
    if (busy) return;
    setBusy(key);
    if (setPanelNotice) setPanelNotice(null);
    try {
      const data = await apiFetch(body);
      onOk?.(data);
    } catch (err) {
      (setPanelNotice || setNotice)({ kind: 'error', text: err.message });
    } finally {
      setBusy('');
      setArmed(null);
    }
  }

  async function connect() {
    if (busy) return;
    setBusy('connect');
    setNotice(null);
    try {
      const data = await apiFetch({ action: 'start' });
      window.open(data.url, '_blank', 'noopener');
      setNotice({ kind: 'ok', text: 'Authorize in the X tab that just opened — this card updates itself when the callback lands.' });
      beginConnectPolling();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy('');
    }
  }

  function copyCallbackUrl() {
    if (!status?.callbackUrl) return;
    navigator.clipboard?.writeText(status.callbackUrl).then(() => {
      setCopiedCallback(true);
      setTimeout(() => setCopiedCallback(false), 1600);
    });
  }

  function editProfileField(key, value) {
    setProfileForm((prev) => ({ ...(prev || {}), [key]: value }));
  }

  const configReady = Boolean(status?.config?.hasClientId && status?.config?.hasClientSecret);
  const connected = Boolean(status?.connected);
  const spinner = <span className="comet-spinner" style={{ width: 14, height: 14, ['--comet-ring']: '2px' }} aria-hidden="true" />;

  // Arms a confirm row for a gated action. cost = human sentence naming the
  // exact call count + consequence; run = () => runGated(...).
  const gate = (key, { label, icon, cost, run, primary = false, disabled = false }) => (
    armed === key ? (
      <span className="xp-gate-row" key={key}>
        <span className="xp-gate-cost">{cost}</span>
        <button type="button" className="xp-primary" onClick={run} disabled={!!busy}>
          {busy === key ? spinner : <ShieldCheck size={13} />} Confirm
        </button>
        <button type="button" onClick={() => setArmed(null)} disabled={!!busy}>Cancel</button>
      </span>
    ) : (
      <button type="button" key={key} className={primary ? 'xp-primary' : ''} onClick={() => setArmed(key)} disabled={!!busy || disabled}>
        {icon} {label}
      </button>
    )
  );

  const usagePct = usage?.project_cap ? Math.min(100, Math.round((Number(usage.project_usage || 0) / Number(usage.project_cap)) * 100)) : 0;

  return (
    <div id="x-profile-card">
      {adminBlocked ? (
        <section id="x-profile-admin-gate-panel" className="xp-panel">
          <div className="xp-head"><span className="xp-kicker">X Command Center</span></div>
          <div className="xp-empty">Admin only — this card manages the live @bai_ee X account.</div>
        </section>
      ) : (
        <>
          {/* ── Connection ─────────────────────────────────────────── */}
          <section id="x-profile-connection-panel" className="xp-panel">
            <div className="xp-head">
              <span className="xp-kicker"><Link2 size={13} /> Connection</span>
              <small>{connected ? 'OAUTH 2.0 · LIVE ACCOUNT' : 'OAUTH 2.0 · PKCE'}</small>
            </div>
            {loading ? (
              <div className="xp-empty">Checking connection…</div>
            ) : connected ? (
              <>
                <p className="xp-sub">
                  Connected as <strong>@{status.username}</strong>
                  {status.expiresAt ? <> · token refreshes automatically (current one expires {formatWhen(status.expiresAt)})</> : null}
                </p>
                <div className="xp-tags" style={{ marginBottom: 10 }}>
                  {(status.scope || []).map((s) => <span key={s} className="xp-chip xp-chip-muted">{s}</span>)}
                </div>
                <div className="xp-actions">
                  <button type="button" onClick={() => loadStatus()} disabled={!!busy}>
                    <RefreshCw size={14} /> Refresh
                  </button>
                  {gate('verify', {
                    label: 'Verify bookmark access', icon: <ShieldCheck size={14} />,
                    cost: '1–2 metered API calls to prove bookmark reads work.',
                    run: () => runGated('verify', { action: 'verify-bookmarks' }, {
                      onOk: (d) => setVerifyResult({ ok: true, ...d.result }),
                      setPanelNotice: setNotice,
                    }),
                  })}
                  {gate('disconnect', {
                    label: 'Disconnect', icon: <Unplug size={14} />,
                    cost: 'Free. Deletes + revokes the stored tokens; reconnect any time.',
                    run: () => runGated('disconnect', { action: 'disconnect' }, {
                      onOk: () => { setVerifyResult(null); loadStatus(); setNotice({ kind: 'ok', text: 'Disconnected — stored tokens deleted and revoked.' }); },
                      setPanelNotice: setNotice,
                    }),
                  })}
                </div>
              </>
            ) : (
              <>
                <p className="xp-sub">
                  Link the <strong>@bai_ee</strong> account with OAuth 2.0 user-context. Bookmarks and the panels below need this —
                  the existing OAuth 1.0a posting keys cannot reach them. Connecting is free; no credit-metered calls run without a confirm.
                </p>
                <div className="xp-actions">
                  <button type="button" className="xp-primary" onClick={connect} disabled={!!busy || !configReady}>
                    {busy === 'connect' ? spinner : <Link2 size={14} />} Connect X account
                  </button>
                  <button type="button" onClick={() => loadStatus()} disabled={!!busy}>
                    <RefreshCw size={14} /> Refresh status
                  </button>
                </div>
                {!configReady ? <p className="xp-error">Server is missing the OAuth 2.0 app credentials — finish the setup steps below first.</p> : null}
              </>
            )}
            {verifyResult ? (
              verifyResult.ok ? (
                <p className="xp-notice xp-notice-ok">Bookmarks reachable as @{verifyResult.username} — API returned {verifyResult.resultCount} item{verifyResult.resultCount === 1 ? '' : 's'}.</p>
              ) : <p className="xp-notice xp-notice-error">{verifyResult.message}</p>
            ) : null}
            {notice ? <p className={`xp-notice xp-notice-${notice.kind}`}>{notice.text}</p> : null}
          </section>

          {/* ── Usage meter ────────────────────────────────────────── */}
          <section id="x-profile-usage-panel" className="xp-panel">
            <div className="xp-head">
              <span className="xp-kicker"><Gauge size={13} /> API usage</span>
              <small>READ-ONLY METER</small>
            </div>
            <p className="xp-sub">
              Monthly request meter for the whole HitLoop app (all keys combined) against the project cap — the same numbers as
              the developer-console Usage page. <strong>Dollar</strong> spend has no API; it stays on console.x.com.
            </p>
            {usage ? (
              <>
                <div className="xp-usage-row">
                  <span className="xp-usage-num">{Number(usage.project_usage || 0).toLocaleString()}</span>
                  <span className="xp-usage-cap">/ {Number(usage.project_cap || 0).toLocaleString()} requests · resets day {usage.cap_reset_day} · checked {formatWhen(usage.checkedAt)}</span>
                </div>
                <div className="xp-bar"><span className="xp-bar-fill" style={{ width: `${Math.max(usagePct, 1)}%` }} /></div>
              </>
            ) : <p className="xp-muted">Not checked yet this session.</p>}
            <div className="xp-actions">
              {gate('usage', {
                label: usage ? 'Re-check usage' : 'Check usage', icon: <Gauge size={14} />,
                cost: '2 HTTP calls (free app-token mint + the usage meta endpoint).',
                run: () => runGated('usage', { action: 'usage' }, { onOk: (d) => setUsage(d.usage), setPanelNotice: setNotice }),
              })}
            </div>
          </section>

          {/* ── Bookmarks → content ────────────────────────────────── */}
          <section id="x-profile-bookmarks-panel" className="xp-panel">
            <div className="xp-head">
              <span className="xp-kicker"><Bookmark size={13} /> Bookmarks → content</span>
              <small>{bookmarks.fetchedAt ? `CACHED ${formatWhen(bookmarks.fetchedAt)}` : 'NOT FETCHED'}</small>
            </div>
            <p className="xp-sub">
              Your private bookmarks, fetched once into a cache — browsing after that is <strong>free</strong>. <strong>Send to Copywriter</strong> copies
              one into the shared drafts queue (free) where you AI-enhance, score, schedule, or post it. <strong>Remove</strong> deletes the bookmark on X itself.
            </p>
            <div className="xp-actions">
              {gate('fetch', {
                label: bookmarks.items.length ? 'Refresh from X' : 'Fetch bookmarks', icon: <RefreshCw size={14} />, primary: !bookmarks.items.length,
                disabled: !connected,
                cost: '1 metered API call — pulls your 50 most recent bookmarks and replaces the cache.',
                run: () => runGated('fetch', { action: 'bookmarks-fetch' }, { onOk: (d) => setBookmarks(d.bookmarks), setPanelNotice: setBmNotice }),
              })}
              {bookmarks.nextToken ? gate('more', {
                label: 'Load older', icon: <FilePlus2 size={14} />,
                cost: '1 metered API call — appends the next 50 bookmarks to the cache.',
                run: () => runGated('more', { action: 'bookmarks-fetch', cursor: bookmarks.nextToken }, { onOk: (d) => setBookmarks(d.bookmarks), setPanelNotice: setBmNotice }),
              }) : null}
            </div>
            {bmNotice ? <p className={`xp-notice xp-notice-${bmNotice.kind}`}>{bmNotice.text}</p> : null}
            {bookmarks.items.length ? (
              <div className="xp-bm-stack">
                {bookmarks.items.map((b) => (
                  <article key={b.id} className="xp-bm">
                    <div className="xp-bm-head">
                      <span className="xp-bm-author">{b.authorUsername ? `@${b.authorUsername}` : 'unknown author'}</span>
                      <span className="xp-bm-when">{b.createdAt ? formatWhen(new Date(b.createdAt).getTime()) : ''}</span>
                    </div>
                    <p className="xp-bm-text">{b.text}</p>
                    <div className="xp-actions" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        onClick={() => runGated(`send:${b.id}`, { action: 'bookmark-to-draft', tweetId: b.id }, {
                          onOk: () => { setSentIds((p) => [...p, b.id]); setBmNotice({ kind: 'ok', text: 'Draft created — open Copywriter to enhance, score, and publish it.' }); },
                          setPanelNotice: setBmNotice,
                        })}
                        disabled={!!busy || sentIds.includes(b.id)}
                      >
                        {busy === `send:${b.id}` ? spinner : sentIds.includes(b.id) ? <Check size={13} /> : <FilePlus2 size={13} />}
                        {sentIds.includes(b.id) ? 'In drafts' : 'Send to Copywriter'}
                      </button>
                      {gate(`rm:${b.id}`, {
                        label: 'Remove', icon: <BookmarkX size={13} />,
                        cost: '1 metered call — deletes this bookmark from your X account (the tweet itself is untouched).',
                        run: () => runGated(`rm:${b.id}`, { action: 'bookmark-remove', tweetId: b.id }, { onOk: (d) => setBookmarks(d.bookmarks), setPanelNotice: setBmNotice }),
                      })}
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="xp-empty">{connected ? 'No bookmarks cached yet — run Fetch bookmarks (1 call).' : 'Connect the account first.'}</div>
            )}
          </section>

          {/* ── Profile ────────────────────────────────────────────── */}
          <section id="x-profile-profile-panel" className="xp-panel">
            <div className="xp-head">
              <span className="xp-kicker"><UserRound size={13} /> Profile</span>
              <small>LIVE PUBLIC PROFILE</small>
            </div>
            <p className="xp-sub">
              Snapshot of the public profile plus a field editor. <strong>Load</strong> is one read call. <strong>Apply</strong> writes the real
              @bai_ee profile immediately — it is public and there is no undo history.
            </p>
            <div className="xp-actions">
              {gate('profile-load', {
                label: profile ? 'Reload profile' : 'Load profile', icon: <UserRound size={14} />, primary: !profile, disabled: !connected,
                cost: '1 metered API call — reads bio, metrics, and profile fields.',
                run: () => runGated('profile-load', { action: 'profile-load' }, {
                  onOk: (d) => {
                    setProfile(d.profile);
                    setProfileForm({
                      name: d.profile?.name || '',
                      description: d.profile?.description || '',
                      location: d.profile?.location || '',
                      url: d.profile?.url || '',
                    });
                  },
                  setPanelNotice: setProfileNotice,
                }),
              })}
            </div>
            {profile ? (
              <>
                <div className="xp-tags" style={{ margin: '10px 0' }}>
                  <span className="xp-chip">{Number(profile.public_metrics?.followers_count || 0).toLocaleString()} followers</span>
                  <span className="xp-chip">{Number(profile.public_metrics?.following_count || 0).toLocaleString()} following</span>
                  <span className="xp-chip">{Number(profile.public_metrics?.tweet_count || 0).toLocaleString()} posts</span>
                  <span className="xp-chip xp-chip-muted">{Number(profile.public_metrics?.listed_count || 0).toLocaleString()} listed</span>
                </div>
                {profileForm ? (
                  <div className="xp-form">
                    <label><span>Name</span><input value={profileForm.name} onChange={(e) => editProfileField('name', e.target.value)} maxLength={50} /></label>
                    <label><span>Bio</span><textarea value={profileForm.description} onChange={(e) => editProfileField('description', e.target.value)} maxLength={160} rows={3} /></label>
                    <label><span>Location</span><input value={profileForm.location} onChange={(e) => editProfileField('location', e.target.value)} maxLength={30} /></label>
                    <label><span>Website</span><input value={profileForm.url} onChange={(e) => editProfileField('url', e.target.value)} /></label>
                    <div className="xp-actions">
                      {gate('profile-apply', {
                        label: 'Apply to live profile', icon: <ShieldCheck size={14} />, primary: true,
                        cost: '1 metered call — overwrites the PUBLIC @bai_ee profile fields immediately. No undo.',
                        run: () => runGated('profile-apply', { action: 'profile-update', fields: profileForm }, {
                          onOk: () => setProfileNotice({ kind: 'ok', text: 'Profile updated live. Reload to confirm the stored state.' }),
                          setPanelNotice: setProfileNotice,
                        }),
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            ) : <p className="xp-muted">Not loaded — profile reads are metered, so nothing loads automatically.</p>}
            {profileNotice ? <p className={`xp-notice xp-notice-${profileNotice.kind}`}>{profileNotice.text}</p> : null}
          </section>

          {/* ── Engagement ─────────────────────────────────────────── */}
          <section id="x-profile-engagement-panel" className="xp-panel">
            <div className="xp-head">
              <span className="xp-kicker"><Heart size={13} /> Engagement</span>
              <small>ACTS AS @BAI_EE</small>
            </div>
            <p className="xp-sub">
              Act on any tweet by URL or ID. Like / repost / bookmark are reversible (1 call each). <strong>Reply posts publicly</strong> and
              <strong> Delete removes one of your own tweets permanently</strong>. Pinning is not exposed by the API.
            </p>
            <div className="xp-form">
              <label>
                <span><Pin size={12} /> Tweet URL or ID</span>
                <input value={tweetRef} onChange={(e) => setTweetRef(e.target.value)} placeholder="https://x.com/…/status/1234567890 or 1234567890" />
              </label>
              {tweetRef && !tweetId ? <p className="xp-error">Cannot find a tweet ID in that — paste the full tweet URL or the numeric ID.</p> : null}
            </div>
            <div className="xp-actions">
              {gate('tw:like', { label: 'Like', icon: <Heart size={13} />, disabled: !tweetId || !connected, cost: '1 metered call — likes the tweet as @bai_ee (reversible with Unlike).', run: () => runGated('tw:like', { action: 'tweet-action', op: 'like', tweetId }, { onOk: () => setEngageNotice({ kind: 'ok', text: 'Liked.' }), setPanelNotice: setEngageNotice }) })}
              {gate('tw:unlike', { label: 'Unlike', icon: <HeartOff size={13} />, disabled: !tweetId || !connected, cost: '1 metered call — removes your like.', run: () => runGated('tw:unlike', { action: 'tweet-action', op: 'unlike', tweetId }, { onOk: () => setEngageNotice({ kind: 'ok', text: 'Unliked.' }), setPanelNotice: setEngageNotice }) })}
              {gate('tw:repost', { label: 'Repost', icon: <Repeat2 size={13} />, disabled: !tweetId || !connected, cost: '1 metered call — reposts publicly to your followers (reversible with Un-repost).', run: () => runGated('tw:repost', { action: 'tweet-action', op: 'repost', tweetId }, { onOk: () => setEngageNotice({ kind: 'ok', text: 'Reposted.' }), setPanelNotice: setEngageNotice }) })}
              {gate('tw:unrepost', { label: 'Un-repost', icon: <Repeat2 size={13} />, disabled: !tweetId || !connected, cost: '1 metered call — removes your repost.', run: () => runGated('tw:unrepost', { action: 'tweet-action', op: 'unrepost', tweetId }, { onOk: () => setEngageNotice({ kind: 'ok', text: 'Repost removed.' }), setPanelNotice: setEngageNotice }) })}
              {gate('tw:bookmark', { label: 'Bookmark', icon: <Bookmark size={13} />, disabled: !tweetId || !connected, cost: '1 metered call — adds the tweet to your private bookmarks.', run: () => runGated('tw:bookmark', { action: 'tweet-action', op: 'bookmark', tweetId }, { onOk: () => setEngageNotice({ kind: 'ok', text: 'Bookmarked — Refresh from X to see it in the list above.' }), setPanelNotice: setEngageNotice }) })}
              {gate('tw:delete', { label: 'Delete (own tweet)', icon: <Trash2 size={13} />, disabled: !tweetId || !connected, cost: '1 metered call — PERMANENTLY deletes this tweet. Only works on your own posts. No undo.', run: () => runGated('tw:delete', { action: 'tweet-action', op: 'delete', tweetId }, { onOk: () => setEngageNotice({ kind: 'ok', text: 'Deleted.' }), setPanelNotice: setEngageNotice }) })}
            </div>
            <div className="xp-form" style={{ marginTop: 10 }}>
              <label>
                <span><MessageCircle size={12} /> Reply text</span>
                <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={3} maxLength={280} placeholder="Reply as @bai_ee — posts publicly under the tweet above." />
              </label>
              <div className="xp-actions">
                {gate('tw:reply', {
                  label: `Reply (${replyText.length}/280)`, icon: <MessageCircle size={13} />, primary: true,
                  disabled: !tweetId || !connected || !replyText.trim(),
                  cost: '1 metered call — posts this reply PUBLICLY as @bai_ee. Deleting later costs another call.',
                  run: () => runGated('tw:reply', { action: 'tweet-action', op: 'reply', tweetId, text: replyText }, {
                    onOk: () => { setReplyText(''); setEngageNotice({ kind: 'ok', text: 'Reply posted live.' }); },
                    setPanelNotice: setEngageNotice,
                  }),
                })}
              </div>
            </div>
            {engageNotice ? <p className={`xp-notice xp-notice-${engageNotice.kind}`}>{engageNotice.text}</p> : null}
          </section>

          {/* ── Audience ───────────────────────────────────────────── */}
          <section id="x-profile-audience-panel" className="xp-panel">
            <div className="xp-head">
              <span className="xp-kicker"><AtSign size={13} /> Audience</span>
              <small>FOLLOWS</small>
            </div>
            <p className="xp-sub">
              Follow or unfollow one account by handle (lookup + write = 2 calls). The bulk inactive-unfollow backlog
              (<strong>185 pending, 708 never audited</strong>) stays in the capped CLI workflow — it burns credits fast and
              runs only with an explicit batch approval (SSOT §4).
            </p>
            <div className="xp-form">
              <label>
                <span><AtSign size={12} /> Handle</span>
                <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@someaccount" />
              </label>
            </div>
            <div className="xp-actions">
              {gate('follow', {
                label: 'Follow', icon: <UserPlus size={13} />, disabled: !handle.trim() || !connected,
                cost: '2 metered calls (handle lookup + follow). Public action as @bai_ee.',
                run: () => runGated('follow', { action: 'follow-action', op: 'follow', handle }, {
                  onOk: (d) => setAudienceNotice({ kind: 'ok', text: `Now following @${d.result.username}.` }),
                  setPanelNotice: setAudienceNotice,
                }),
              })}
              {gate('unfollow', {
                label: 'Unfollow', icon: <UserMinus size={13} />, disabled: !handle.trim() || !connected,
                cost: '2 metered calls (handle lookup + unfollow). Irreversible without re-following.',
                run: () => runGated('unfollow', { action: 'follow-action', op: 'unfollow', handle }, {
                  onOk: (d) => setAudienceNotice({ kind: 'ok', text: `Unfollowed @${d.result.username}.` }),
                  setPanelNotice: setAudienceNotice,
                }),
              })}
            </div>
            {audienceNotice ? <p className={`xp-notice xp-notice-${audienceNotice.kind}`}>{audienceNotice.text}</p> : null}
          </section>

          {/* ── One-time app setup (shown until env creds exist) ───── */}
          {!loading && !configReady ? (
            <section id="x-profile-setup-panel" className="xp-panel">
              <div className="xp-head"><span className="xp-kicker">One-time setup</span><small>DEVELOPER.X.COM</small></div>
              <ol className="xp-recs" style={{ listStyle: 'decimal', paddingLeft: 18 }}>
                <li>In the X developer console, open the HitLoop app → <strong>OAuth 2.0 Keys</strong> → Edit settings.</li>
                <li>Type <strong>Web App</strong> (confidential client); confirm the callback URL below is listed.</li>
                <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong>.</li>
              </ol>
              <div className="xp-actions" style={{ alignItems: 'center' }}>
                <code style={{ wordBreak: 'break-all', flex: 1 }}>{status?.callbackUrl || '…'}</code>
                <button type="button" onClick={copyCallbackUrl}>
                  {copiedCallback ? <Check size={13} /> : <Copy size={13} />} {copiedCallback ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="xp-sub" style={{ marginTop: 8 }}>
                Put them into <code>.env.local</code> (and Vercel) as <code>X_OAUTH_CLIENT_ID</code> / <code>X_OAUTH_CLIENT_SECRET</code>,
                restart <code>npm run dev</code>, and hit Refresh status.
              </p>
            </section>
          ) : null}

          {/* ── What's deliberately NOT here ───────────────────────── */}
          <section id="x-profile-roadmap-panel" className="xp-panel">
            <div className="xp-head"><span className="xp-kicker">Not built (on purpose)</span><small>SCOPE</small></div>
            <ul className="xp-recs">
              <li><strong>Bulk unfollow.</strong> Lives in the capped CLI (`scripts/unfollow-inactive-following.mjs`) — per-batch approval only.</li>
              <li><strong>DMs + lists.</strong> Extra scopes and low value right now — say the word if wanted.</li>
              <li><strong>Pin tweet.</strong> The public API has no pinned-tweet write — do it in the X app.</li>
              <li><strong>Auto-enhance on send.</strong> Drafts land raw in Copywriter so you steer the AI pass there.</li>
            </ul>
          </section>
        </>
      )}

      <style jsx>{`
        /* Single-column vertical stack — white theme (dashboard modal style guide) */
        #x-profile-card { margin-top: 18px; display: grid; gap: 14px; }
        .xp-panel { border: 1px solid rgba(42,36,32,0.12); background: rgba(255,255,255,0.72); border-radius: 16px; padding: 16px; box-shadow: 0 1px 0 rgba(255,255,255,0.7), inset 0 1px 0 rgba(255,255,255,0.4); backdrop-filter: blur(20px); }
        .xp-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
        .xp-kicker { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(42,36,32,0.62); }
        .xp-head small { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; color: rgba(42,36,32,0.5); text-align: right; }
        .xp-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; align-items: center; }
        button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 1px solid rgba(42,36,32,0.12); border-radius: 999px; background: rgba(255,255,255,0.6); color: #2a2420; min-height: 38px; padding: 0 15px; font-weight: 700; font-size: 12px; cursor: pointer; box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); transition: background 160ms ease, box-shadow 160ms ease, border-color 160ms ease, transform 220ms cubic-bezier(0.34,1.56,0.64,1); }
        button:hover:not(:disabled) { background: rgba(255,255,255,0.95); border-color: rgba(42,36,32,0.2); box-shadow: 0 4px 14px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.5); transform: translateY(-1px); }
        button:active:not(:disabled) { transform: translateY(0); transition-duration: 80ms; }
        button:disabled { opacity: 0.48; cursor: not-allowed; }
        .xp-primary { background: #2a2420; color: #ffffff; border-color: #2a2420; box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
        .xp-primary:hover:not(:disabled) { background: #3a332e; border-color: #3a332e; box-shadow: 0 4px 14px rgba(42,36,32,0.2), inset 0 1px 0 rgba(255,255,255,0.12); }
        .xp-gate-row { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid rgba(159,31,23,0.3); border-radius: 12px; background: rgba(159,31,23,0.04); }
        .xp-gate-cost { font-size: 11px; line-height: 1.4; font-weight: 600; color: #9f1f17; max-width: 420px; }
        .xp-notice, .xp-error { margin: 12px 0 0; font-size: 12px; line-height: 1.4; }
        .xp-notice-ok { color: #285f3b; }
        .xp-notice-error, .xp-error { color: #9f1f17; }
        .xp-muted { font-size: 12px; line-height: 1.4; color: rgba(42,36,32,0.6); margin: 8px 0 0; }
        .xp-sub { margin: -4px 0 12px; font-size: 12px; line-height: 1.5; color: rgba(42,36,32,0.55); }
        .xp-sub strong { color: rgba(42,36,32,0.8); }
        .xp-empty { border: 1px dashed rgba(42,36,32,0.16); border-radius: 12px; background: rgba(255,255,255,0.4); padding: 20px 16px; text-align: center; font-size: 13px; line-height: 1.5; color: rgba(42,36,32,0.55); margin-top: 10px; }
        .xp-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .xp-chip { display: inline-flex; align-items: center; min-height: 28px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; padding: 0 12px; border-radius: 999px; background: rgba(42,36,32,0.06); border: 1px solid rgba(42,36,32,0.08); color: #3a332e; }
        .xp-chip-muted { background: rgba(255,255,255,0.5); border-color: rgba(42,36,32,0.14); color: rgba(42,36,32,0.6); text-transform: none; }
        .xp-recs { margin: 0; padding-left: 16px; display: grid; gap: 6px; }
        .xp-recs li { font-size: 12px; line-height: 1.45; color: rgba(42,36,32,0.72); }
        .xp-recs strong { color: #2a2420; }
        code { font-family: var(--font-mono); font-size: 11px; background: rgba(42,36,32,0.06); padding: 1px 5px; border-radius: 5px; color: #2a2420; }
        /* Usage meter */
        .xp-usage-row { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
        .xp-usage-num { font-family: var(--font-mono); font-size: 28px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; color: #2a2420; }
        .xp-usage-cap { font-size: 11px; color: rgba(42,36,32,0.55); }
        .xp-bar { height: 7px; border-radius: 4px; background: rgba(42,36,32,0.09); overflow: hidden; margin-top: 8px; }
        .xp-bar-fill { display: block; height: 100%; border-radius: 4px; background: #2f9e6b; }
        /* Bookmarks */
        .xp-bm-stack { display: grid; gap: 10px; margin-top: 12px; max-height: 420px; overflow: auto; }
        .xp-bm { padding: 12px 14px; border: 1px solid rgba(42,36,32,0.14); border-radius: 12px; background: rgba(255,255,255,0.78); box-shadow: inset 0 1px 0 rgba(255,255,255,0.5); }
        .xp-bm-head { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
        .xp-bm-author { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: 0.06em; color: #3a332e; }
        .xp-bm-when { font-family: var(--font-mono); font-size: 10px; color: rgba(42,36,32,0.5); }
        .xp-bm-text { margin: 0; font-size: 13px; line-height: 1.5; color: rgba(42,36,32,0.82); white-space: pre-wrap; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
        /* Forms */
        .xp-form { display: grid; gap: 10px; margin-top: 10px; }
        label { display: flex; flex-direction: column; gap: 6px; }
        label span { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(42,36,32,0.6); }
        input, textarea { width: 100%; border: 1px solid rgba(42,36,32,0.14); border-radius: 10px; padding: 10px 12px; background: rgba(255,255,255,0.98); color: #2a2420; font: inherit; line-height: 1.5; outline: none; box-shadow: inset 0 1px 0 rgba(255,255,255,0.6); min-height: 40px; }
        textarea { resize: vertical; }
        input:focus, textarea:focus { border-color: rgba(42,36,32,0.36); box-shadow: 0 0 0 3px rgba(42,36,32,0.08), inset 0 1px 0 rgba(255,255,255,0.65); }
        @media (max-width: 480px) {
          .xp-gate-cost { max-width: 100%; }
        }
      `}</style>
    </div>
  );
}
