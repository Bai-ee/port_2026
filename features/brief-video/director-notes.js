// director-notes.js — the acceptance loop between the brief writer (ChatGPT) and the Director. Pure (also imported by the editor bundle).
// videoBriefMeta.directorNotes = { status: 'pending'|'revise'|'accepted', notes (<=2000) | null, items[] (<=12), at, by, briefHash }.
// A v2 save that changes the brief resets it to 'pending' (new briefHash), so an old verdict never sticks to a new version.
// The Director writes 'revise' / 'accepted' directly in Firestore (no write tool), echoing the briefHash it reviewed.

const str = (v) => (v == null ? '' : String(v));

export const DIRECTOR_NOTES_STATUSES = ['pending', 'revise', 'accepted'];
export const DIRECTOR_NOTES_MAX = 2000;
export const DIRECTOR_ITEMS_MAX = 12;

/** Short stable hash (FNV-1a, 8 hex) of a normalised v2 brief; no crypto so the editor bundle can use it. */
export function briefHashOf(v2) {
  const s = JSON.stringify(v2 ?? null);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** The reset written on every v2 save that changes the brief. */
export const pendingDirectorNotes = (v2, { now = new Date().toISOString() } = {}) => ({ status: 'pending', notes: null, items: [], at: now, by: null, briefHash: briefHashOf(v2) });

/** Read the verdict (null when absent/malformed). `stale` = it reviewed a different version of the v2 than the one saved now. */
export function directorNotesOf(post) {
  const d = post?.videoBriefMeta?.directorNotes;
  if (!d || typeof d !== 'object' || !DIRECTOR_NOTES_STATUSES.includes(d.status)) return null;
  const items = (Array.isArray(d.items) ? d.items : []).map((x) => str(x).trim()).filter(Boolean).slice(0, DIRECTOR_ITEMS_MAX);
  const v2 = post?.videoBriefMeta?.v2;
  const briefHash = d.briefHash ? str(d.briefHash) : null;
  return {
    status: d.status, notes: d.notes ? str(d.notes).slice(0, DIRECTOR_NOTES_MAX) : null, items, at: d.at || null, by: d.by ? str(d.by).slice(0, 200) : null,
    briefHash, stale: Boolean(briefHash && v2 && briefHash !== briefHashOf(v2)),
  };
}

/** Short label for chips: "Director: accepted" / "Director: revise (n items)" / "Director: pending review". */
export function directorStatusLabel(dn) {
  if (!dn || dn.status === 'pending') return 'Director: pending review';
  if (dn.status === 'accepted') return 'Director: accepted';
  return `Director: revise (${dn.items.length} item${dn.items.length === 1 ? '' : 's'})`;
}

/** Posts of a client by Director status (read only). status null = all posts that have a verdict. Newest verdict first. */
export function postsByDirectorStatus(posts = [], status = null) {
  return (posts || []).filter((p) => p && directorNotesOf(p) && (!status || directorNotesOf(p).status === status))
    .map((p) => ({ postId: p.id || null, reviewOn: p.reviewOn || null, briefStatus: p.videoBriefMeta?.status || null, format: p.videoBriefMeta?.v2?.format || null, directorNotes: directorNotesOf(p) }))
    .sort((a, b) => str(b.directorNotes.at).localeCompare(str(a.directorNotes.at)));
}
