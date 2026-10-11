// Presentation strings shared by the dashboard panel and the --show CLI.
// Pure; tolerates old runs that carry no slot / strategySource.

/** 'D · 15:00 CT · quote-react · P1' — null when the suggestion has no slot (old runs). */
export function slotLabel(slot) {
  if (!slot?.letter) return null;
  return [slot.letter, slot.timeCT ? `${slot.timeCT} CT` : 'anytime today', slot.type, slot.pillar].filter(Boolean).join(' · ');
}

/** The reply slot has no clock time: 'anytime today', never 'anytime CT'. */
export function timingLine(s) {
  const t = s?.slot?.timeCT || s?.proposedSlot?.localTime;
  if (!t || t === 'anytime') return 'anytime today · suggestion only, not scheduled';
  return `proposed ${t} CT · suggestion only, not scheduled`;
}

/** 'gap-report 2026-10-10 · tier 1 · 3 authored/day' — null without a strategySource. */
export function strategySourceLine(src) {
  if (!src) return null;
  return `${src.mixSource || 'unknown mix'} · ${src.date || 'no date'} · tier ${src.tier ?? '?'} · ${src.authoredPerDay ?? '?'} authored/day`;
}

export const VOICE_LINE = 'voice: Seb rules, Brain not used';

/** Slots of a run in letter order, each marked filled or the gap reason. */
export function slotStatuses(run) {
  const filled = new Map((run?.suggestions || []).filter((s) => s.slot?.letter).map((s) => [s.slot.letter, s.slot]));
  const open = new Map();
  for (const g of run?.gaps || []) {
    const m = /^slot-unfilled:(.+)$/.exec(g.code || '');
    if (m && g.slot) open.set(m[1], { ...g.slot, reason: g.slot.fillReason || g.message });
  }
  return [...filled.entries(), ...open.entries()]
    .map(([letter, s]) => ({ letter, timeCT: s.timeCT ?? null, type: s.type, pillar: s.pillar ?? null, filled: filled.has(letter), reason: filled.has(letter) ? null : s.reason }))
    .sort((a, b) => a.letter.localeCompare(b.letter));
}
