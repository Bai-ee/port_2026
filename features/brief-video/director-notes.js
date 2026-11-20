// director-notes.js — the Director's per-post verdict on a Creative Brief. Pure (also imported by the editor bundle).

const str = (v) => (v == null ? '' : String(v));

export const DIRECTOR_NOTES_STATUSES = ['sufficient', 'revise'];
export const DIRECTOR_NOTES_MAX = 2000;
export const DIRECTOR_ITEMS_MAX = 12;
/**
 * The Director's per-post verdict, videoBriefMeta.directorNotes = { status: 'sufficient'|'revise', notes (<=2000), items[] (<=12), at, by }.
 * Written by the Director directly in Firestore (no write tool); read-only here. null when absent or malformed. A brief save never clears it.
 */
export function directorNotesOf(post) {
  const d = post?.videoBriefMeta?.directorNotes;
  if (!d || typeof d !== 'object' || !DIRECTOR_NOTES_STATUSES.includes(d.status)) return null;
  const items = (Array.isArray(d.items) ? d.items : []).map((x) => str(x).trim()).filter(Boolean).slice(0, DIRECTOR_ITEMS_MAX);
  return { status: d.status, notes: str(d.notes).slice(0, DIRECTOR_NOTES_MAX), items, at: d.at || null, by: d.by ? str(d.by).slice(0, 200) : null };
}

/** Posts whose Director verdict is 'revise' (read only): what ChatGPT should fix and re-save. Newest brief update first. */
export function postsNeedingRevision(posts = []) {
  return (posts || []).filter((p) => p && directorNotesOf(p)?.status === 'revise')
    .map((p) => ({ postId: p.id || null, reviewOn: p.reviewOn || null, briefStatus: p.videoBriefMeta?.status || null, format: p.videoBriefMeta?.v2?.format || null, directorNotes: directorNotesOf(p) }))
    .sort((a, b) => str(b.directorNotes.at).localeCompare(str(a.directorNotes.at)));
}
