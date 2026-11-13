import { STAGE_H, STAGE_W } from '../types';
import type { IAudio, IGameObject, IInteractions, IRoomScene, Rect, SoundName } from '../types';
import { pop } from './tween';

/** Characters are tested this many px above their feet so seats are forgiving. */
const CHARACTER_DROP_LIFT = 40;
const EDGE_MARGIN = 24;

type DropHandler = (obj: IGameObject, owner: IGameObject, rect: Rect) => void;
type TapHandler = (obj: IGameObject) => void;

export class InteractionSystem implements IInteractions {
  onChange: (() => void) | null = null;

  private dropActions: Record<string, DropHandler>;
  private tapActions: Record<string, TapHandler>;

  constructor(private scene: IRoomScene, private audio: IAudio) {
    this.dropActions = {
      sit: (obj, owner) => {
        const snap = owner.def.dropZone?.snap ?? { x: 0, y: 0 };
        obj.setPosition(owner.state.x + snap.x, owner.state.y + snap.y);
        obj.setState('sitting');
        obj.state.seatedOn = owner.def.id;
        this.scene.moveToLayer(obj, this.scene.homeLayer(obj));
      },
      attach: (obj, owner) => this.scene.attach(obj, owner),
      place: (obj, owner, rect) => {
        // rect centre line = table-top surface; prop's visual bottom sits on it
        obj.setPosition(Math.min(rect.x + rect.w, Math.max(rect.x, obj.state.x)), rect.y + rect.h / 2 - obj.view.getLocalBounds().maxY);
        obj.state.placedOn = owner.def.id;
        this.scene.moveToLayer(obj, this.scene.homeLayer(obj));
      },
    };
    this.tapActions = {
      toggle: (obj) => {
        const keys = Object.keys(obj.def.sprites ?? {});
        if (keys.length < 2) return;
        obj.setState(keys[(keys.indexOf(obj.state.state) + 1) % keys.length]!);
        this.sound('toggle');
      },
      react: (obj) => { pop(obj.view); this.sound('pop'); },
    };
  }

  private sound(n: SoundName): void { this.audio.play(n); }

  pickup(obj: IGameObject): void {
    const s = obj.state;
    if (s.seatedOn) { s.seatedOn = null; obj.setState('standing'); }
    if (s.attachedTo) this.scene.detach(obj, 'drag');
    s.placedOn = null;
    this.scene.moveToLayer(obj, 'drag');
    this.sound('pickup');
  }

  drop(obj: IGameObject): void {
    const isChar = obj.def.type === 'character';
    const px = obj.state.x;
    const py = obj.state.y - (isChar ? CHARACTER_DROP_LIFT : 0);
    let best: { owner: IGameObject; rect: Rect; prio: number; dist: number } | null = null;

    for (const owner of this.scene.objects.values()) {
      const z = owner.def.dropZone;
      if (!z || owner === obj || owner.state.attachedTo === obj.def.id) continue;
      if (!z.accepts.some((t) => obj.hasTag(t))) continue;
      if (z.capacity !== undefined) {
        const n = z.action === 'sit' ? this.scene.seatedOn(owner.def.id).length
          : z.action === 'attach' ? this.scene.attachedTo(owner.def.id).length : 0;
        if (n >= z.capacity) continue;
      }
      if (!this.dropActions[z.action]) continue;
      const r = this.scene.zoneRect(owner);
      if (!r || px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) continue;
      const prio = z.priority ?? 0;
      const dist = Math.hypot(px - (r.x + r.w / 2), py - (r.y + r.h / 2));
      if (!best || prio > best.prio || (prio === best.prio && dist < best.dist)) best = { owner, rect: r, prio, dist };
    }

    if (best) {
      this.dropActions[best.owner.def.dropZone!.action]!(obj, best.owner, best.rect);
      pop(obj.view);
      this.sound('snap');
    } else {
      obj.setPosition(
        Math.min(STAGE_W - EDGE_MARGIN, Math.max(EDGE_MARGIN, obj.state.x)),
        Math.min(STAGE_H - EDGE_MARGIN, Math.max(EDGE_MARGIN, obj.state.y)),
      );
      this.scene.moveToLayer(obj, this.scene.homeLayer(obj));
      this.sound('drop');
    }
    this.onChange?.();
  }

  tap(obj: IGameObject): void {
    const a = obj.def.tapAction;
    if (a) this.tapActions[a]?.(obj);
    this.onChange?.();
  }
}
