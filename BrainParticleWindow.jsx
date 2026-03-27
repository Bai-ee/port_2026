import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

// SVG viewBox center for Brain.svg (viewBox: 12.411 12.62 39.178 38.76)
const SVG_CX = 12.411 + 39.178 / 2; // ~31.999
const SVG_CY = 12.62 + 38.76 / 2;  // ~31.999
const SVG_SIZE = 39.178;
const WORLD_SCALE = 38;

const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vColor;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vColor = instanceColor;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  varying vec3 vNormal;
  varying vec3 vColor;
  void main() {
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    float metallic = dot(vNormal, viewDir) * 0.5 + 0.5;
    metallic = pow(metallic, 2.5);
    vec3 col = mix(vColor * 0.22, vColor, metallic);
    gl_FragColor = vec4(col + vColor * 0.14, 1.0);
  }
`;

const BrainParticleWindow = ({ params = {}, style }) => {
  const mountRef = useRef(null);
  const paramsRef = useRef(params);

  useEffect(() => {
    paramsRef.current = params;
  });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    let frameId = 0;
    let isActive = false;
    let isVisible = false;
    let svgReady = false;
    let animateFn = null;

    const isMobile = window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const maxDpr = prefersReducedMotion ? 1 : isMobile ? 1.1 : 1.5;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !isMobile && !prefersReducedMotion,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = true;

    const canvas = renderer.domElement;
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '2',
      filter: 'brightness(1.1) contrast(1.08)',
    });
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 500);
    camera.position.z = 88;
    const group = new THREE.Group();
    // Slight initial tilt so both hemispheres read clearly
    group.rotation.set(0.12, 0, 0.06);
    scene.add(group);

    const stop = () => {
      isActive = false;
      if (frameId) { cancelAnimationFrame(frameId); frameId = 0; }
    };

    const start = () => {
      if (isActive || !isVisible || !svgReady || document.hidden) return;
      isActive = true;
      frameId = requestAnimationFrame(animateFn);
    };

    // SVGLoader → ExtrudeGeometry → MeshSurfaceSampler
    const loader = new SVGLoader();
    loader.load('/img/icons/Brain.svg', (data) => {
      const allPoints = [];

      data.paths.forEach((path) => {
        SVGLoader.createShapes(path).forEach((shape) => {
          const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
            depth: 4,
            bevelEnabled: false,
          }).toNonIndexed();

          const tempMesh = new THREE.Mesh(extrudeGeo);
          const sampler = new MeshSurfaceSampler(tempMesh).build();
          const v = new THREE.Vector3();
          const sampleCount = 500;

          for (let i = 0; i < sampleCount; i++) {
            sampler.sample(v);
            allPoints.push(new THREE.Vector3(
              (v.x - SVG_CX) / SVG_SIZE * WORLD_SCALE,
              -((v.y - SVG_CY) / SVG_SIZE) * WORLD_SCALE,
              v.z * 0.6 - 1.2
            ));
          }
          extrudeGeo.dispose();
        });
      });

      if (allPoints.length === 0) return;

      const countScale = prefersReducedMotion ? 0.45 : isMobile ? 0.7 : 1;
      const count = Math.round(Math.min(1400, allPoints.length) * countScale);

      const geo = new THREE.SphereGeometry(0.18, 10, 10);
      const mat = new THREE.ShaderMaterial({ vertexShader, fragmentShader });
      const mesh = new THREE.InstancedMesh(geo, mat, count);
      group.add(mesh);

      // Scatter particles around the surface points to start
      const positions = Array.from({ length: count }, (_, i) => {
        const p = allPoints[i % allPoints.length];
        return new THREE.Vector3(
          p.x + (Math.random() - 0.5) * 8,
          p.y + (Math.random() - 0.5) * 8,
          p.z + (Math.random() - 0.5) * 4
        );
      });

      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      let lastW = 0;
      let lastH = 0;

      animateFn = (time) => {
        if (!isActive) return;

        const elapsed = time * 0.001;
        const p = paramsRef.current;

        // Sync renderer size
        const w = Math.max(1, Math.round(container.clientWidth));
        const h = Math.max(1, Math.round(container.clientHeight));
        if (w !== lastW || h !== lastH) {
          lastW = w; lastH = h;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        }

        // Slow 3D rotation to show depth
        group.rotation.y = elapsed * (p.speedMult ?? 0.14) * 0.9;
        group.rotation.x = 0.12 + Math.sin(elapsed * 0.18) * 0.1;

        const hueBase = elapsed * (p.hueSpeed ?? 0.032);

        for (let i = 0; i < count; i++) {
          const sp = allPoints[i % allPoints.length];
          const drift = Math.sin(elapsed * (p.animationSpeed ?? 1.0) * 1.4 + i * 0.04);
          const drift2 = Math.cos(elapsed * (p.animationSpeed ?? 1.0) * 1.1 + i * 0.031);
          const amp = (p.waveAmplitude ?? 1.1) * 0.55;

          const tx = sp.x + drift * amp;
          const ty = sp.y + drift2 * amp * 0.7;
          const tz = sp.z;

          positions[i].lerp({ x: tx, y: ty, z: tz }, 0.055);
          dummy.position.copy(positions[i]);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);

          const hue = (hueBase + (i / count) * 0.14 + 0.55) % 1; // shifted hue from base renderer
          color.setHSL(hue, p.saturation ?? 0.82, p.lightness ?? 0.68);
          mesh.setColorAt(i, color);
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

        renderer.render(scene, camera);
        frameId = requestAnimationFrame(animateFn);
      };

      svgReady = true;
      start();
    });

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry?.isIntersecting ?? false;
        if (isVisible) start(); else stop();
      },
      { root: null, threshold: 0, rootMargin: '100px 0px' }
    );
    observer.observe(container);

    const onVisibility = () => { if (document.hidden) stop(); else start(); };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      renderer.dispose();
      if (container.contains(canvas)) container.removeChild(canvas);
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{ ...style, position: 'relative', overflow: 'hidden' }}
    />
  );
};

export default BrainParticleWindow;
