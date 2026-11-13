import { Application, Container, Graphics } from 'pixi.js';
import { STAGE_W, STAGE_H } from './types';
import { loadAssets } from './assets';
import { playroom } from './scenes/playroom';
import { RoomScene } from './scenes/RoomScene';
import { InteractionSystem } from './systems/InteractionSystem';
import { InputController } from './systems/InputController';
import { AudioManager } from './systems/AudioManager';
import { StateManager } from './systems/StateManager';
import { cancelAllTweens } from './systems/tween';

const BG = 0xf6e7d8; // matches --bg in game.css

export class Game {
  private readonly bars = new Graphics();
  private destroyed = false;
  private cleanups: (() => void)[] = [];

  private constructor(
    private readonly app: Application,
    readonly world: Container,
    readonly scene: RoomScene,
    private readonly input: InputController,
    private readonly audio: AudioManager,
    private readonly state: StateManager,
  ) {
    app.stage.addChild(this.bars);
    const layout = () => this.layout();
    app.renderer.on('resize', layout);
    this.cleanups.push(() => app.renderer.off('resize', layout));
    const refit = () => app.resize();
    window.addEventListener('orientationchange', refit);
    window.visualViewport?.addEventListener('resize', refit);
    const vv = window.visualViewport;
    this.cleanups.push(() => {
      window.removeEventListener('orientationchange', refit);
      vv?.removeEventListener('resize', refit);
    });
    layout();

    const onVis = () => {
      if (document.hidden) { this.input.cancelAll(); app.ticker.stop(); } else app.ticker.start();
    };
    document.addEventListener('visibilitychange', onVis);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVis));
  }

  static async create(mount: HTMLElement, onProgress: (p: number) => void): Promise<Game> {
    const app = new Application();
    await app.init({
      resizeTo: window,
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
      autoDensity: true,
      antialias: false,
      background: BG,
      preference: 'webgl',
    });
    mount.appendChild(app.canvas);
    const extra: (() => void)[] = [];
    const prevent = (e: Event) => e.preventDefault();
    for (const ev of ['contextmenu', 'gesturestart', 'dragstart']) {
      mount.addEventListener(ev, prevent);
      extra.push(() => mount.removeEventListener(ev, prevent));
    }

    try {
      await loadAssets(onProgress);
    } catch (err) {
      for (const c of extra) c();
      app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
      throw err;
    }
    const scene = new RoomScene(playroom);
    const state = new StateManager();
    const audio = new AudioManager();
    const snap = state.load();
    if (snap) scene.restore(snap);

    const world = new Container();
    world.addChild(scene.root);
    app.stage.addChild(world);

    const interactions = new InteractionSystem(scene, audio);
    interactions.onChange = () => state.save(scene.snapshot());
    const input = new InputController(app, world, scene, interactions);

    if (new URLSearchParams(location.search).has('fps')) {
      const el = document.createElement('div');
      el.id = 'fps';
      mount.appendChild(el);
      const timer = setInterval(() => { el.textContent = app.ticker.FPS.toFixed(0) + ' fps'; }, 500);
      extra.push(() => { clearInterval(timer); el.remove(); });
    }

    const game = new Game(app, world, scene, input, audio, state);
    game.cleanups.push(...extra);
    return game;
  }

  /** Fully stop the game and release listeners/DOM/audio. Idempotent. Cached textures are kept. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const c of this.cleanups) c();
    this.cleanups = [];
    this.input.destroy();
    this.audio.destroy();
    cancelAllTweens();
    this.app.ticker.stop();
    this.app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
  }

  start(): void { this.audio.unlock(); }

  reset(): void {
    this.input.cancelAll();
    this.scene.reset();
    this.state.clear();
  }

  toggleMute(): boolean {
    this.audio.muted = !this.audio.muted;
    return this.audio.muted;
  }

  get muted(): boolean { return this.audio.muted; }

  private layout(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    const s = Math.min(w / STAGE_W, h / STAGE_H);
    const ox = (w - STAGE_W * s) / 2;
    const oy = (h - STAGE_H * s) / 2;
    this.world.scale.set(s);
    this.world.position.set(ox, oy);
    // Opaque bars over the letterbox hide anything dragged past the stage edge.
    const pad = 4000;
    this.bars.clear()
      .rect(-pad, -pad, w + 2 * pad, oy + pad).rect(-pad, oy + STAGE_H * s, w + 2 * pad, h - oy - STAGE_H * s + pad)
      .rect(-pad, -pad, ox + pad, h + 2 * pad).rect(ox + STAGE_W * s, -pad, w - ox - STAGE_W * s + pad, h + 2 * pad)
      .fill(BG);
  }
}
