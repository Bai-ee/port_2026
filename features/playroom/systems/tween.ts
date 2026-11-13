import type { Container } from 'pixi.js';

export type Ease = (t: number) => number;
export const easeOut: Ease = (t) => 1 - (1 - t) * (1 - t);
export const easeInOut: Ease = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

interface Job { target: Record<string, any>; from: Record<string, number>; to: Record<string, number>; start: number; ms: number; ease: Ease; done?: () => void }

const jobs = new Set<Job>();
let raf = 0;

function step(now: number): void {
  raf = 0;
  for (const j of [...jobs]) {
    if (!jobs.has(j)) continue;
    const t = Math.min(1, (now - j.start) / j.ms);
    const k = j.ease(t);
    for (const key in j.to) j.target[key] = j.from[key]! + (j.to[key]! - j.from[key]!) * k;
    if (t >= 1) { jobs.delete(j); j.done?.(); }
  }
  if (jobs.size > 0) raf = requestAnimationFrame(step);
}

/** Tween numeric properties of target. Returns a cancel fn (leaves values where they are). */
export function tween(target: Record<string, any>, to: Record<string, number>, ms: number, ease: Ease = easeOut, done?: () => void): () => void {
  const from: Record<string, number> = {};
  for (const k in to) from[k] = target[k] as number;
  const job: Job = { target, from, to, start: performance.now(), ms: Math.max(1, ms), ease, done };
  jobs.add(job);
  if (!raf) raf = requestAnimationFrame(step);
  return () => { jobs.delete(job); };
}

const pops = new WeakMap<Container, () => void>();

/** Quick squash feedback: scale 1 -> 1.12 -> 1. Always ends at exactly 1. */
export function pop(view: Container): void {
  pops.get(view)?.();
  view.scale.set(1);
  const cancelUp = tween(view.scale, { x: 1.12, y: 1.12 }, 80, easeOut, () => {
    const cancelDown = tween(view.scale, { x: 1, y: 1 }, 120, easeInOut, () => { view.scale.set(1); pops.delete(view); });
    pops.set(view, () => { cancelDown(); view.scale.set(1); });
  });
  pops.set(view, () => { cancelUp(); view.scale.set(1); });
}

/** Cancel every running tween (used on teardown). */
export function cancelAllTweens(): void {
  jobs.clear();
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
}
