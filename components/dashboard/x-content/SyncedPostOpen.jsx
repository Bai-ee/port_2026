'use client';

// POST level for a row shown from a synced client's calendar (features/social-posting/synced-calendar.js).
// Opening it makes (or reuses) THIS client's own copy of the post (`synced-adopt`), then swaps to that copy in the
// normal editor: copy, creative, X / Instagram, approve and schedule are all this client's. The source's post is
// never changed. Props: postId (the synced id), call(action, body), onRefresh, nav.

import React, { useEffect, useRef, useState } from 'react';
import LoadingRing from '../content-ui/ui/LoadingRing';
import { RetryError } from '../content-ui/Feedback.jsx';

export default function SyncedPostOpen({ postId, call, onRefresh, nav }) {
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const started = useRef(null);

  useEffect(() => {
    if (!postId || typeof call !== 'function' || started.current === `${postId}#${attempt}`) return;
    started.current = `${postId}#${attempt}`;
    let live = true;
    (async () => {
      setError('');
      try {
        const res = await call('synced-adopt', { postId });
        if (onRefresh) await onRefresh();
        if (live && res?.postId && nav?.openPost) nav.openPost(res.postId, { replace: true });
      } catch (err) {
        if (live) setError(err?.message || 'Could not open that post.');
      }
    })();
    return () => { live = false; };
  }, [postId, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  return error
    ? <RetryError id="synced-post-open-error" message={error} onRetry={() => setAttempt((n) => n + 1)} busy={false} />
    : <LoadingRing id="synced-post-open-loading" label="Opening this post for HITLOOP" minHeight={240} />;
}
