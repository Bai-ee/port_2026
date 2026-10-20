// "Copy + high-res": pure helpers + the creative resolver for the Telegram button. All I/O is injected (`deps`), so it
// runs against fakes in tests. Read-only except one deliberate case: a NAS thumbnail whose original is not staged yet
// queues staging through the same path as the dashboard's hires-media-use (useHiresMedia), remembering who is waiting.

/** Telegram fetches documents by URL up to 20 MB; bigger files go out as a download link. */
export const TELEGRAM_URL_FETCH_MAX_BYTES = 20 * 1024 * 1024;
const PLACEHOLDER_RE = /\[add your [^\]]*\]/i;

export const hasPlaceholder = (text) => PLACEHOLDER_RE.test(String(text ?? ''));

/** Self-reply text, whichever shape the post stores it in. */
export function selfReplyText(post) {
  const r = post?.selfReply;
  const t = typeof r === 'string' ? r : r?.text;
  return typeof t === 'string' && t.trim() ? t : '';
}

const slugOf = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

/** "<date>-<slug>.<ext>" for the original; ext from the storage path / content type, default jpg (mp4 for video). */
export function creativeFilename(post, media, { dateKey } = {}) {
  const src = String(media?.path || media?.url || '').split('?')[0];
  const fromPath = /\.(jpe?g|png|webp|gif|mp4|mov|m4v|webm)$/i.exec(src)?.[1]?.toLowerCase();
  const ext = fromPath || (media?.type === 'video' ? 'mp4' : 'jpg');
  const slug = slugOf(post?.title || post?.content) || 'post';
  return `${dateKey || 'post'}-${slug}.${ext}`;
}

/**
 * Best full-resolution media for a post.
 * deps: { findHires(postId, clientId)->findHiresMedia result, candidateMedia(candidateId, clientId)->{url,type,path,size?}|null,
 *   useHires({postId,candidateId,notify})->useHiresMedia result, currentMedia(post, clientId)->{url,type,path,size?}|null }
 * opts: { clientId, notify, stage=true } (stage:false never queues anything: used by the follow-up send).
 * @returns {Promise<{state:'ready',media,source}|{state:'staging',workerOnline,note}|{state:'none',suggestion?}>} plus `notice` text when a hires attempt failed.
 */
export async function resolveCreativeMedia(deps, post, { clientId = post?.clientId, notify = null, stage = true } = {}) {
  let cur = null;
  if (post?.mediaUrl || post?.mediaStoragePath) cur = (await deps.currentMedia?.(post, clientId).catch(() => null)) || null;
  let found = null;
  if (post?.packageId && deps.findHires) found = await deps.findHires(post.id, clientId).catch(() => null);
  // A thumbnail post looks for a larger copy; a NAS draft with no media at all needs its own original off the drive.
  const cands = found?.ok && (found.target?.isThumbnail || !cur) ? (found.candidates || []) : [];
  let notice = null;
  if (cands.length) {
    const staged = cands.find((c) => c.staged);
    if (staged) {
      const m = await deps.candidateMedia(staged.id, clientId).catch(() => null);
      if (m) return { state: 'ready', media: m, source: 'hires' };
    } else if (stage && deps.useHires) {
      const best = cands.find((c) => c.id === found.bestId) || cands[0];
      try {
        const r = await deps.useHires({ postId: post.id, candidateId: best.id, notify, clientId });
        if (r?.status === 'staging') return { state: 'staging', workerOnline: r.workerOnline ?? null, note: r.note || null };
        if (r?.status === 'done') {
          const m = await deps.candidateMedia(best.id, clientId).catch(() => null);
          if (m) return { state: 'ready', media: m, source: 'hires' };
        }
      } catch (e) {
        notice = `Could not fetch the original from the drive: ${String(e?.message || 'error').slice(0, 120)}`;
      }
    }
  }
  if (cur) return { state: 'ready', media: cur, source: 'post', ...(notice ? { notice } : {}) };
  const hint = cands[0] || (found?.ok ? (found.candidates || [])[0] : null);
  return { state: 'none', ...(hint ? { suggestion: hint.title || hint.id } : {}), ...(notice ? { notice } : {}) };
}

/**
 * Queue the Telegram follow-up for a post whose original just landed (called from the stage-COMPLETE hook).
 * Binding/access are re-checked when the outbox item is sent, not here.
 */
export async function enqueueCreativeFollowup({ db, store, now = Date.now() }, waiting, { candidateId } = {}) {
  const n = waiting?.notify;
  if (!n || !waiting.postId || !waiting.clientId) return { skipped: true };
  return store.enqueueMessage(db, {
    clientId: waiting.clientId, chatId: n.chatId,
    dedupKey: `creative:${waiting.postId}:${candidateId}:${n.telegramUserId}:${n.bindingVersion}:${waiting.at || ''}`,
    kind: 'creative', payload: { kind: 'creative', postId: waiting.postId, telegramUserId: n.telegramUserId, bindingVersion: n.bindingVersion },
    now,
  });
}
