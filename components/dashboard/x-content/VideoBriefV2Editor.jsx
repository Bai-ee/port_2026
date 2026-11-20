'use client';

// VideoBriefV2Editor — the structured Creative Brief v2 form + Storyboard review, rendered inside VideoBriefPanel's body when a
// post's brief is v2 (features/brief-video/brief-v2.js). Saves through social-posting `video-brief-save` ({ v2, status }),
// `video-brief-approve` (v2: approved, storyboard next, never a render) and `video-brief-storyboard-review`. Styles: PostEditor.jsx (.pe-vb*, .pe-v2*).

import React, { useEffect, useMemo, useState } from 'react';
import { friendlyBriefReasons } from './post-editor-model.js';
import VideoReviewPanel from './VideoReviewPanel.jsx';
import { episodeIsOnPost, versionOfEpisode } from '../../../features/brief-video/video-review.js';
import {
  BEAT_COLUMNS, STORYBOARD_LABEL, V2_BEAT_SECONDS_MAX, V2_TREATMENTS, beatsCap, secondsCap, V2_CELL_MAX, V2_POST_COPY_MAX, V2_SHORT_MAX, V2_TEXT_MAX, V2_POSTER_HERO_MAX,
  addBeat, formFromV2, formMissing, formTotalSeconds, formWarnings, moveBeat, overBudget, removeBeat, setBeatCell, toV2Body,
} from './video-brief-v2-model.js';

const STATUS_LABEL = { draft: 'Draft', ready: 'Ready for review', approved: 'Approved (storyboard next)', rendered: 'Rendered' };

export default function VideoBriefV2Editor({ row, callSocial, editable, onRowPatch }) {
  const saved = row?.videoBriefMeta?.v2 || null;
  const initial = useMemo(() => formFromV2(saved), [row?.id, row?.videoBriefMeta]); // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [frameNotes, setFrameNotes] = useState({});
  const [reviewNotes, setReviewNotes] = useState('');
  const [episodeUrl, setEpisodeUrl] = useState(null);
  useEffect(() => { setF(initial); setFrameNotes({}); setReviewNotes(''); }, [initial]);

  const savedStatus = row?.videoBriefMeta?.status || null;
  const storyboard = row?.videoBriefMeta?.storyboard || null;
  const episodeKey = storyboard?.episode?.outlineHash || null;
  // The preview URL is derived server-side from Storage (the stored episode carries no URL).
  useEffect(() => {
    setEpisodeUrl(null);
    if (!episodeKey || !row?.id) return undefined;
    let live = true;
    callSocial({ action: 'video-brief-get', postId: row.id }).then((res) => { if (live) setEpisodeUrl(res?.brief?.episodeVideoUrl || null); }).catch(() => {});
    return () => { live = false; };
  }, [episodeKey, row?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const missing = useMemo(() => formMissing(f), [f]);
  const warnings = useMemo(() => formWarnings(f), [f]);
  const total = formTotalSeconds(f);
  const over = overBudget(f);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setMsg(null); };
  const setBeats = (fn) => { setF((x) => ({ ...x, beats: fn(x.beats) })); setMsg(null); };

  const run = async (body, okText, afterOk) => {
    setBusy(true); setMsg(null);
    try {
      const res = await callSocial({ ...body, postId: row.id, expectedRevision: row.revision ?? null });
      if (!res?.ok) throw new Error(res?.error || 'Save failed.');
      const b = res.brief || {};
      onRowPatch?.({ revision: res.post?.revision ?? row.revision, videoBrief: b.videoBrief || null, videoBriefMeta: b.meta || null, ...(res.next === 'video-attached' ? { mediaUrl: b.mediaUrl || null, posterUrl: b.posterUrl || null, mediaType: 'video', mediaJobId: b.mediaJobId || null, mediaStoragePath: b.mediaStoragePath || null, mediaMetadata: b.mediaMetadata || null } : {}) });
      setMsg({ tone: 'ok', text: afterOk ? afterOk(res) : okText });
    } catch (e) {
      setMsg({ tone: 'bad', text: friendlyBriefReasons(e?.message || 'Save failed.') });
    } finally {
      setBusy(false);
    }
  };
  const save = (status) => run({ action: 'video-brief-save', v2: toV2Body(f), status }, status === 'ready' ? 'Marked ready. The post copy was not changed.' : 'Draft saved. The post copy was not changed.');
  const approve = () => run({ action: 'video-brief-approve' }, 'Brief approved.', (res) => (res.next === 'storyboard' ? 'Brief approved. Next: the storyboard. No video is rendered yet.' : 'Brief approved.'));
  const review = (decision) => run(
    { action: 'video-brief-storyboard-review', decision, notes: reviewNotes.trim(), frameNotes: Object.fromEntries(Object.entries(frameNotes).filter(([, v]) => String(v).trim())) },
    decision === 'approve' ? 'Storyboard approved.' : 'Changes requested. The storyboard goes back to the Director.',
    decision === 'approve' ? (res) => (res.next === 'video-attached' ? 'Storyboard approved. The video is on the post.' : 'Storyboard approved.') : undefined,
  );

  // A new version is ready while a video is already on the post: show current vs new.
  const replacing = Boolean(storyboard?.status === 'ready' && storyboard?.episode && row?.mediaUrl && !episodeIsOnPost(row, storyboard.episode));
  const newV = replacing ? versionOfEpisode(row.videoBriefMeta, storyboard.episode) : null;
  const ro = !editable;
  const canReview = editable && !busy && !dirty && storyboard?.status === 'ready';
  const hasReviewNotes = reviewNotes.trim() || Object.values(frameNotes).some((v) => String(v).trim());
  const text = (id, label, key, { max = V2_TEXT_MAX, rows = 2, placeholder } = {}) => (
    <label className="pe-vb-field" htmlFor={id}>{label}
      <textarea id={id} className="pe-text pe-v2-input" rows={rows} maxLength={max} value={f[key]} readOnly={ro} onChange={set(key)} placeholder={placeholder} />
    </label>
  );
  const line = (id, label, key, { max = V2_SHORT_MAX, placeholder } = {}) => (
    <label className="pe-vb-field" htmlFor={id}>{label}
      <input id={id} className="pe-input" type="text" maxLength={max} value={f[key]} readOnly={ro} onChange={set(key)} placeholder={placeholder} />
    </label>
  );

  return (
    <div id="video-brief-v2-editor" className="pe-vb-body" data-section="video-brief-v2">
      <p className="pe-muted">Creative Brief v2: the structured brief the video Director works from. Every beat shows something happening on a real game screen.</p>
      <div id="video-brief-v2-format-row" className="pe-vb-row">
        <label className="pe-vb-field" htmlFor="video-brief-v2-format">Format
          <select id="video-brief-v2-format" className="pe-input" value={f.format} disabled={ro} onChange={set('format')}>
            <option value="">Choose…</option><option value="feature">Feature episode</option><option value="guide">Guide episode</option><option value="promo">Promo piece (15-23 s)</option><option value="chapter">Chapter story (3-6 chapters, up to 34 s)</option>
          </select>
        </label>
        <label className="pe-vb-field" htmlFor="video-brief-v2-voice-mode">Voice mode
          <select id="video-brief-v2-voice-mode" className="pe-input" value={f.voiceMode} disabled={ro} onChange={set('voiceMode')}>
            <option value="">Choose…</option><option value="narrated">Narrated</option><option value="caption-only">Caption only</option><option value="music">Music</option>
          </select>
        </label>
      </div>
      {f.format === 'promo' ? (
        <div id="video-brief-v2-promo-panel" className="pe-v2-grid">
          <label className="pe-vb-field" htmlFor="video-brief-v2-treatment">Treatment
            <select id="video-brief-v2-treatment" className="pe-input" value={f.treatment} disabled={ro} onChange={set('treatment')}>
              <option value="">Choose…</option>
              {V2_TREATMENTS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="pe-vb-field" htmlFor="video-brief-v2-cast">Cast (one per line)
            <textarea id="video-brief-v2-cast" className="pe-text pe-v2-input" rows={2} value={f.cast} readOnly={ro} onChange={set('cast')} placeholder="Gravitax" />
          </label>
          <label className="pe-vb-field" htmlFor="video-brief-v2-bubbles">Bubbles (up to 3, one per line)
            <textarea id="video-brief-v2-bubbles" className="pe-text pe-v2-input" rows={2} value={f.bubbles} readOnly={ro} onChange={set('bubbles')} />
          </label>
        </div>
      ) : null}
      {f.format === 'guide' ? (
        <div id="video-brief-v2-guide-row" className="pe-v2-grid">
          {line('video-brief-v2-lesson', 'Lesson', 'lesson', { placeholder: 'e.g. Posting a Defender' })}
          {line('video-brief-v2-host', 'Host', 'host', { placeholder: 'the lesson\'s teacher, or mayor' })}
          {line('video-brief-v2-focus', 'Focus', 'focus', { max: V2_TEXT_MAX, placeholder: 'the one slice of the lesson' })}
        </div>
      ) : null}
      {text('video-brief-v2-angle', 'Angle / freshness (closest shipped video, what differs)', 'angle')}
      <fieldset id="video-brief-v2-poster-panel" className="pe-v2-fieldset">
        <legend>Poster (the designed first frame)</legend>
        {text('video-brief-v2-poster-idea', 'Idea (who is on it, the world)', 'posterIdea')}
        <div id="video-brief-v2-poster-lines-row" className="pe-v2-grid">
          {line('video-brief-v2-poster-hero', 'Poster hero (character, place, pose)', 'posterHero', { max: V2_POSTER_HERO_MAX, placeholder: 'king-critter, inside the town, idle, facing camera' })}
          {line('video-brief-v2-poster-banner', 'Banner (2-4 words)', 'posterBanner')}
          {line('video-brief-v2-poster-date-line', 'Date line (optional)', 'posterDateLine')}
          {line('video-brief-v2-poster-bubble', 'Bubble (optional)', 'posterBubble')}
        </div>
      </fieldset>
      {text('video-brief-v2-hero', 'Hero moment (the one thing they remember)', 'hero')}
      {text('video-brief-v2-theme', 'Theme (one sentence)', 'theme')}

      <div id="video-brief-v2-beats-panel" className="pe-v2-beats-panel">
        <div id="video-brief-v2-beats-header-row" className="pe-vb-row pe-v2-beats-head">
          <strong>Beats</strong>
          <span id="video-brief-v2-total-seconds" className={over ? 'pe-over' : 'pe-muted'} role={over ? 'alert' : undefined}>{total} s of {secondsCap(f)} s{over ? ' (too long)' : ''}</span>
          <button type="button" id="video-brief-v2-add-beat-btn" className="pe-btn pe-btn-ghost" disabled={ro || f.beats.length >= beatsCap(f)} onClick={() => setBeats((bs) => addBeat(bs, beatsCap(f)))}>Add beat</button>
        </div>
        <div id="video-brief-v2-beats-table" className="pe-v2-beats" role="table" aria-label="Beats">
          {f.beats.map((b, i) => (
            <div id={`video-brief-v2-beat-${i + 1}`} key={i} className="pe-v2-beat" role="row">
              <div id={`video-brief-v2-beat-${i + 1}-head-row`} className="pe-vb-row pe-v2-beat-head">
                <strong>Beat {i + 1}</strong>
                <button type="button" id={`video-brief-v2-beat-${i + 1}-up-btn`} className="pe-btn pe-btn-ghost" aria-label={`Move beat ${i + 1} up`} disabled={ro || i === 0} onClick={() => setBeats((bs) => moveBeat(bs, i, -1))}>Up</button>
                <button type="button" id={`video-brief-v2-beat-${i + 1}-down-btn`} className="pe-btn pe-btn-ghost" aria-label={`Move beat ${i + 1} down`} disabled={ro || i === f.beats.length - 1} onClick={() => setBeats((bs) => moveBeat(bs, i, 1))}>Down</button>
                <button type="button" id={`video-brief-v2-beat-${i + 1}-remove-btn`} className="pe-btn pe-btn-ghost" aria-label={`Remove beat ${i + 1}`} disabled={ro || f.beats.length <= 1} onClick={() => setBeats((bs) => removeBeat(bs, i))}>Remove</button>
              </div>
              <div id={`video-brief-v2-beat-${i + 1}-cells`} className="pe-v2-grid">
                {BEAT_COLUMNS.map((c) => (
                  <label key={c.key} className="pe-vb-field" htmlFor={`video-brief-v2-beat-${i + 1}-${c.key}`}>{c.label}
                    <textarea id={`video-brief-v2-beat-${i + 1}-${c.key}`} className="pe-text pe-v2-input" rows={2} maxLength={V2_CELL_MAX} value={b[c.key]} readOnly={ro} onChange={(e) => setBeats((bs) => setBeatCell(bs, i, c.key, e.target.value))} />
                  </label>
                ))}
                <label className="pe-vb-field" htmlFor={`video-brief-v2-beat-${i + 1}-seconds`}>Seconds
                  <input id={`video-brief-v2-beat-${i + 1}-seconds`} className="pe-input" type="number" inputMode="decimal" min={1} max={V2_BEAT_SECONDS_MAX} step="0.5" value={b.seconds} readOnly={ro} onChange={(e) => setBeats((bs) => setBeatCell(bs, i, 'seconds', e.target.value))} />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {text('video-brief-v2-payoff', 'Payoff (what visibly happens at the end)', 'payoff')}
      {text('video-brief-v2-end', 'End (campaign end card, or approved art path)', 'end')}
      {text('video-brief-v2-must-not', 'Must not', 'mustNot')}
      <label className="pe-vb-field" htmlFor="video-brief-v2-narration-lines">Narration lines (one per line, up to 8)
        <textarea id="video-brief-v2-narration-lines" className="pe-text pe-v2-input" rows={4} value={f.narrationLines} readOnly={ro} onChange={set('narrationLines')} />
      </label>
      <label className="pe-vb-field" htmlFor="video-brief-v2-needs">Needs (anything not built yet, one per line)
        <textarea id="video-brief-v2-needs" className="pe-text pe-v2-input" rows={2} value={f.needs} readOnly={ro} onChange={set('needs')} placeholder="NEEDS: ..." />
      </label>
      {text('video-brief-v2-post-copy', `Post copy (max ${V2_POST_COPY_MAX}; lives in the post, not the video)`, 'postCopy', { max: V2_POST_COPY_MAX })}

      {missing.length ? <p id="video-brief-v2-missing-list" className="pe-muted">To mark ready, still missing: {missing.join('; ')}.</p> : <p id="video-brief-v2-missing-list" className="pe-muted">All required fields are filled.</p>}
      {warnings.length ? <p id="video-brief-v2-warnings-list" className="pe-muted">Heads up: {warnings.join('; ')}.</p> : null}
      <div id="video-brief-v2-actions-row" className="pe-vb-row">
        <button type="button" id="video-brief-v2-save-draft-btn" className="pe-btn pe-btn-ghost" disabled={ro || busy || !dirty || over} onClick={() => save('draft')}>{busy ? 'Saving…' : 'Save draft'}</button>
        <button type="button" id="video-brief-v2-mark-ready-btn" className="pe-btn pe-btn-ghost" disabled={ro || busy || over || (!dirty && savedStatus === 'ready')} onClick={() => save('ready')}>Mark ready</button>
        <button type="button" id="video-brief-v2-approve-btn" className="pe-btn pe-btn-ghost" disabled={ro || busy || dirty || savedStatus !== 'ready'} onClick={approve} title={dirty ? 'Save the brief first.' : savedStatus !== 'ready' ? 'Mark the brief ready first.' : ''}>Approve brief</button>
        {savedStatus ? <span id="video-brief-v2-status-chip" className="pe-vb-pill">{STATUS_LABEL[savedStatus] || savedStatus}</span> : null}
      </div>

      <section id="video-brief-v2-storyboard-panel" className="pe-v2-fieldset" data-section="video-brief-v2-storyboard">
        <div id="video-brief-v2-storyboard-header-row" className="pe-vb-row">
          <strong>Storyboard</strong>
          <span id="video-brief-v2-storyboard-status-chip" className="pe-vb-pill">{storyboard ? (STORYBOARD_LABEL[storyboard.status] || storyboard.status) : 'Not started'}</span>
        </div>
        {!storyboard ? <p className="pe-muted">Approve the brief to ask for a storyboard. Nothing is rendered until you approve the storyboard.</p> : null}
        {storyboard?.status === 'pending' ? <p className="pe-muted">Waiting for the Director's storyboard.</p> : null}
        {storyboard?.outline ? (
          <details id="video-brief-v2-storyboard-outline">
            <summary id="video-brief-v2-storyboard-outline-summary">Outline</summary>
            <pre id="video-brief-v2-storyboard-outline-text" className="pe-v2-outline">{storyboard.outline}</pre>
          </details>
        ) : null}
        {storyboard?.episode ? (
          <div id="storyboard-episode-preview-panel" data-section="storyboard-episode-preview">
            {replacing ? (
              <div id="storyboard-episode-compare-panel" data-section="storyboard-episode-compare" className="pe-vb-row">
                <figure id="storyboard-episode-compare-current"><figcaption className="pe-muted">Current</figcaption>
                  <video id="storyboard-episode-compare-current-video" src={row.mediaUrl} controls playsInline preload="metadata" style={{ width: '100%', maxWidth: 240, borderRadius: 8 }} />
                </figure>
                <figure id="storyboard-episode-compare-new"><figcaption className="pe-muted">New v{String(newV).padStart(2, '0')}</figcaption>
                  {episodeUrl ? <video id="storyboard-episode-preview-video" src={episodeUrl} controls playsInline preload="metadata" style={{ width: '100%', maxWidth: 240, borderRadius: 8 }} /> : <p id="storyboard-episode-preview-loading" className="pe-muted">Loading the new version...</p>}
                </figure>
              </div>
            ) : episodeUrl ? <video id="storyboard-episode-preview-video" src={episodeUrl} controls playsInline preload="metadata" style={{ width: '100%', maxWidth: 360, borderRadius: 8 }} /> : <p id="storyboard-episode-preview-loading" className="pe-muted">Loading the rendered video preview...</p>}
            <p id="storyboard-episode-preview-caption" className="pe-muted">Rendered episode {storyboard.episode.episodeId}. Approving puts this video on the post{replacing ? ' and replaces the current one' : ''}.</p>
          </div>
        ) : null}
        {storyboard?.frames?.length ? (
          <div id="video-brief-v2-storyboard-frames-grid" className="pe-v2-frames">
            {storyboard.frames.map((fr, i) => (
              <figure id={`video-brief-v2-storyboard-frame-${i + 1}`} key={`${fr.url}-${i}`} className="pe-v2-frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fr.url} alt={fr.label} loading="lazy" />
                <figcaption><strong>{i + 1}. {fr.label}</strong>{fr.note ? <span className="pe-muted"> {fr.note}</span> : null}</figcaption>
                {storyboard.status === 'ready' ? (
                  <textarea id={`video-brief-v2-storyboard-frame-${i + 1}-note`} className="pe-text pe-v2-input" rows={2} maxLength={400} aria-label={`Your note on frame ${i + 1}`} placeholder="Note on this frame" value={frameNotes[i] || ''} readOnly={!canReview} onChange={(e) => { setFrameNotes((x) => ({ ...x, [i]: e.target.value })); setMsg(null); }} />
                ) : null}
              </figure>
            ))}
          </div>
        ) : null}
        {storyboard?.notes ? <p id="video-brief-v2-storyboard-notes" className="pe-muted">Notes: {storyboard.notes}</p> : null}
        {storyboard?.status === 'ready' ? (
          <>
            <label className="pe-vb-field" htmlFor="video-brief-v2-storyboard-review-notes">Your notes (needed to request changes)
              <textarea id="video-brief-v2-storyboard-review-notes" className="pe-text pe-v2-input" rows={3} maxLength={2000} value={reviewNotes} readOnly={!canReview} onChange={(e) => { setReviewNotes(e.target.value); setMsg(null); }} />
            </label>
            <div id="video-brief-v2-storyboard-actions-row" className="pe-vb-row">
              <button type="button" id="video-brief-v2-storyboard-approve-btn" className="pe-btn pe-btn-ghost" disabled={!canReview} onClick={() => review('approve')}>{replacing ? `Approve v${String(newV).padStart(2, '0')} + replace video` : storyboard.episode ? 'Approve storyboard + put video on post' : 'Approve storyboard'}</button>
              <button type="button" id="video-brief-v2-storyboard-changes-btn" className="pe-btn pe-btn-ghost" disabled={!canReview || !hasReviewNotes} onClick={() => review('changes')}>Request changes</button>
            </div>
          </>
        ) : null}
      </section>
      <VideoReviewPanel row={row} callSocial={callSocial} editable={editable} onRowPatch={onRowPatch} />
      {msg ? <p id="video-brief-v2-message" className={msg.tone === 'bad' ? 'pe-over' : 'pe-muted'} role={msg.tone === 'bad' ? 'alert' : 'status'}>{msg.text}</p> : null}
      <p className="pe-muted">Saving never changes the post copy, approval or schedule. Approving a v2 brief asks for a storyboard; it does not render a video.</p>
    </div>
  );
}
