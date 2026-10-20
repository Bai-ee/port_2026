// daily-slots.js - the client's daily posting "baseline slots", parsed from the confirmed Strategy doc's Formats
// section (synced from the approved Client Brain). Client-safe: pure, no I/O.
//
// Shape it reads (inside the Formats text):
//   - Daily slot baseline (Chicago time; ...):
//     - 07:00 Graphic Design: quote-react (after the 06:30 quote scan). [model: ...]
//     - All day: 5+ replies in the two lanes ...
//     - Strongest design asset on Sunday; ...
// Display only: the calendar shows these as awareness markers; nothing here schedules or fills a slot.

const HEADER_RE = /^-\s*Daily slot baseline\b/i;
const TIME_LEAD_RE = /^\d{1,2}\s*:\s*\d/;
const SLOT_RE = /^(\d{1,2}):(\d{2})\s+([^:]+?)\s*:\s*(.*)$/;
const REPLIES_RE = /^All day:\s*((\d+)\+?\s*replies\b.*)$/i;
const MODEL_TAG_RE = /\s*\[model\b[^\]]*\]\s*$/i;

const empty = () => ({ slots: [], replies: null, notes: [] });
const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, '  ').length;

/**
 * Parse the "Daily slot baseline" block of a Formats section.
 * @param {string} formatsText
 * @param {{tracks?: Array<{id:string,label:string}>}} [opts]  plan contentTracks; a slot's track label maps to its id
 *   (case-insensitive). Without tracks (or no match) trackId is null.
 * @returns {{slots:Array<{time:string,minutes:number,track:string,trackId:string|null,note:string}>,
 *            replies:{min:number,note:string}|null, notes:string[]}}
 */
export function parseDailySlots(formatsText, { tracks = [] } = {}) {
  const lines = String(formatsText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const at = lines.findIndex((l) => HEADER_RE.test(l.trim()));
  if (at < 0) return empty();
  const base = indentOf(lines[at]);
  const byLabel = new Map((Array.isArray(tracks) ? tracks : [])
    .filter((t) => t && typeof t.id === 'string' && typeof t.label === 'string')
    .map((t) => [t.label.trim().toLowerCase(), t.id]));
  const out = empty();
  for (const line of lines.slice(at + 1)) {
    if (!line.trim()) continue;
    if (indentOf(line) <= base) break; // the block ends at the next line that is not one of its children
    const text = line.trim().replace(/^[-*]\s*/, '');
    if (!text) continue;
    const replies = REPLIES_RE.exec(text);
    if (replies) { out.replies = { min: Number(replies[2]), note: replies[1].trim() }; continue; }
    const slot = SLOT_RE.exec(text);
    const h = Number(slot?.[1]);
    const m = Number(slot?.[2]);
    if (slot && h <= 23 && m <= 59) {
      const track = slot[3].trim();
      out.slots.push({
        time: `${String(h).padStart(2, '0')}:${slot[2]}`, minutes: h * 60 + m, track,
        trackId: byLabel.get(track.toLowerCase()) ?? null, note: slot[4].replace(MODEL_TAG_RE, '').trim(),
      });
      continue;
    }
    if (TIME_LEAD_RE.test(text)) continue; // a malformed slot line is dropped, never shown as a note
    out.notes.push(text);
  }
  out.slots.sort((a, b) => a.minutes - b.minutes);
  return out;
}

/** Baseline slots from a strategy doc: only a CONFIRMED doc counts (a draft / missing doc has no slots). */
export function baselineSlotsOf(doc, opts) {
  if (!doc?.confirmed) return empty();
  const formats = doc.sections?.formats;
  return typeof formats === 'string' ? parseDailySlots(formats, opts) : empty();
}
