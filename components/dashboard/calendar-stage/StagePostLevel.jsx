'use client';

// POST level of the Calendar Stage: the single View & Edit Post editor (PostEditor) plus the two things the stage
// adds around it:
//   1. a leave guard (inline "Unsaved edits - leave anyway?" prompt, no window.confirm) registered with nav.setLeaveGuard,
//   2. "Add / change creative": CreativePicker rendered INLINE in the editor's picker slot; a pick calls the
//      `post-attach-item-media` quote-targets action (server: swapPostMedia), then the editor adopts the returned row.
// Nothing here opens an overlay. Saving / approving / scheduling all stay inside PostEditor's own calls.
//
// Props: postId, row (calendar row if the month is loaded, else null), calendarReady, stage { nav, getIdToken, clientId,
// clientName, clientHandle, avatarUrl, timeZone }, onRefresh (reload the calendar after a change), dayGroups
// ([{ date, rows }] as the Day view lists them; feeds the post carousel).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import LoadingRing from '../content-ui/ui/LoadingRing';
import PostEditor from '../x-content/PostEditor.jsx';
import PostCarousel from './PostCarousel.jsx';
import { pickDayPostIds } from './post-carousel-model.js';
import CreativePicker from '../x-content/CreativePicker.jsx';
import { MEDIA_CHANGED_MESSAGE } from '../x-content/post-editor-model.js';
import { useMarketingContentCall } from '../marketing/useMarketingContentCall.js';

export default function StagePostLevel({ postId, row, calendarReady, stage, onRefresh, dayGroups }) {
  const { nav, getIdToken, clientId, clientName, clientHandle, avatarUrl, timeZone } = stage;
  const { call } = useMarketingContentCall(getIdToken);

  // The editor keeps its own edits, so hand it ONE row per post (the calendar reloads after every save and must not reset it).
  const initialRow = useRef(undefined);
  if (initialRow.current === undefined && calendarReady) initialRow.current = row || null;
  const [attachedRow, setAttachedRow] = useState(null);
  const editorRow = attachedRow || initialRow.current || null;

  // ---- leave guard ----
  const dirtyRef = useRef(false);
  const pendingRef = useRef(null);
  const [leaveAction, setLeaveAction] = useState(null);
  const stayRef = useRef(null);
  const setGuard = nav.setLeaveGuard;
  useEffect(() => {
    const unregister = setGuard((action) => {
      if (!dirtyRef.current) return true;
      return new Promise((resolve) => {
        if (pendingRef.current) pendingRef.current(false);
        pendingRef.current = resolve;
        setLeaveAction(action || 'back');
      });
    });
    return () => {
      unregister();
      if (pendingRef.current) { pendingRef.current(false); pendingRef.current = null; }
    };
  }, [setGuard]);
  const answerLeave = (leave) => {
    const resolve = pendingRef.current;
    pendingRef.current = null;
    setLeaveAction(null);
    if (resolve) resolve(leave);
  };
  useEffect(() => {
    if (!leaveAction) return;
    const el = stayRef.current;
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
  }, [leaveAction]);
  const onDirtyChange = useCallback((d) => { dirtyRef.current = !!d; }, []);

  // ---- creative picker ----
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState(null); // { message, code, packageId }
  const [stageNote, setStageNote] = useState('');
  const [voidedNote, setVoidedNote] = useState(false);
  const realId = editorRow?.id || postId;

  const onPick = async (packageId) => {
    setAttachError(null);
    setStageNote('');
    if (dirtyRef.current) {
      setAttachError({ message: 'Save or discard your edits first, then change the creative.', code: 'dirty' });
      return;
    }
    setAttachBusy(true);
    try {
      const res = await call('post-attach-item-media', { postId: realId, packageId });
      if (res?.row) setAttachedRow({ ...(editorRow || {}), ...res.row });
      setVoidedNote(!!res?.approvalVoided);
      setPickerOpen(false);
      if (onRefresh) onRefresh();
    } catch (e) {
      const d = e?.data || {};
      setAttachError({ message: e?.message || 'Could not use that item.', code: d.code || null, packageId: d.packageId || packageId });
    } finally {
      setAttachBusy(false);
    }
  };

  const stageIt = async () => {
    const id = attachError?.packageId;
    if (!id) return;
    setAttachBusy(true);
    try {
      await call('nas-stage', { id });
      setStageNote('Copying it to staging. Pick it again in a minute.');
      setAttachError(null);
    } catch (e) {
      setAttachError({ ...attachError, message: e?.message || 'Could not start staging.' });
    } finally {
      setAttachBusy(false);
    }
  };

  // Escape closes the picker first (the stage's Escape only steps back when nothing handled it).
  const onKeyDown = (e) => {
    if (e.key === 'Escape' && pickerOpen) { e.preventDefault(); setPickerOpen(false); }
  };

  const pickerSlot = pickerOpen ? (
    <div id="calendar-stage-creative-picker-shell">
      <CreativePicker
        clientId={clientId}
        getIdToken={getIdToken}
        selectedPackageId={editorRow?.packageId || null}
        onPick={onPick}
        onCancel={() => { setPickerOpen(false); setAttachError(null); }}
      />
      {attachBusy ? <p id="calendar-stage-creative-busy" className="pe-muted" role="status">Attaching…</p> : null}
      {attachError ? (
        <div id="calendar-stage-creative-error" className="pe-note pe-note-bad" role="alert">
          <p>{attachError.message}</p>
          {attachError.code === 'needs-staging' && attachError.packageId ? (
            <button type="button" id="calendar-stage-creative-stage-button" className="pe-btn pe-btn-ghost" disabled={attachBusy} onClick={stageIt}>Stage it</button>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  if (!calendarReady && !editorRow) {
    return <LoadingRing id="calendar-stage-post-loading" label="Loading post" />;
  }

  return (
    <div id="calendar-stage-post-level" onKeyDown={onKeyDown}>
      <PostCarousel postId={realId} postIds={pickDayPostIds(dayGroups, stage.nav?.state?.date || null, realId)} nav={nav}>
      <PostEditor
        {...(editorRow ? { row: editorRow } : { postId })}
        clientId={clientId}
        clientName={clientName}
        clientHandle={clientHandle}
        avatarUrl={avatarUrl}
        getIdToken={getIdToken}
        timeZone={timeZone}
        loadRow={async (id) => {
          const res = await call('post-status', { postIds: [id], full: true });
          const p = res?.posts?.[0];
          if (!p) throw new Error('That post could not be found.');
          return p;
        }}
        onClose={() => nav.back()}
        onSaved={() => { setVoidedNote(false); if (onRefresh) onRefresh(); }}
        onDirtyChange={onDirtyChange}
        onPickCreative={() => { setAttachError(null); setStageNote(''); setPickerOpen(true); }}
        pickerSlot={pickerSlot}
      >
        {voidedNote ? <p id="calendar-stage-creative-voided-note" className="pe-note pe-note-info" role="status">{MEDIA_CHANGED_MESSAGE}</p> : null}
        {stageNote ? <p id="calendar-stage-creative-stage-note" className="pe-note pe-note-ok" role="status">{stageNote}</p> : null}
        {leaveAction ? (
          <div id="calendar-stage-leave-prompt" className="pe-note pe-note-warn" role="alertdialog" aria-label="Unsaved edits">
            <p>Unsaved edits. Leave anyway?</p>
            <div className="pe-btn-row">
              <button type="button" id="calendar-stage-leave-stay-button" ref={stayRef} className="pe-btn pe-btn-primary" onClick={() => answerLeave(false)}>Stay</button>
              <button type="button" id="calendar-stage-leave-confirm-button" className="pe-btn pe-btn-ghost" onClick={() => answerLeave(true)}>Leave anyway</button>
            </div>
          </div>
        ) : null}
      </PostEditor>
      </PostCarousel>
    </div>
  );
}
