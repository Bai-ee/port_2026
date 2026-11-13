import type { Application, Container, FederatedPointerEvent } from 'pixi.js';
import type { IGameObject, IInteractions, IRoomScene } from '../types';

/** Movement (CSS px, screen space) before a press becomes a drag. */
const DRAG_THRESHOLD = 8;

interface DragSession {
  obj: IGameObject;
  startX: number; startY: number; // client px
  offX: number; offY: number;     // stage px: object pos minus pointer pos
  dragging: boolean;
}

export class InputController {
  private sessions = new Map<number, DragSession>();
  private owned = new Set<IGameObject>();
  private cleanups: (() => void)[] = [];

  constructor(
    app: Application,
    private world: Container,
    scene: IRoomScene,
    private interactions: IInteractions,
  ) {
    for (const obj of scene.objects.values()) {
      const down = (e: FederatedPointerEvent) => this.onDown(obj, e);
      obj.view.on('pointerdown', down);
      this.cleanups.push(() => obj.view.off('pointerdown', down));
    }
    const stage = app.stage;
    stage.eventMode = 'static';
    stage.hitArea = app.screen;
    const move = (e: FederatedPointerEvent) => this.onMove(e);
    const up = (e: FederatedPointerEvent) => this.end(e.pointerId);
    stage.on('pointermove', move);
    stage.on('pointerup', up);
    stage.on('pointerupoutside', up);
    stage.on('pointercancel', up);
    this.cleanups.push(() => {
      stage.off('pointermove', move); stage.off('pointerup', up);
      stage.off('pointerupoutside', up); stage.off('pointercancel', up);
    });

    const winUp = (e: PointerEvent) => this.end(e.pointerId);
    const winBlur = () => this.cancelAll();
    window.addEventListener('pointerup', winUp);
    window.addEventListener('pointercancel', winUp);
    window.addEventListener('blur', winBlur);
    this.cleanups.push(() => {
      window.removeEventListener('pointerup', winUp);
      window.removeEventListener('pointercancel', winUp);
      window.removeEventListener('blur', winBlur);
    });
  }

  private onDown(obj: IGameObject, e: FederatedPointerEvent): void {
    e.stopPropagation();
    if (this.sessions.has(e.pointerId) || this.owned.has(obj)) return;
    const p = this.world.toLocal(e.global);
    const a = this.world.toLocal(obj.view.getGlobalPosition());
    this.sessions.set(e.pointerId, {
      obj, startX: e.clientX, startY: e.clientY,
      offX: a.x - p.x, offY: a.y - p.y, dragging: false,
    });
    this.owned.add(obj);
  }

  private onMove(e: FederatedPointerEvent): void {
    const s = this.sessions.get(e.pointerId);
    if (!s) return;
    if (!s.dragging) {
      if (!s.obj.def.draggable) return;
      if (Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < DRAG_THRESHOLD) return;
      s.dragging = true;
      this.interactions.pickup(s.obj);
    }
    const p = this.world.toLocal(e.global);
    s.obj.setPosition(p.x + s.offX, p.y + s.offY);
  }

  private end(pointerId: number): void {
    const s = this.sessions.get(pointerId);
    if (!s) return;
    this.sessions.delete(pointerId);
    this.owned.delete(s.obj);
    if (s.dragging) this.interactions.drop(s.obj);
    else this.interactions.tap(s.obj);
  }

  /** Drop everything in progress (Reset / page hide). Pending taps are discarded. */
  cancelAll(): void {
    for (const s of this.sessions.values()) if (s.dragging) this.interactions.drop(s.obj);
    this.sessions.clear();
    this.owned.clear();
  }

  destroy(): void {
    this.cancelAll();
    for (const c of this.cleanups) c();
    this.cleanups = [];
  }
}
