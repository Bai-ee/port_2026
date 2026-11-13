import { Container, Sprite } from 'pixi.js';
import { getTexture } from '../assets';
import { GameObject } from '../objects/GameObject';
import {
  LAYERS, STAGE_H, STAGE_W,
  type IGameObject, type IRoomScene, type LayerName, type ObjectState, type Rect,
  type SaveSnapshot, type SceneDefinition,
} from '../types';

export class RoomScene implements IRoomScene {
  readonly root = new Container();
  readonly layers = {} as Record<LayerName, Container>;
  readonly objects = new Map<string, GameObject>();
  /** Foreground-layer sprites (e.g. chair front edge), keyed by owner id. */
  private fronts = new Map<string, Sprite>();

  constructor(readonly def: SceneDefinition) {
    for (const name of LAYERS) {
      const c = new Container();
      c.label = name;
      this.layers[name] = c;
      this.root.addChild(c);
    }
    this.layers.foreground.eventMode = 'none';
    const bg = new Sprite(getTexture(def.background));
    bg.width = STAGE_W;
    bg.height = STAGE_H;
    bg.eventMode = 'none';
    this.layers.background.addChild(bg);

    for (const d of def.objects) {
      const obj = new GameObject(d, getTexture);
      this.objects.set(d.id, obj);
      this.layers[this.homeLayer(obj)].addChild(obj.view);
      if (d.frontSprite) {
        const f = new Sprite(getTexture(d.frontSprite));
        const a = obj.sprite.anchor;
        f.anchor.set(a.x, a.y);
        f.scale.set(d.scale ?? 1);
        f.position.set(d.x, d.y);
        f.eventMode = 'none';
        this.layers.foreground.addChild(f);
        this.fronts.set(d.id, f);
      }
    }
  }

  get(id: string): GameObject | undefined {
    return this.objects.get(id);
  }

  homeLayer(obj: IGameObject): LayerName {
    return obj.def.layer ?? (obj.def.type === 'furniture' ? 'fixtures' : 'play');
  }

  moveToLayer(obj: IGameObject, layer: LayerName): void {
    if (obj.state.attachedTo) throw new Error(`moveToLayer: ${obj.def.id} is attached; detach() first`);
    this.layers[layer].addChild(obj.view); // addChild reparents and puts on top
    obj.view.position.set(obj.state.x, obj.state.y);
  }

  attach(prop: IGameObject, holder: IGameObject): void {
    const off = holder.def.attachOffset ?? { x: 0, y: 0 };
    holder.view.addChild(prop.view);
    prop.view.position.set(off.x, off.y);
    prop.state.attachedTo = holder.def.id;
    prop.state.placedOn = null;
  }

  detach(prop: IGameObject, layer: LayerName): void {
    const holder = prop.state.attachedTo ? this.objects.get(prop.state.attachedTo) : undefined;
    let x = prop.view.x;
    let y = prop.view.y;
    if (holder) {
      x += holder.view.x;
      y += holder.view.y;
    }
    prop.state.attachedTo = null;
    this.layers[layer].addChild(prop.view);
    (prop as GameObject).setPosition(x, y);
  }

  attachedTo(id: string): IGameObject[] {
    return [...this.objects.values()].filter((o) => o.state.attachedTo === id);
  }

  seatedOn(id: string): IGameObject[] {
    return [...this.objects.values()].filter((o) => o.state.seatedOn === id);
  }

  zoneRect(owner: IGameObject): Rect | null {
    const z = owner.def.dropZone;
    if (!z) return null;
    let x = owner.state.x;
    let y = owner.state.y;
    if (owner.state.attachedTo) {
      const h = this.objects.get(owner.state.attachedTo);
      if (h) {
        x = h.state.x + owner.view.x;
        y = h.state.y + owner.view.y;
      }
    }
    return { x: x + z.rect.x, y: y + z.rect.y, w: z.rect.w, h: z.rect.h };
  }

  snapshot(): SaveSnapshot {
    const objects: Record<string, ObjectState> = {};
    for (const [id, o] of this.objects) objects[id] = { ...o.state };
    return { saveVersion: 1, sceneId: this.def.id, sceneVersion: this.def.version, objects };
  }

  restore(snap: SaveSnapshot): boolean {
    if (!this.valid(snap)) {
      this.reset();
      return false;
    }
    this.reset();
    const ids = [...this.objects.keys()];
    for (const id of ids) {
      const o = this.objects.get(id)!;
      const s = snap.objects[id];
      if (s.state !== '') o.setState(s.state);
      o.setPosition(s.x, s.y);
      o.state.seatedOn = s.seatedOn;
      o.state.placedOn = s.placedOn;
    }
    for (const id of ids) {
      const holderId = snap.objects[id].attachedTo;
      if (holderId) this.attach(this.objects.get(id)!, this.objects.get(holderId)!);
    }
    return true;
  }

  reset(): void {
    for (const o of this.objects.values()) {
      if (o.state.attachedTo) this.detach(o, 'play');
    }
    for (const o of this.objects.values()) {
      const d = o.defaultState();
      Object.assign(o.state, d);
      if (o.def.sprites) o.setState(d.state);
      this.layers[this.homeLayer(o)].addChild(o.view);
      o.setPosition(d.x, d.y);
    }
  }

  private valid(snap: SaveSnapshot): boolean {
    try {
      if (!snap || snap.saveVersion !== 1 || snap.sceneId !== this.def.id || snap.sceneVersion !== this.def.version) return false;
      const saved = snap.objects;
      if (!saved || typeof saved !== 'object') return false;
      const keys = Object.keys(saved);
      if (keys.length !== this.objects.size || !keys.every((k) => this.objects.has(k))) return false;
      for (const k of keys) {
        const s = saved[k];
        const o = this.objects.get(k)!;
        if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) return false;
        if (o.def.sprites ? !(s.state in o.def.sprites) : s.state !== '') return false;
        for (const rel of [s.seatedOn, s.attachedTo, s.placedOn]) {
          if (rel !== null && (typeof rel !== 'string' || !this.objects.has(rel))) return false;
        }
        if (s.attachedTo === k) return false;
      }
      return true;
    } catch {
      return false;
    }
  }
}
