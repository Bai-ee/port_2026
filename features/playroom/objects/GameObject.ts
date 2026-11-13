import { Container, Rectangle, Sprite } from 'pixi.js';
import type { GetTexture, IGameObject, ObjectState, SceneObjectDefinition } from '../types';

export class GameObject implements IGameObject {
  readonly view = new Container();
  readonly sprite: Sprite;
  readonly state: ObjectState;

  constructor(readonly def: SceneObjectDefinition, private getTexture: GetTexture) {
    this.state = this.defaultState();
    this.sprite = new Sprite(this.getTexture(this.assetFor(this.state.state)));
    const a = def.anchor ?? (def.type === 'prop' ? { x: 0.5, y: 0.5 } : { x: 0.5, y: 1 });
    this.sprite.anchor.set(a.x, a.y);
    this.sprite.scale.set(def.scale ?? 1);
    this.view.addChild(this.sprite);
    this.view.label = def.id;
    if (def.draggable || def.tapAction) {
      this.view.eventMode = 'static';
      this.view.cursor = 'pointer';
    }
    this.updateHitArea();
    this.view.position.set(this.state.x, this.state.y);
  }

  private assetFor(state: string): string {
    return this.def.sprites ? this.def.sprites[state] : this.def.sprite!;
  }

  defaultState(): ObjectState {
    const s = this.def.sprites ? (this.def.initialState ?? Object.keys(this.def.sprites)[0]) : '';
    return { x: this.def.x, y: this.def.y, state: s, seatedOn: null, attachedTo: null, placedOn: null };
  }

  hasTag(tag: string): boolean {
    return this.def.tags?.includes(tag) ?? false;
  }

  setState(name: string): void {
    if (!this.def.sprites || !(name in this.def.sprites)) {
      console.warn(`[${this.def.id}] unknown state "${name}"`);
      return;
    }
    this.state.state = name;
    this.sprite.texture = this.getTexture(this.def.sprites[name]);
    this.updateHitArea();
  }

  setPosition(x: number, y: number): void {
    this.state.x = x;
    this.state.y = y;
    this.view.position.set(x, y);
  }

  private updateHitArea(): void {
    const p = this.def.hitPad ?? 0;
    const b = this.sprite.getLocalBounds();
    this.view.hitArea = new Rectangle(b.x - p, b.y - p, b.width + 2 * p, b.height + 2 * p);
  }
}
