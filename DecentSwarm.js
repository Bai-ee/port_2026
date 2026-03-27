import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// 5×5 bitmap font — each value encodes 5 rows of 5 bits.
// Bit access: (bitmap >> (row * 5 + (4 - col))) & 1
// Row 0 = top, row 4 = bottom. Col 0 = left, col 4 = right.
const GLYPHS = {
  D: 30  | (17 << 5) | (17 << 10) | (17 << 15) | (30 << 20),  // XXXX. X...X X...X X...X XXXX.
  E: 31  | (16 << 5) | (30 << 10) | (16 << 15) | (31 << 20),  // XXXXX X.... XXXX. X.... XXXXX
  C: 14  | (16 << 5) | (16 << 10) | (16 << 15) | (14 << 20),  // .XXX. X.... X.... X.... .XXX.
  N: 17  | (25 << 5) | (21 << 10) | (19 << 15) | (17 << 20),  // X...X XX..X X.X.X X..XX X...X
  T: 31  | (4  << 5) | (4  << 10) | (4  << 15) | (4  << 20),  // XXXXX ..X.. ..X.. ..X.. ..X..
  R: 30  | (17 << 5) | (30 << 10) | (20 << 15) | (18 << 20),  // XXXX. X...X XXXX. X.X.. X..X.
  A: 14  | (17 << 5) | (31 << 10) | (17 << 15) | (17 << 20),  // .XXX. X...X XXXXX X...X X...X
  L: 16  | (16 << 5) | (16 << 10) | (16 << 15) | (31 << 20),  // X.... X.... X.... X.... XXXXX
  I: 31  | (4  << 5) | (4  << 10) | (4  << 15) | (31 << 20),  // XXXXX ..X.. ..X.. ..X.. XXXXX
  Z: 31  | (2  << 5) | (4  << 10) | (8  << 15) | (31 << 20),  // XXXXX ...X. ..X.. .X... XXXXX
  O: 14  | (17 << 5) | (17 << 10) | (17 << 15) | (14 << 20),  // .XXX. X...X X...X X...X .XXX.
  S: 14  | (16 << 5) | (14 << 10) | (1  << 15) | (14 << 20),  // .XXX. X.... .XXX. ....X .XXX.
  Y: 17  | (17 << 5) | (14 << 10) | (4  << 15) | (4  << 20),  // X...X X...X .XXX. ..X.. ..X..
  M: 17  | (27 << 5) | (21 << 10) | (17 << 15) | (17 << 20),  // X...X XX.XX X.X.X X...X X...X
};

const LINE1 = 'DECENTRALIZED';
const LINE2 = 'ECOSYSTEMS';
const FULL  = LINE1 + LINE2; // 23 chars

export class DecentSwarm {
  constructor(container, count = 20000) {
    this.count     = count;
    this.container = container;
    this.speedMult = 1;
    this._running  = false;
    this._frameId  = 0;

    this._focus      = 0.96;
    this._scale      = 1.57;
    this._morphSpeed = 1.65;

    const w = container.clientWidth  || 300;
    const h = container.clientHeight || 200;

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 2000);
    this.camera.position.set(0, 0, 100);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(w, h, false);
    this.container.appendChild(this.renderer.domElement);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.5, 0.4, 0.85);
    bloomPass.strength = 1.8;
    bloomPass.radius   = 0.4;
    bloomPass.threshold = 0;
    this.composer.addPass(bloomPass);

    this.dummy  = new THREE.Object3D();
    this.color  = new THREE.Color();
    this.target = new THREE.Vector3();
    this.pColor = new THREE.Color();

    this.geometry = new THREE.TetrahedronGeometry(0.25);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.mesh);

    this.positions = [];
    for (let i = 0; i < this.count; i++) {
      this.positions.push(new THREE.Vector3(
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 100,
        (Math.random() - 0.5) * 100
      ));
      this.mesh.setColorAt(i, this.color.setHex(0x00ff88));
    }

    this.clock   = new THREE.Clock();
    this.animate = this.animate.bind(this);
  }

  updateParams({ focus, scale, morphSpeed }) {
    if (focus      !== undefined) this._focus      = focus;
    if (scale      !== undefined) this._scale      = scale;
    if (morphSpeed !== undefined) this._morphSpeed = morphSpeed;
  }

  setBackground(hexColor, alpha) {
    this.renderer.setClearColor(new THREE.Color(hexColor), alpha);
  }

  setSize(w, h) {
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._frameId = requestAnimationFrame(this.animate);
  }

  pause() {
    this._running = false;
    if (this._frameId) { cancelAnimationFrame(this._frameId); this._frameId = 0; }
  }

  animate() {
    if (!this._running) return;
    this._frameId = requestAnimationFrame(this.animate);

    const time       = this.clock.getElapsedTime() * this.speedMult;
    const count      = this.count;
    const charCount  = FULL.length; // 23
    const pPerChar   = count / charCount;
    const focusVal   = this._focus;
    const scale      = this._scale;
    const morphSpeed = this._morphSpeed;

    for (let i = 0; i < count; i++) {
      const charIdx = Math.floor((i / count) * charCount);
      const localI  = i - charIdx * pPerChar;
      const tLocal  = localI / pPerChar;

      // Two-line layout
      const isLine2  = charIdx >= LINE1.length;
      const lineIdx  = isLine2 ? charIdx - LINE1.length : charIdx;
      const lineLen  = isLine2 ? LINE2.length : LINE1.length;
      const lineCx   = (lineLen - 1) / 2;
      const lineY    = isLine2 ? -6 : 6;

      // Character bitmap lookup
      const glyph = GLYPHS[FULL[charIdx]] ?? 0;

      const cellIdx    = Math.floor(localI) % 25;
      const row        = Math.floor(cellIdx / 5);
      const col        = cellIdx % 5;
      const activeBit  = (glyph >> (row * 5 + (4 - col))) & 1;
      const isForeground = activeBit > 0;

      const morph = (Math.sin(time * morphSpeed) + 1.0) * 0.5;

      // Text target position
      const drift = Math.sin(time * 3.0 + tLocal * 150.0) * 0.1;
      const tx = (lineIdx - lineCx) * 7.0 + (col - 2.0) * 1.2 + drift;
      const ty = lineY + (2.0 - row) * 1.2 + drift;
      const tz = Math.sin(time * 2.0 + tx * 0.1) * 1.5;

      // Helix background position
      const hTheta  = tLocal * Math.PI * 2.0 * 25.0 + time * 1.5;
      const hRadius = 5.0 + Math.sin(time * 0.8 + charIdx) * 2.0;
      const hx = (lineIdx - lineCx) * 7.0 + Math.cos(hTheta) * hRadius;
      const hy = lineY + (tLocal - 0.5) * 20.0 + Math.sin(time * 1.2 + charIdx) * 3.0;
      const hz = Math.sin(hTheta) * hRadius + Math.cos(time * 0.5 + lineY) * 4.0;

      // Blend helix → text
      const blend = isForeground ? Math.max(focusVal, morph) : 0.0;
      const fx = hx * (1.0 - blend) + tx * blend;
      const fy = hy * (1.0 - blend) + ty * blend;
      const fz = hz * (1.0 - blend) + tz * blend;

      this.target.set(fx * scale, fy * scale, fz * scale);

      // Color
      const hueHelix = 0.65 + hTheta * 0.01 + time * 0.05;
      const hueText  = 0.5 + Math.sin(time * 1.5 + tx * 0.05) * 0.08;
      const finalHue = (((isForeground ? hueText : hueHelix) % 1.0) + 1.0) % 1.0;
      const sat = isForeground ? 0.95 : 0.5;
      const lit = isForeground
        ? 0.5 + Math.sin(time * 8.0 + tLocal * 300.0) * 0.2
        : 0.15 + (tLocal % 0.05) * 3.0 + Math.max(0.0, Math.sin(hTheta * 2.0) * 0.2);

      this.pColor.setHSL(finalHue, sat, Math.max(0, Math.min(1, lit)));

      this.positions[i].lerp(this.target, 0.1);
      this.dummy.position.copy(this.positions[i]);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.pColor);
    }

    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate  = true;
    this.composer.render();
  }

  dispose() {
    this.pause();
    this.geometry.dispose();
    this.material.dispose();
    this.scene.remove(this.mesh);
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
