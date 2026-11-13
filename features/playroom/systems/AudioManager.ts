import type { IAudio, SoundName } from '../types';

const KEY = 'playroom.muted';

interface Blip { type: OscillatorType; f0: number; f1: number; dur: number; vol: number }

const BLIPS: Record<SoundName, Blip> = {
  pickup: { type: 'sine', f0: 440, f1: 660, dur: 0.1, vol: 0.25 },
  drop: { type: 'triangle', f0: 300, f1: 180, dur: 0.14, vol: 0.3 },
  snap: { type: 'square', f0: 700, f1: 900, dur: 0.07, vol: 0.12 },
  toggle: { type: 'triangle', f0: 520, f1: 780, dur: 0.12, vol: 0.25 },
  pop: { type: 'sine', f0: 900, f1: 400, dur: 0.09, vol: 0.28 },
};

export class AudioManager implements IAudio {
  private ctx: AudioContext | null = null;
  private _muted = false;

  constructor() {
    try { this._muted = localStorage.getItem(KEY) === '1'; } catch { /* ignore */ }
  }

  get muted(): boolean { return this._muted; }
  set muted(v: boolean) {
    this._muted = v;
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* ignore */ }
  }

  unlock(): void {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
      }
      if (this.ctx.state !== 'running') void this.ctx.resume();
    } catch { /* audio unavailable */ }
  }

  destroy(): void {
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => { /* ignore */ });
  }

  play(name: SoundName): void {
    const ctx = this.ctx;
    if (this._muted || !ctx || ctx.state !== 'running') return;
    const b = BLIPS[name];
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = b.type;
    osc.frequency.setValueAtTime(b.f0, t);
    osc.frequency.exponentialRampToValueAtTime(b.f1, t + b.dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(b.vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + b.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + b.dur + 0.02);
  }
}
