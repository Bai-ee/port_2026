// Shared contract. Every module codes against this file. Do not change it without telling the orchestrator.
import type { Container, Texture } from 'pixi.js';

/** Fixed logical stage. All object positions are in these "stage coordinates". */
export const STAGE_W = 1024;
export const STAGE_H = 768;

/** Draw order, back to front. Every layer sits at (0,0), scale 1 inside the world container,
 *  so stage coordinates == layer-local coordinates. */
export const LAYERS = ['background', 'fixtures', 'play', 'foreground', 'drag'] as const;
export type LayerName = (typeof LAYERS)[number];

export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }

export interface DropZoneDef {
  /** Tags an object must have (any one) to be accepted. */
  accepts: string[];
  /** Key into the interaction registry: 'sit' | 'attach' | 'place'. */
  action: string;
  /** Hit rectangle, RELATIVE to the owning object's stage position. */
  rect: Rect;
  /** Snap point, RELATIVE to the owning object's stage position (sit). */
  snap?: Point;
  /** Higher wins when zones overlap. Tie -> nearest zone centre. Default 0. */
  priority?: number;
  /** Max simultaneous occupants (sit / attach). Default unlimited. */
  capacity?: number;
}

export interface SceneObjectDefinition {
  id: string;
  type: 'character' | 'prop' | 'furniture';
  /** Asset id of the single sprite, OR use `sprites` for multi-state objects. */
  sprite?: string;
  /** state name -> asset id, e.g. { standing: 'kid_a_stand', sitting: 'kid_a_sit' } or { off, on }. */
  sprites?: Record<string, string>;
  /** Initial key of `sprites`. Defaults to the first key. */
  initialState?: string;
  /** Extra piece drawn in the 'foreground' layer at the same position (e.g. chair front edge). */
  frontSprite?: string;
  x: number;
  y: number;
  scale?: number;
  /** Sprite anchor. Default: characters & furniture {0.5, 1} (feet / base), props {0.5, 0.5}. */
  anchor?: Point;
  /** Home layer. Default: furniture 'fixtures', everything else 'play'. */
  layer?: LayerName;
  draggable?: boolean;
  /** Tap handler key into the registry: 'toggle' | 'react'. */
  tapAction?: string;
  tags?: string[];
  /** Extra pixels added around the sprite for touch hit-testing (small props). */
  hitPad?: number;
  dropZone?: DropZoneDef;
  /** Characters: where a carried prop sits, relative to the character's position. */
  attachOffset?: Point;
}

export interface SceneDefinition {
  id: string;
  /** Bump when object ids / layout change so old saves are discarded. */
  version: number;
  /** Asset id of the full-stage background. */
  background: string;
  objects: SceneObjectDefinition[];
}

/** Mutable runtime state of one object. Kept separate from the definition. JSON-serialisable. */
export interface ObjectState {
  /** Stage coordinates. For an attached prop this is its last free position (ignored while attached). */
  x: number;
  y: number;
  /** Current key of def.sprites ('' when the object has a single sprite). */
  state: string;
  /** Character: id of furniture it is seated on. */
  seatedOn: string | null;
  /** Prop: id of the character carrying it. */
  attachedTo: string | null;
  /** Prop: id of the furniture surface it rests on. */
  placedOn: string | null;
}

export interface SaveSnapshot {
  saveVersion: 1;
  sceneId: string;
  sceneVersion: number;
  objects: Record<string, ObjectState>;
}

export interface IGameObject {
  readonly def: SceneObjectDefinition;
  /** Outer container, always scale 1 (free for feedback tweens). Holds the sprite and any carried props.
   *  eventMode 'static' when def.draggable or def.tapAction; hitArea includes def.hitPad. */
  readonly view: Container;
  readonly state: ObjectState;
  hasTag(tag: string): boolean;
  /** Swap texture to def.sprites[name]; no-op + console.warn if the state does not exist. */
  setState(name: string): void;
  /** Set stage position (state.x/y) and move the view. Must not be called while attached. */
  setPosition(x: number, y: number): void;
}

export interface IRoomScene {
  readonly def: SceneDefinition;
  /** Container holding the five layers; the Game adds it to its scaled world container. */
  readonly root: Container;
  readonly objects: ReadonlyMap<string, IGameObject>;
  get(id: string): IGameObject | undefined;
  /** Reparent obj.view to a layer keeping the same stage position, on top of that layer.
   *  If the object was attached, the caller must have called detach() first. */
  moveToLayer(obj: IGameObject, layer: LayerName): void;
  /** Home layer from the definition (see SceneObjectDefinition.layer). */
  homeLayer(obj: IGameObject): LayerName;
  /** Make prop a child of holder.view at holder.def.attachOffset; sets prop.state.attachedTo. */
  attach(prop: IGameObject, holder: IGameObject): void;
  /** Undo attach: prop goes to `layer` at its current apparent stage position (state.x/y updated);
   *  clears attachedTo. */
  detach(prop: IGameObject, layer: LayerName): void;
  /** Objects whose state.attachedTo / seatedOn / placedOn === id. */
  attachedTo(id: string): IGameObject[];
  seatedOn(id: string): IGameObject[];
  /** A drop zone's rectangle in stage coordinates (owner position + zone.rect). Follows carried owners. */
  zoneRect(owner: IGameObject): Rect | null;
  snapshot(): SaveSnapshot;
  /** Apply a saved snapshot (positions, states, attach/seat relations). Returns false and leaves the
   *  scene at defaults if the snapshot does not match this scene (id, version, unknown/missing ids). */
  restore(snap: SaveSnapshot): boolean;
  /** Back to the original definition. */
  reset(): void;
}

export type SoundName = 'pickup' | 'drop' | 'snap' | 'toggle' | 'pop';

export interface IAudio {
  /** Call from a user gesture (Play button) to create/resume the AudioContext. */
  unlock(): void;
  play(name: SoundName): void;
  muted: boolean;
}

/** Called by the InputController. Implemented by InteractionSystem. */
export interface IInteractions {
  /** Drag threshold passed: object is leaving its place. Stand up / detach, play pickup feedback.
   *  After this returns the object must be free (not attached) and in the 'drag' layer. */
  pickup(obj: IGameObject): void;
  /** Released (or cancelled) at its current position: resolve drop target or settle in place,
   *  return the object to its proper layer, then fire onChange. */
  drop(obj: IGameObject): void;
  /** Tap without drag. Runs def.tapAction if any, then fires onChange. */
  tap(obj: IGameObject): void;
  /** Fired after any meaningful state change (the Game saves here). */
  onChange: (() => void) | null;
}

/** Asset access (src/assets.ts). Asset ids are stable; only the manifest maps them to files. */
export type GetTexture = (assetId: string) => Texture;
