import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export class TerrainSwarm {
  constructor(container, count = 20000) {
    this.count = count;
    this.container = container;
    this.speedMult = 1;
    this._running = false;
    this._frameId = 0;

    this._size       = 100;
    this._height     = 15;
    this._speed      = 0.5;
    this._ruggedness = 8;

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
      this.positions.push(
        new THREE.Vector3(
          (Math.random() - 0.5) * 100,
          (Math.random() - 0.5) * 100,
          (Math.random() - 0.5) * 100
        )
      );
      this.mesh.setColorAt(i, this.color.setHex(0x00ff88));
    }

    this.clock   = new THREE.Clock();
    this.animate = this.animate.bind(this);
  }

  updateParams({ size, height, speed, ruggedness }) {
    if (size       !== undefined) this._size       = size;
    if (height     !== undefined) this._height     = height;
    if (speed      !== undefined) this._speed      = speed;
    if (ruggedness !== undefined) this._ruggedness = ruggedness;
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
    const size       = this._size;
    const height     = this._height;
    const speed      = this._speed;
    const ruggedness = this._ruggedness;

    const cols = Math.floor(Math.sqrt(count));

    for (let i = 0; i < this.count; i++) {
      const u = ((i % cols) / cols) - 0.5;
      const v = (Math.floor(i / cols) / cols) - 0.5;
      const px = u * size;
      const pz = v * size;
      const t  = time * speed;

      let elevation =
        Math.sin(u * ruggedness + t * 0.5) * Math.cos(v * ruggedness + t * 0.4) +
        0.5 * Math.sin(u * ruggedness * 2.1 - t * 0.7) * Math.cos(v * ruggedness * 1.9 + t * 0.6) +
        0.25 * Math.sin(u * ruggedness * 4.3 + t * 1.1) * Math.cos(v * ruggedness * 3.8 - t * 0.9);

      const dist       = Math.sqrt(u * u + v * v);
      const peakImpact = Math.max(0, 1.0 - dist * 2.5);
      const finalY     = elevation * height + peakImpact * height * 2.0;

      this.target.set(px, finalY, pz);

      const normalizedElevation = Math.max(0, Math.min(1, (finalY + height) / (height * 3.0)));
      this.pColor.setHSL(
        0.33 - normalizedElevation * 0.05,
        1.0,
        0.2 + normalizedElevation * 0.6
      );

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
