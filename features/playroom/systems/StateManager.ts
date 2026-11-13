import type { SaveSnapshot } from '../types';

const KEY = 'playroom.save.v1';

export class StateManager {
  load(): SaveSnapshot | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as SaveSnapshot;
      if (
        !s || typeof s !== 'object' || s.saveVersion !== 1 ||
        typeof s.sceneId !== 'string' || typeof s.sceneVersion !== 'number' ||
        !s.objects || typeof s.objects !== 'object' || Array.isArray(s.objects)
      ) return null;
      return s;
    } catch {
      return null;
    }
  }

  save(snap: SaveSnapshot): void {
    try { localStorage.setItem(KEY, JSON.stringify(snap)); } catch { /* storage unavailable */ }
  }

  clear(): void {
    try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  }
}
