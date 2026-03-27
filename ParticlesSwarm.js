import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export class ParticlesSwarm {
  constructor(container, count = 20000) {
    this.count = count;
    this.container = container;
    this.speedMult = 1;
    this._running = false;
    this._frameId = 0;

    // Tweakable params
    this._speed = 0.5;
    this._radius = 20;
    this._chaos = 2;

    const w = container.clientWidth || 300;
    const h = container.clientHeight || 200;

    // SETUP — transparent background
    this.scene = new THREE.Scene();
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

    // POST PROCESSING
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 1.5, 0.4, 0.85);
    bloomPass.strength = 1.8;
    bloomPass.radius = 0.4;
    bloomPass.threshold = 0;
    this.composer.addPass(bloomPass);

    // OBJECTS
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.target = new THREE.Vector3();
    this.pColor = new THREE.Color();

    this.geometry = new THREE.TetrahedronGeometry(0.25);
    this.material = new THREE.MeshBasicMaterial({ color: 0xffffff });

    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.mesh);

    this.positions = [];
    for (let i = 0; i < this.count; i++) {
      this.positions.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 100,
          (Math.random() - 0.5) * 100,
          (Math.random() - 0.5) * 100
        )
      );
      this.mesh.setColorAt(i, this.color.setHex(0x00ff88));
    }

    this.clock = new THREE.Clock();
    this.animate = this.animate.bind(this);
  }

  updateParams({ speed, radius, chaos }) {
    if (speed  !== undefined) this._speed  = speed;
    if (radius !== undefined) this._radius = radius;
    if (chaos  !== undefined) this._chaos  = chaos;
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
    if (this._frameId) {
      cancelAnimationFrame(this._frameId);
      this._frameId = 0;
    }
  }

  animate() {
    if (!this._running) return;
    this._frameId = requestAnimationFrame(this.animate);

    const time = this.clock.getElapsedTime() * this.speedMult;
    const count = this.count;
    const speed  = this._speed;
    const radius = this._radius;
    const chaos  = this._chaos;

    for (let i = 0; i < this.count; i++) {
      const target = this.target;
      const color  = this.pColor;

      const t     = time * speed;
      const iNorm = i / count;

      const phi   = Math.acos(-1 + 2 * iNorm);
      const theta = Math.sqrt(count * Math.PI) * phi + t;

      const x0 = Math.sin(phi) * Math.cos(theta);
      const y0 = Math.sin(phi) * Math.sin(theta);
      const z0 = Math.cos(phi);

      const pulse = Math.sin(t + iNorm * Math.PI * 2) * chaos;
      const x = x0 * (radius + pulse * Math.cos(t * 0.5));
      const y = y0 * (radius + pulse * Math.sin(t * 0.7));
      const z = z0 * (radius + pulse * Math.cos(t * 1.1));

      target.set(x, y, z);

      const hue       = (0.6 + Math.sin(t * 0.2 + iNorm * 5) * 0.2) % 1.0;
      const lightness = 0.4 + Math.abs(Math.cos(t + phi)) * 0.4;
      color.setHSL(hue, 0.8, lightness);

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
