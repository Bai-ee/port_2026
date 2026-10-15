'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { standaloneCallSocial } from './standalone.js';
import { ExternalLink, RefreshCw, Save, Search, Settings, BookOpen, X } from 'lucide-react';
import Accordion from '../content-ui/ui/Accordion.jsx';
import Badge from '../content-ui/ui/Badge.jsx';
import Card from '../content-ui/ui/Card.jsx';
import { XCE_COLORS, XCE_RADII, XCE_SHADOWS } from '../content-ui/xce-tokens';
import { Skeleton, RetryError } from '../content-ui/Feedback.jsx';
import { suggestionTrackChip, suggestionLinkLine, suggestionMediaState, stageErrorText } from '../../../features/x-strategy/ui-model.js';
import { slotLabel, timingLine, suggestionTrigger, strategySourceLine, slotStatuses, VOICE_LINE } from '../../../features/x-content-inventory/daily-loop/present.js';

// DailySuggestionsPanel — which X conversations to join today, with what owned
// content (Daily Content Loop POC, docs/plans/DAILY-CONTENT-LOOP-MASTER-PLAN.md).
//
// Review only. Generate reads SAVED inputs (scan, search, library, Brain,
// strategy, corpora) — the X search itself runs locally via
// `scripts/x-content/daily-run.mjs --discover`. Save Draft writes ONE
// unscheduled social_posts draft per suggestion; nothing here schedules or posts.
//
// STYLING: the Discover chrome (empty state, options, how-it-works) is inline
// style + ui/* primitives; suggestion-card internals keep the card's `xce-dl-`
// classes (parent owns that `<style jsx global>` block, prefixed `.xce-scope`).

const TYPE_LABEL = { reply: 'Reply', quote: 'Quote', original: 'Original post' };
const WHY_ROWS = [
  ['now', 'Why now'],
  ['brand', 'Why it fits'],
  ['brain', 'Brain'],
  ['strategy', 'Strategy'],
  ['content', 'Your content'],
];

function historyLine(h) {
  if (!h?.available) return h?.note || 'No own-account history loaded.';
  const t = h.type ? `${h.type.key}: n=${h.type.n}, ${h.type.lift == null ? 'no lift' : `${h.type.lift}× your average`}${h.type.weak ? ' (weak)' : ''}` : '';
  const topics = (h.topics || []).map((x) => `${x.topic}: n=${x.n}${x.lift == null ? '' : `, ${x.lift}×`}${x.weak ? ' (weak)' : ''}`).join(' · ');
  const range = h.range ? ` [${String(h.range.from).slice(0, 10)} → ${String(h.range.to).slice(0, 10)}]` : '';
  return [t, topics || 'no topic evidence', h.note].filter(Boolean).join(' — ') + range;
}

const STATUS_WORDS = {
  loaded: 'loaded',
  approved: 'approved',
  missing: 'missing — not used',
  excluded: 'excluded — not used',
  draft: 'draft, not approved — not used',
  stale: 'stale',
  unapproved: 'not approved — not used',
};
const COLLAPSED_GAPS = 3;
const TOGGLE = { alignSelf: 'flex-start', padding: 0, border: 0, background: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'color-mix(in srgb, var(--t-text) 70%, transparent)', textDecoration: 'underline' };

const STATUS_LINE = {
  draft: 'Saved draft — not approved',
  approved: 'Approved — not scheduled',
  awaiting_approval: 'Awaiting approval',
  scheduled: 'Scheduled',
  queued: 'Queued for the next publish run',
  posting: 'Posting now',
  posted: 'Posted',
  failed: 'Failed to post',
  needs_review: 'Held for review',
  manual: 'Posting manually (HITLOOP will not publish it)',
  rejected: 'Rejected',
  expired: 'Expired',
};
const HOLD_REASON = {
  'reply-threading-unsupported': 'it is a reply and threaded replies are not supported yet',
  'clearance-revoked': 'the content package is no longer cleared',
  'opportunity-expired': 'its timely window closed',
  'clearance-unverifiable': 'package clearance could not be verified',
};

// After Save draft the SAME post id carries on here: see status, pick a time, approve + schedule (explicit click),
// or jump to Queue & Calendar. Approving schedules this exact copy; the publish run posts it later.
function SavedPostFlow({ s, call, callSocial, showToast, onOpenQueue }) {
  const postId = s.socialPostId;
  const [post, setPost] = useState(null);
  const [when, setWhen] = useState('');
  const [working, setWorking] = useState(false);
  const [err, setErr] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await call('post-status', { postIds: [postId] });
      setPost(res.posts?.[0] || null);
    } catch (e) { setErr(e.message || 'Could not read the post status.'); }
  }, [call, postId]);
  useEffect(() => { refresh(); }, [refresh]);

  const whenMs = when ? new Date(when).getTime() : NaN;
  const timeOk = Number.isFinite(whenMs) && whenMs >= Date.now() + 60_000;
  const open = post && (post.status === 'draft' || post.status === 'approved');

  const approve = async () => {
    setWorking(true); setErr('');
    try {
      await callSocial({ action: 'approve-and-schedule', postId, scheduledAt: new Date(when).toISOString(), expectedRevision: post?.revision });
      showToast?.('Approved and scheduled. It posts when the publish run picks it up.');
      await refresh();
    } catch (e) { setErr(e.message || 'Could not schedule.'); showToast?.(e.message || 'Could not schedule.', 'error'); } finally { setWorking(false); }
  };

  return (
    <div id={`daily-suggestion-saved-flow-${s.id}`} className="xce-dl-saved-flow">
      <span id={`daily-suggestion-saved-note-${s.id}`} className="xce-dl-ok">{post && post.status !== 'draft' ? 'Saved post' : 'Saved as draft'} · post {postId}</span>
      <span id={`daily-suggestion-post-status-${s.id}`} className="xce-dl-status" role="status">
        {post ? `${STATUS_LINE[post.status] || post.status}${post.scheduledAt ? ` · ${new Date(post.scheduledAt).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} CT` : ''}` : 'checking status…'}
        {post?.status === 'needs_review' && post.errorClass ? ` — held because ${HOLD_REASON[post.errorClass] || post.errorClass}` : ''}
      </span>
      {open ? (
        <div id={`daily-suggestion-schedule-row-${s.id}`} className="xce-dl-actions">
          <label className="xce-dl-model" htmlFor={`daily-suggestion-when-${s.id}`}>Publish at (your local time)
            <input id={`daily-suggestion-when-${s.id}`} type="datetime-local" className="xce-input" value={when} onChange={(e) => setWhen(e.target.value)} />
          </label>
          <button id={`daily-suggestion-approve-schedule-${s.id}`} type="button" className="xce-btn-primary" disabled={working || !timeOk || post.replyTo} onClick={approve}>
            {working ? 'Working…' : 'Approve & schedule'}
          </button>
          {timeOk ? <span id={`daily-suggestion-when-ct-${s.id}`} className="xce-dl-muted">= {new Date(when).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} CT</span> : null}
        </div>
      ) : null}
      {open ? <p id={`daily-suggestion-consequence-${s.id}`} className="xce-dl-muted">Approving schedules this exact copy for the publish run; nothing is posted from this button. Editing it later voids the approval.{post.replyTo ? ' This is a reply: replies cannot be scheduled yet.' : ''}</p> : null}
      {err ? <p className="xce-dl-bad" role="alert">{err}</p> : null}
      <button id={`daily-suggestion-open-queue-${s.id}`} type="button" className="xce-btn-ghost" onClick={onOpenQueue}>Open in Queue &amp; Calendar</button>
    </div>
  );
}

function SuggestionCard({ s, text, thumbUrl, onText, onCommit, onSave, onDismiss, onReload, busy, call, callSocial, showToast, onOpenQueue }) {
  const [stage, setStage] = useState({ busy: false, queued: false, error: '' });
  const media = suggestionMediaState(s, stage);
  const trackChip = suggestionTrackChip(s);
  const linkLine = suggestionLinkLine(s);
  const trigger = suggestionTrigger(s);
  // Owner click is the approval. Never auto-stages. Same call as ItemDrawer: nas-stage { id } -> { ok, commandId } (queues STAGE_FOR_PUBLISH).
  const stageFromNas = async () => {
    if (stage.queued) { setStage((x) => ({ ...x, busy: true })); try { await onReload?.(); } finally { setStage((x) => ({ ...x, busy: false })); } return; }
    setStage({ busy: true, queued: false, error: '' });
    try {
      const r = await call('nas-stage', { id: s.package.id });
      if (!r || r.ok === false) throw new Error(r?.error || 'Could not queue the staging upload.');
      setStage({ busy: false, queued: true, error: '' });
    } catch (err) { setStage({ busy: false, queued: false, error: stageErrorText(err) }); }
  };
  const reviewed = s.reviewState === 'saved' || s.reviewState === 'dismissed';
  const stored = s.edit?.text ?? s.draft.text;
  const dirty = text !== stored;
  const checks = s.edit?.checks || s.checks;
  const empty = !text.trim();
  const max = s.type === 'quote' ? 90 : s.type === 'reply' ? 200 : 280;
  return (
    <article id={`daily-suggestion-card-${s.id}`} data-suggestion-id={s.id} className={`xce-dl-card${checks.blocked ? ' xce-dl-blocked' : ''}`} style={{ background: XCE_COLORS.surface, border: `1px solid ${checks.blocked ? XCE_COLORS.redBorder : XCE_COLORS.border}`, borderRadius: XCE_RADII.lg, boxShadow: XCE_SHADOWS.card, minWidth: 0 }}>
      <header id={`daily-suggestion-header-row-${s.id}`} className="xce-dl-card-head">
        <span className={`xce-dl-type xce-dl-type-${s.type}`}>{TYPE_LABEL[s.type] || s.type}</span>
        {s.match?.tier === 'genre' ? <span className="xce-dl-tier">genre-level match</span> : null}
        {slotLabel(s.slot) ? <span id={`daily-suggestion-slot-label-${s.id}`} className="xce-dl-slot-label" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, color: 'var(--t-text)' }}>{slotLabel(s.slot)}</span> : null}
        <span className="xce-dl-slot">{timingLine(s)}</span>
        {trackChip ? <span id={`daily-suggestion-track-chip-${s.id}`} className="xce-chip">{trackChip}</span> : null}
        {media.chip ? <span id={`daily-suggestion-needs-staging-chip-${s.id}`} className="xce-chip xce-chip-warn">{media.chip}</span> : null}
      </header>

      {trigger ? (
        <div id={`daily-suggestion-trigger-row-${s.id}`} data-trigger={trigger.kind} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, margin: '2px 0 6px', minWidth: 0 }}>
          <span id={`daily-suggestion-trigger-chip-${s.id}`} className="xce-chip" style={{ fontWeight: 700 }}>{trigger.label}{trigger.track ? ` · ${trigger.track}` : ''}</span>
          <span id={`daily-suggestion-trigger-reason-${s.id}`} className="xce-dl-muted" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{trigger.reason}</span>
        </div>
      ) : null}

      {s.conversation ? (
        <div id={`daily-suggestion-conversation-${s.id}`} className="xce-dl-convo">
          {s.conversation.posts.slice(0, 3).map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer" className="xce-dl-post">
              <span className="xce-dl-post-meta">@{p.author} · {p.ageHours}h old · {p.likes}♥ {p.replies}↩ <ExternalLink size={11} /></span>
              <span className="xce-dl-post-text">{p.text}</span>
            </a>
          ))}
        </div>
      ) : null}

      <dl id={`daily-suggestion-why-${s.id}`} className="xce-dl-why">
        {WHY_ROWS.map(([k, label]) => (
          <React.Fragment key={k}><dt>{label}</dt><dd>{s.why[k]}</dd></React.Fragment>
        ))}
        <dt>Your history</dt><dd>{historyLine(s.why.history)}</dd>
      </dl>

      <div id={`daily-suggestion-content-${s.id}`} className="xce-dl-content">
        {thumbUrl ? <img id={`daily-suggestion-thumb-${s.id}`} src={thumbUrl} alt="" loading="lazy" style={{ display: 'block', maxWidth: 120, maxHeight: 120, marginBottom: 6, borderRadius: 8, objectFit: 'cover' }} /> : null}
        {s.package ? (
          <>
            <strong>{s.package.title}</strong>
            <ul>
              {s.package.basis === 'story' ? <li>your own story on file</li> : null}
              {(s.package.facts || []).slice(0, 5).map((f) => (
                <li key={`${f.label}-${f.value}`}>{f.label}: {f.label === 'source' ? <a href={f.value} target="_blank" rel="noreferrer">{f.value}</a> : f.value} <em>({f.provenance})</em></li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <strong>no owned item: reaction slot</strong>
            {s.related ? <p id={`daily-suggestion-related-${s.id}`}>related: {s.related.title || s.related.id}</p> : null}
          </>
        )}
      </div>

      <span className="xce-dl-draft-label">
        Draft <span>({s.edit ? 'your edit' : s.draft.source})</span>
      </span>
      <textarea
        id={`daily-suggestion-edit-textarea-${s.id}`}
        aria-label="Draft text"
        placeholder={empty ? 'write this one yourself' : undefined}
        className="xce-dl-textarea"
        value={text}
        onChange={(e) => onText(e.target.value)}
        onBlur={() => { if (dirty) onCommit(); }}
        disabled={reviewed || busy}
        rows={3}
      />
      <div id={`daily-suggestion-checks-row-${s.id}`} className="xce-dl-checks">
        <span className={text.length > max ? 'xce-dl-bad' : ''}>{text.length}/{max}</span>
        {empty ? <span id={`daily-suggestion-write-yourself-${s.id}`} className="xce-dl-muted">write this one yourself</span> : null}
        {dirty ? <span>click outside the box to re-check before saving</span> : (
          <>
            <span className={checks.blocked ? 'xce-dl-bad' : 'xce-dl-ok'}>{checks.blocked ? 'blocked' : 'checks pass'}</span>
            <span>guard lane: {checks.guard.lane}</span>
            <span>{checks.score ? `score ${Number(checks.score.value).toFixed(2)} (advisory)` : 'score n/a for quotes'}</span>
          </>
        )}
        {s.type === 'quote' ? <span>quote URL is appended on save</span> : null}
        {s.type === 'reply' ? <span>saved with its reply target</span> : null}
      </div>
      {!dirty && (checks.violations.length || checks.warnings.length) ? (
        <ul id={`daily-suggestion-violations-list-${s.id}`} style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
          {checks.violations.map((v) => <li key={`v-${v}`} className="xce-dl-bad">{v}</li>)}
          {checks.warnings.map((w) => <li key={`w-${w}`} className="xce-dl-muted">warning: {w}</li>)}
        </ul>
      ) : null}

      {linkLine ? <p id={`daily-suggestion-link-line-${s.id}`} className="xce-dl-muted" style={{ margin: '4px 0', overflowWrap: 'anywhere' }}>{linkLine.kind === 'self-reply' ? 'Self-reply: ' : 'Promotion link: '}{linkLine.text}</p> : null}
      {media.showStage && s.reviewState !== 'saved' && s.reviewState !== 'dismissed' ? (
        <div id={`daily-suggestion-stage-panel-${s.id}`} style={{ margin: '4px 0', display: 'grid', gap: 6 }}>
          <p id={`daily-suggestion-stage-note-${s.id}`} role={media.noteTone === 'error' ? 'alert' : 'status'} className={media.noteTone === 'error' ? 'xce-dl-bad' : 'xce-dl-muted'} style={{ margin: 0 }}>{media.note}</p>
          <button type="button" id={`daily-suggestion-stage-button-${s.id}`} className="xce-btn-ghost" disabled={media.stageDisabled || busy} onClick={stageFromNas}>{media.stageLabel}</button>
        </div>
      ) : null}

      <div id={`daily-suggestion-actions-row-${s.id}`} className="xce-dl-actions">
        {s.reviewState === 'saved' ? (
          <SavedPostFlow s={s} call={call} callSocial={callSocial} showToast={showToast} onOpenQueue={onOpenQueue} />
        ) : s.reviewState === 'dismissed' ? (
          <span className="xce-dl-muted">Dismissed</span>
        ) : (
          <>
            <button type="button" className="xce-btn-primary" disabled={busy || dirty || empty || checks.blocked || !media.canSave} title={media.canSave ? undefined : 'Stage the media first'} onClick={onSave}>
              <Save size={13} /> {busy ? 'Working…' : 'Save draft'}
            </button>
            <button type="button" className="xce-btn-ghost" disabled={busy} onClick={onDismiss}>
              <X size={13} /> Dismiss
            </button>
          </>
        )}
      </div>
    </article>
  );
}

// Stack the three-column input rows below 640px (the parent's 481px breakpoint
// squeezed the detail column to ~60px at 500px). Scoped by id, so it only
// touches this panel.
const INPUTS_STACK_CSS = '@media (max-width: 640px) { .xce-scope #daily-run-inputs-panel .xce-dl-input { grid-template-columns: 1fr; } }';

function StrategySource({ run }) {
  const src = run.strategySource;
  const line = strategySourceLine(src);
  const slots = slotStatuses(run);
  return (
    <div id="daily-run-strategy-source" className="xce-dl-input">
      <span>strategy source</span>
      <span>{line || 'no slot plan for this run'}</span>
      <span>
        {src && slots.length ? slots.map((x) => `${x.letter} ${x.timeCT || 'anytime'} ${x.type}`).join(' · ') : null}
        {src && slots.length ? <br /> : null}
        {VOICE_LINE}
      </span>
    </div>
  );
}

function InputsPanel({ run }) {
  // run.js already emits a 'strategy slots' row; the dedicated block above replaces it.
  const rows = (run.inputs || []).filter((i) => !(run.strategySource && i.input === 'strategy slots'));
  return (
    <div id="daily-run-inputs-panel" className="xce-dl-inputs">
      <style>{INPUTS_STACK_CSS}</style>
      <StrategySource run={run} />
      {rows.map((i) => (
        <div key={i.input} className={`xce-dl-input xce-dl-input-${String(i.status).replace(/\s+/g, '-')}`}>
          <span>{i.input}</span>
          <span>{STATUS_WORDS[i.status] || i.status}{i.age ? ` · ${i.age}` : ''}</span>
          <span>{i.detail}</span>
        </div>
      ))}
    </div>
  );
}

function GapsList({ gaps }) {
  const [open, setOpen] = useState(false);
  const ordered = [...gaps.filter((g) => g.slot), ...gaps.filter((g) => !g.slot)];
  const shown = open ? ordered : ordered.slice(0, COLLAPSED_GAPS);
  return (
    <div id="daily-run-gaps-list" className="xce-dl-gaps">
      <span className="xce-kicker">Gaps and missing inputs</span>
      <ul>
        {shown.map((g) => (
          <li key={g.code}>
            {g.slot ? <><strong>Slot {g.slot.letter}</strong> ({[g.slot.timeCT ? `${g.slot.timeCT} CT` : 'anytime', g.slot.type, g.slot.pillar].filter(Boolean).join(' · ')}) unfilled: {g.slot.fillReason || g.message}</> : <><code>{g.code}</code> {g.message}</>}
          </li>
        ))}
      </ul>
      {gaps.length > COLLAPSED_GAPS ? (
        <button type="button" style={TOGGLE} onClick={() => setOpen((o) => !o)}>{open ? 'show fewer' : `show all ${gaps.length}`}</button>
      ) : null}
    </div>
  );
}

function Shortlist({ run }) {
  const [open, setOpen] = useState(false);
  const used = new Set(run.suggestions.map((s) => s.conversation?.id).filter(Boolean));
  const skipped = (run.shortlist || []).filter((c) => !used.has(c.id));
  const reasons = run.gaps.filter((g) => /skipped|no-content|off-brand/.test(`${g.code} ${g.message}`));
  if (!skipped.length && !reasons.length) return null;
  return (
    <div id="daily-run-shortlist" className="xce-dl-gaps">
      <button type="button" style={TOGGLE} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide' : 'Show'} conversations considered but not suggested ({skipped.length})
      </button>
      {open ? (
        <>
          <ul>
            {skipped.map((c) => (
              <li key={c.id}>
                <a href={c.anchor} target="_blank" rel="noreferrer">{c.label}</a> — brand fit {c.brandFit}, {c.skipped ? `skipped: ${c.reason}` : <>best content <code>{c.content}</code>; ranked below the picks</>}
              </li>
            ))}
          </ul>
          {reasons.length ? <ul>{reasons.map((g) => <li key={g.code}>{g.message}</li>)}</ul> : null}
        </>
      ) : null}
    </div>
  );
}

// Standalone mount: <DailySuggestionsPanel clientId call onNavigate />. callSocial falls back to /api/social-posting
// (token borrowed from the Firebase user), showToast to a local toast line, onOpenQueue to onNavigate('calendar').
export default function DailySuggestionsPanel({ call, callSocial: callSocialProp, showToast: showToastProp, onOpenQueue: onOpenQueueProp, onSelect, onNavigate, hideRefresh = false }) {
  const callSocial = callSocialProp || standaloneCallSocial;
  const [localToast, setLocalToast] = useState('');
  const showToast = showToastProp || ((text, kind) => setLocalToast(kind === 'error' ? `Error: ${text}` : text));
  const onOpenQueue = onOpenQueueProp || (() => onNavigate?.('calendar'));
  const [run, setRun] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const [withModel, setWithModel] = useState(false);
  const [texts, setTexts] = useState({});
  const [thumbs, setThumbs] = useState({});
  const [showDismissed, setShowDismissed] = useState(false);

  const adopt = useCallback((next) => {
    setRun(next || null);
    setTexts(Object.fromEntries((next?.suggestions || []).map((s) => [s.id, s.savedText || s.edit?.text || s.draft.text])));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try { adopt((await call('daily-run-latest')).run); } catch (err) { setError(err.message); } finally { setLoading(false); }
  }, [call, adopt]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const ids = [...new Set((run?.suggestions || []).filter((s) => s.package?.thumbRef).map((s) => s.package.id))];
    if (!ids.length) return undefined;
    let live = true;
    call('media-urls', { ids, kinds: ['thumb'] })
      .then((r) => { if (live) setThumbs(Object.fromEntries(ids.map((id) => [id, r?.urls?.[id]?.thumbUrl || null]))); })
      .catch(() => {});
    return () => { live = false; };
  }, [run, call]);

  const generate = useCallback(async (force) => {
    setBusy('generate');
    setError('');
    try {
      const res = await call('daily-run-generate', { force, draftWithModel: withModel });
      adopt(res.run);
      showToast?.(res.skipped ? `Inputs unchanged (${res.reason}) — showing the saved run.` : 'Suggestions generated.');
    } catch (err) { setError(err.message); } finally { setBusy(null); }
  }, [call, adopt, withModel, showToast]);

  const commitEdit = useCallback(async (s) => {
    setBusy(s.id);
    try { adopt((await call('daily-run-edit', { suggestionId: s.id, text: texts[s.id] })).run); } catch (err) { showToast?.(err.message, 'error'); } finally { setBusy(null); }
  }, [call, adopt, texts, showToast]);

  const save = useCallback(async (s) => {
    setBusy(s.id);
    try {
      const res = await call('daily-run-save-draft', { suggestionId: s.id, text: texts[s.id] });
      adopt(res.run);
      if (res.post?.id || res.postId) onSelect?.({ kind: 'post', id: res.post?.id || res.postId });
      showToast?.(res.existing ? 'Already saved — no duplicate created.' : 'Saved to the queue as an unscheduled draft.');
    } catch (err) { showToast?.(err.message, 'error'); } finally { setBusy(null); }
  }, [call, adopt, texts, showToast]);

  const dismiss = useCallback(async (s) => {
    setBusy(s.id);
    try { adopt((await call('daily-run-dismiss', { suggestionId: s.id })).run); } catch (err) { showToast?.(err.message, 'error'); } finally { setBusy(null); }
  }, [call, adopt, showToast]);

  const dismissedCount = (run?.suggestions || []).filter((s) => s.reviewState === 'dismissed').length;
  const visible = (run?.suggestions || []).filter((s) => showDismissed || s.reviewState !== 'dismissed');

  const BTN_SOLID = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, padding: '0 20px', border: `1px solid ${XCE_COLORS.ink}`, borderRadius: XCE_RADII.md, background: XCE_COLORS.ink, color: XCE_COLORS.onInk, fontSize: 14, fontWeight: 600, cursor: 'pointer' };
  const BTN_OUTLINE = { ...BTN_SOLID, border: `1px solid ${XCE_COLORS.borderStrong}`, background: XCE_COLORS.surface, color: XCE_COLORS.ink };
  const NOTE = { margin: 0, fontSize: 13, lineHeight: 1.45, color: XCE_COLORS.inkSoft, overflowWrap: 'anywhere' };

  return (
    <section id="daily-suggestions-panel" className="xce-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <h3 id="x-today-discover-heading" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: XCE_COLORS.ink }}>
        Conversations to join{run ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, fontWeight: 500, color: XCE_COLORS.inkSoft }}> · {run.localDate}</span> : null}
      </h3>

      {localToast ? <p id="daily-suggestions-local-toast" style={{ margin: 0, fontSize: 13, color: XCE_COLORS.inkSoft }}>{localToast}</p> : null}
      {loading ? <Skeleton id="daily-suggestions-loading" rows={3} /> : null}
      {error ? <RetryError id="daily-suggestions-error" message={error} onRetry={load} busy={loading} /> : null}

      {!loading && !error && !run ? (
        <div id="x-today-discover-empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '28px 16px', textAlign: 'center', border: `1px dashed ${XCE_COLORS.borderStrong}`, borderRadius: XCE_RADII.lg }}>
          <span aria-hidden="true" style={{ width: 56, height: 56, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: XCE_RADII.pill, background: XCE_COLORS.surfaceMuted, color: XCE_COLORS.ink, marginBottom: 6 }}>
            <Search size={24} />
          </span>
          <p style={{ margin: 0, fontSize: 17, fontWeight: 700, color: XCE_COLORS.ink }}>No suggestions yet.</p>
          <p style={NOTE}>Generate from saved inputs. No run today yet.</p>
          {!hideRefresh ? (
            <button type="button" id="x-today-generate-button" style={{ ...BTN_SOLID, marginTop: 8, opacity: busy ? 0.6 : 1 }} disabled={!!busy} onClick={() => generate(false)}>
              {busy === 'generate' ? 'Generating…' : 'Generate suggestions'}
            </button>
          ) : null}
        </div>
      ) : null}

      {run ? (
        <>
          {!hideRefresh ? <div id="daily-run-generate-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button type="button" id="x-today-refresh-button" style={BTN_OUTLINE} disabled={!!busy} onClick={() => generate(false)}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button type="button" id="x-today-regenerate-button" style={BTN_OUTLINE} disabled={!!busy} onClick={() => generate(true)}>Regenerate</button>
          </div> : null}

          <Card id="x-today-inputs-card" padding="0 14px">
            <Accordion id="x-today-inputs-accordion" title="Saved inputs">
              <InputsPanel run={run} />
            </Accordion>
          </Card>
          <GapsList gaps={run.gaps || []} />

          <div id="daily-suggestions-list" className="xce-dl-list">
            {visible.length ? visible.map((s) => (
              <SuggestionCard
                key={s.id}
                s={s}
                text={texts[s.id] ?? s.edit?.text ?? s.draft.text}
                thumbUrl={thumbs[s.package?.id] || null}
                onText={(v) => setTexts((t) => ({ ...t, [s.id]: v }))}
                onCommit={() => { onSelect?.({ kind: s.socialPostId ? 'post' : 'suggestion', id: s.socialPostId || s.id }); commitEdit(s); }}
                onSave={() => save(s)}
                call={call}
                callSocial={callSocial}
                showToast={showToast}
                onOpenQueue={onOpenQueue}
                onDismiss={() => dismiss(s)}
                onReload={load}
                busy={busy === s.id || busy === 'generate'}
              />
            )) : <div className="xce-empty">No suggestion today — see the gaps above.</div>}
          </div>
          {dismissedCount ? (
            <button id="daily-run-show-dismissed-toggle" type="button" style={TOGGLE} onClick={() => setShowDismissed((v) => !v)}>
              {showDismissed ? 'hide dismissed' : `show dismissed (${dismissedCount})`}
            </button>
          ) : null}

          <Shortlist run={run} />
          <p id="daily-run-stats-line" className="xce-sub">{run.stats.conversationPosts} posts → {run.stats.narratives} conversations → {run.stats.onBrandWithContent} on-brand with owned content · library {run.stats.eligible}/{run.stats.packages} eligible · {run.usage.modelCalls} model call(s) · inputs: {run.inputSource || run.mode}</p>
        </>
      ) : null}

      <Card id="x-today-options-card" padding="0 14px">
        <Accordion
          id="x-today-options-accordion"
          title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><Settings size={16} /> Generation options</span>}
          right={<Badge tone="blue">Paid</Badge>}
        >
          <label id="x-today-model-copy-toggle" className="xce-dl-model" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: XCE_COLORS.ink, minHeight: 32 }}>
            <input type="checkbox" checked={withModel} onChange={(e) => setWithModel(e.target.checked)} disabled={!!busy} style={{ marginTop: 3 }} />
            <span>Use model copy (paid, ≤3 calls)</span>
          </label>
        </Accordion>
      </Card>

      <Card id="x-today-how-it-works-card" padding="0 14px">
        <Accordion
          id="x-today-how-it-works-accordion"
          title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}><BookOpen size={16} /> How it works</span>}
        >
          <p id="daily-run-intro-note" style={NOTE}>Reads saved inputs only. X search runs locally: <code>node scripts/x-content/daily-run.mjs --client &lt;id&gt; --discover --write</code>. Nothing is scheduled or posted.</p>
        </Accordion>
      </Card>
    </section>
  );
}
