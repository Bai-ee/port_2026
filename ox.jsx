import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

const SIMPLE_SCROLL_MEDIA_QUERY = '(max-width: 680px) and (pointer: coarse)';
const MOBILE_MEDIA_QUERY = '(max-width: 767px), (pointer: coarse)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const useMediaMatch = (query) => {
  const getMatches = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }

    return window.matchMedia(query).matches;
  };

  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(query);
    const updateMatches = (event) => setMatches(event.matches);

    setMatches(mediaQuery.matches);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', updateMatches);
      return () => mediaQuery.removeEventListener('change', updateMatches);
    }

    mediaQuery.addListener(updateMatches);
    return () => mediaQuery.removeListener(updateMatches);
  }, [query]);

  return matches;
};

// Component to set scene background color
const SceneBackground = ({ color }) => {
  const { scene } = useThree();

  useEffect(() => {
    if (color === null) {
      scene.background = null;
    } else {
      scene.background = new THREE.Color(color);
    }
  }, [color, scene]);

  return null;
};

// Screen-space silhouette sampling (opt-in via silhouetteRef; every other
// consumer of this component passes nothing and pays no cost).
//
// The swarm has no mesh edges to trace, but it does have a real silhouette. We
// project a sparse, evenly-spaced subset of particles to screen pixels, bin
// them by angle around their own projected centroid, and keep the farthest one
// per bin. That gives outline anchors that spin, pulse, and breathe with the
// actual object instead of a faked ellipse — for a few dozen projections a
// frame, against a 25k-particle loop that is already running.
const SILHOUETTE_BINS = 24;
const SILHOUETTE_SAMPLES = 96;
const TAU = Math.PI * 2;

export function createSilhouetteBuffer() {
  return {
    bins: SILHOUETTE_BINS,
    // [x0, y0, x1, y1, …] in CSS pixels, one entry per angular bin.
    points: new Float32Array(SILHOUETTE_BINS * 2),
    // Squared radius of the winning sample per bin; < 0 means the bin got no
    // sample this frame and its point is stale — readers must skip it.
    radii: new Float32Array(SILHOUETTE_BINS),
    sampleX: new Float32Array(SILHOUETTE_SAMPLES),
    sampleY: new Float32Array(SILHOUETTE_SAMPLES),
    cx: 0,
    cy: 0,
    valid: false,
  };
}

// Click-to-reform also returns the view to where it sat on page load: autoRotate
// and any user orbit/zoom drift the camera away over time, so the reform would
// otherwise re-assemble the loop at whatever angle the camera had wandered to.
const HOME_CAMERA_POSITION = [0, 0, 100];
const CAMERA_RESET_SECONDS = 0.7;

const CameraHomeReset = ({ resetRef = null, controlsRef = null }) => {
  const { camera } = useThree();
  const progressRef = useRef(-1);
  const fromVec = useMemo(() => new THREE.Vector3(), []);
  const homeVec = useMemo(() => new THREE.Vector3(...HOME_CAMERA_POSITION), []);

  // ⚠️ Default priority (0) only. Any useFrame with priority > 0 makes R3F hand
  // the render loop to that callback (`if (!state.internal.priority) gl.render(...)`)
  // — the scene then never paints and the loop disappears entirely. Ordering is
  // still correct: subscribers sort by priority, and drei's OrbitControls
  // updates at -1, so this runs after it and its eased position wins the frame.
  useFrame((state, delta) => {
    if (resetRef?.current) {
      resetRef.current = false;
      fromVec.copy(camera.position);
      progressRef.current = 0;
    }
    if (progressRef.current < 0) return;

    progressRef.current = Math.min(1, progressRef.current + delta / CAMERA_RESET_SECONDS);
    const eased = 1 - Math.pow(1 - progressRef.current, 3);
    camera.position.lerpVectors(fromVec, homeVec, eased);

    const controls = controlsRef?.current;
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    } else {
      camera.lookAt(0, 0, 0);
    }

    if (progressRef.current >= 1) progressRef.current = -1;
  });

  return null;
};

// Screen-space lens diffusion. Unlike the old particle-alpha treatment, this
// actually samples neighbouring pixels, so colour spreads softly instead of
// becoming denser/darker. The field is centred on a local-space point on the
// swarm, projected every frame after the group's rotation/parallax is applied.
const RADIAL_DIFFUSION_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uOrigin: { value: new THREE.Vector2(0.5, 0.5) },
    uStrength: { value: 0 },
    uFalloff: { value: 0.015 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform vec2 uOrigin;
    uniform float uStrength;
    uniform float uFalloff;
    varying vec2 vUv;

    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float distancePx = length((vUv - uOrigin) * uResolution);
      float radiusPx = max(uStrength, 0.0) * exp(-distancePx * max(uFalloff, 0.0));

      if (radiusPx < 0.35) {
        gl_FragColor = base;
        return;
      }

      vec2 texel = 1.0 / max(uResolution, vec2(1.0));
      vec4 sum = base * 2.0;
      float weight = 2.0;

      // Golden-angle samples fill a disc instead of making a visible ring.
      // Twelve fixed taps keep the effect bounded on the 25k-particle scene.
      const int DIFFUSION_TAPS = 12;
      for (int i = 0; i < DIFFUSION_TAPS; i++) {
        float fi = float(i);
        float angle = fi * 2.39996323;
        float discRadius = sqrt((fi + 0.5) / float(DIFFUSION_TAPS));
        vec2 offset = vec2(cos(angle), sin(angle)) * discRadius * radiusPx * texel;
        sum += texture2D(tDiffuse, vUv + offset);
        weight += 1.0;
      }

      vec4 blurred = sum / weight;
      float blurMix = smoothstep(0.35, 3.0, radiusPx);
      gl_FragColor = mix(base, blurred, blurMix);
    }
  `,
};

const RadialDiffusionEffect = ({ diffusionStateRef }) => {
  const { gl, scene, camera, size } = useThree();
  const composerRef = useRef(null);
  const passRef = useRef(null);
  const projectedOrigin = useMemo(() => new THREE.Vector3(), []);
  const drawingBufferSize = useMemo(() => new THREE.Vector2(), []);

  useEffect(() => {
    const composer = new EffectComposer(gl);
    const renderPass = new RenderPass(scene, camera);
    const diffusionPass = new ShaderPass(RADIAL_DIFFUSION_SHADER);
    const outputPass = new OutputPass();
    composer.addPass(renderPass);
    composer.addPass(diffusionPass);
    composer.addPass(outputPass);
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
    composerRef.current = composer;
    passRef.current = diffusionPass;

    return () => {
      composerRef.current = null;
      passRef.current = null;
      diffusionPass.dispose();
      outputPass.dispose();
      composer.dispose();
    };
  }, [camera, gl, scene]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
  }, [gl, size.height, size.width]);

  // Priority 1 intentionally owns rendering only while this /looper-only
  // effect is mounted. All simulation/camera callbacks at priority 0 run first.
  useFrame(() => {
    const composer = composerRef.current;
    const pass = passRef.current;
    if (!composer || !pass) {
      gl.render(scene, camera);
      return;
    }

    const diffusion = diffusionStateRef.current;
    const pixelRatio = gl.getPixelRatio();
    gl.getDrawingBufferSize(drawingBufferSize);
    pass.uniforms.uResolution.value.copy(drawingBufferSize);

    if (!diffusion?.group) {
      pass.uniforms.uStrength.value = 0;
    } else {
      diffusion.group.updateMatrixWorld(true);
      projectedOrigin.copy(diffusion.origin)
        .applyMatrix4(diffusion.group.matrixWorld)
        .project(camera);
      pass.uniforms.uOrigin.value.set(
        projectedOrigin.x * 0.5 + 0.5,
        projectedOrigin.y * 0.5 + 0.5,
      );
      // UI values are CSS pixels; the shader operates on drawing-buffer pixels.
      pass.uniforms.uStrength.value = Math.max(0, diffusion.strength) * pixelRatio;
      pass.uniforms.uFalloff.value = Math.max(0, diffusion.falloff) / pixelRatio;
    }

    composer.render();
  }, 1);

  return null;
};

const ParticleSwarm = ({ params = {}, liveParamsRef = null, runtimeProfile = {}, snapRef = null, scatterRef = null, silhouetteRef = null, diffusionStateRef = null }) => {
  const meshRef = useRef();
  const groupRef = useRef();
  const simTimeRef = useRef(0);
  const hiddenRef = useRef(typeof document !== 'undefined' ? document.hidden : false);
  const smoothedParamsRef = useRef(null);
  const defaultParams = {
    scale: 55,
    chaos: 0.8,
    flow: 0.6,
    particleCount: 25000,
    particleSize: 0.3,
    speedMult: 0.1,
    bloomThreshold: 0,
    bloomStrength: 1.8,
    bloomRadius: 0.4,
    hueSpeed: 0.02,
    waveAmplitude: 3,
    saturation: 0.85,
    lightness: 0.5,
    // New shape/geometry params
    torusMajorRadius: 1,
    torusTubeRadius: 0.2,
    torusSegments: 100,
    torusSegmentsDepth: 50,
    // Rotation params (static tilt)
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    // Tire spin animation params
    tireSpinAxis: 'y', // which axis to spin around: 'x', 'y', or 'z'
    tireSpinSpeed: 0.5, // speed of tire rotation (0 = static, up to 5 = very fast)
    torusPulse: 1, // 0 = locked shape (no r1 oscillation), 1 = full pulse
    // Animation params
    animationSpeed: 1.0,
    sphereSegments: 16,
    // /looper-only camera blur. Origin is in the same local space as each
    // particle position (pre-group-rotation), roughly the -scale..scale range.
    diffuseOriginX: 100,
    diffuseOriginY: 0,
    diffuseOriginZ: 0,
    diffuseStrength: 0,
    diffuseFalloff: 0.015,
  };

  const staticParams = useMemo(() => ({ ...defaultParams, ...params }), [params]);
  const count = staticParams.particleCount;
  const pColor = useMemo(() => new THREE.Color(), []);
  const color = pColor; // Alias for user code compatibility
  const lastScaleRef = useRef(-1);
  const targetKeysRef = useRef({ src: null, keys: null });
  const { camera, size } = useThree();
  const projVec = useMemo(() => new THREE.Vector3(), []);

  // Cursor parallax: normalized -1..1 pointer target + its eased follower.
  // Refs, not state — this runs per frame and must never re-render the canvas.
  // Applied as an ADDITIVE rotation/offset on the group so the scroll-driven
  // params (scale, chaos, torus radii) stay exactly as they were.
  const pointerTargetRef = useRef({ x: 0, y: 0 });
  const pointerRef = useRef({ x: 0, y: 0 });
  const pointerInfluence = runtimeProfile.pointerInfluence ?? 0;

  useEffect(() => {
    if (typeof window === 'undefined' || pointerInfluence <= 0) return undefined;

    // The canvas is pointer-events:none (it sits under the hero copy), so the
    // move has to be read at the window level.
    const handlePointerMove = (event) => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      pointerTargetRef.current.x = (event.clientX / w) * 2 - 1;
      pointerTargetRef.current.y = (event.clientY / h) * 2 - 1;
    };

    const handlePointerLeave = () => {
      pointerTargetRef.current.x = 0;
      pointerTargetRef.current.y = 0;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    document.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [pointerInfluence]);

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      arr[i3] = (Math.random() - 0.5) * 100;
      arr[i3 + 1] = (Math.random() - 0.5) * 100;
      arr[i3 + 2] = (Math.random() - 0.5) * 100;
    }
    return arr;
  }, [count]);

  // Material & Geom
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 1.0 } },
    transparent: true,
    vertexShader: `
        varying vec3 vNormal;
        varying vec3 vColor;
        void main() {
            vNormal = normalize(normalMatrix * normal);
            vColor = instanceColor;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec3 vColor;
        void main() {
            vec3 viewDir = vec3(0.0, 0.0, 1.0);
            float metallic = dot(vNormal, viewDir) * 0.5 + 0.5;
            metallic = pow(metallic, 3.0);
            float diffuse = metallic * 0.8 + 0.2;
            vec3 col = vColor * diffuse;
            gl_FragColor = vec4(col, uOpacity);
        }
    `
}), []);
  const geometry = useMemo(() => {
    return new THREE.SphereGeometry(1, staticParams.sphereSegments, staticParams.sphereSegments);
  }, [staticParams.sphereSegments]);
  useEffect(() => {
    smoothedParamsRef.current = { ...staticParams };
  }, [staticParams]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.frustumCulled = false;
    if (!mesh.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    }
    lastScaleRef.current = -1;
  }, [count]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const handleVisibilityChange = () => {
      hiddenRef.current = document.hidden;
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh || !groupRef.current) return;
    if (hiddenRef.current) return;
    const clampedDelta = Math.min(delta, runtimeProfile.maxDelta ?? 1 / 30);

    // Scatter: parent signals a re-entrance (e.g. scrolled back to top). Re-randomize the
    // live positions into the spawn cloud; the per-frame lerp below re-assembles the shape,
    // replaying the load-in "particles converge into the loop" formation.
    if (scatterRef?.current) {
      for (let i = 0; i < positions.length; i++) positions[i] = (Math.random() - 0.5) * 100;
      scatterRef.current = false;
    }

    // Param smoothing: only when live params are provided; otherwise use static directly.
    let PARAMS;
    if (liveParamsRef?.current) {
      const targetParams = liveParamsRef.current;
      // Snap: parent signals scroll returned to top — reset smoothed state to exactly
      // match the target so accumulated drift from quick scroll cycles is eliminated.
      if (snapRef?.current) {
        smoothedParamsRef.current = { ...targetParams };
        snapRef.current = false;
      }
      const nextParams = smoothedParamsRef.current ?? { ...targetParams };
      const smoothing = 1 - Math.exp(-clampedDelta * (runtimeProfile.paramSmoothing ?? 10));

      let keys;
      if (targetKeysRef.current.src === targetParams) {
        keys = targetKeysRef.current.keys;
      } else {
        keys = Object.keys(targetParams);
        targetKeysRef.current.src = targetParams;
        targetKeysRef.current.keys = keys;
      }

      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        const targetValue = targetParams[key];
        const currentValue = nextParams[key];
        if (typeof targetValue === 'number' && Number.isFinite(targetValue)) {
          const baseValue = typeof currentValue === 'number' && Number.isFinite(currentValue)
            ? currentValue
            : targetValue;
          nextParams[key] = baseValue + (targetValue - baseValue) * smoothing;
        } else {
          nextParams[key] = targetValue;
        }
      }
      smoothedParamsRef.current = nextParams;
      PARAMS = nextParams;
    } else {
      PARAMS = smoothedParamsRef.current ?? staticParams;
    }

    const speedMult = PARAMS.speedMult * PARAMS.animationSpeed;
    simTimeRef.current += clampedDelta;
    const time = simTimeRef.current * speedMult;

    // Group rotation (static tilt + animated spin)
    const spinAngle = simTimeRef.current * PARAMS.tireSpinSpeed;
    let rotX = PARAMS.rotationX;
    let rotY = PARAMS.rotationY;
    let rotZ = PARAMS.rotationZ;
    if (PARAMS.tireSpinAxis === 'x') rotX += spinAngle;
    else if (PARAMS.tireSpinAxis === 'y') rotY += spinAngle;
    else if (PARAMS.tireSpinAxis === 'z') rotZ += spinAngle;
    // Subtle cursor reaction: ease the follower toward the pointer, then tilt
    // and drift the whole group by a small amount. Deliberately additive and
    // capped — it must read as parallax, never as a second scroll animation.
    if (pointerInfluence > 0) {
      const pEase = 1 - Math.exp(-clampedDelta * 3.2);
      const pt = pointerTargetRef.current;
      const pc = pointerRef.current;
      pc.x += (pt.x - pc.x) * pEase;
      pc.y += (pt.y - pc.y) * pEase;
      rotY += pc.x * 0.16 * pointerInfluence;
      rotX += pc.y * 0.11 * pointerInfluence;
      groupRef.current.position.x = pc.x * 3.5 * pointerInfluence;
      groupRef.current.position.y = -pc.y * 2.5 * pointerInfluence;
    }

    groupRef.current.rotation.x = rotX;
    groupRef.current.rotation.y = rotY;
    groupRef.current.rotation.z = rotZ;

    material.uniforms.uOpacity.value = PARAMS.opacity ?? 1;
    if (diffusionStateRef) {
      const diffusion = diffusionStateRef.current;
      diffusion.group = groupRef.current;
      diffusion.origin.set(
        PARAMS.diffuseOriginX ?? 0,
        PARAMS.diffuseOriginY ?? 0,
        PARAMS.diffuseOriginZ ?? 0,
      );
      diffusion.strength = PARAMS.diffuseStrength ?? 0;
      diffusion.falloff = PARAMS.diffuseFalloff ?? 0.015;
    }

    // Hoist hot-path params & pre-compute time-dependent values (loop-invariant)
    const scale = PARAMS.scale;
    const chaos = PARAMS.chaos;
    const flow = PARAMS.flow;
    const waveAmp = PARAMS.waveAmplitude;
    const R = PARAMS.torusMajorRadius;
    const r = PARAMS.torusTubeRadius;
    const hueOffset = PARAMS.hueOffset ?? 0;
    const hueSpeed = PARAMS.hueSpeed;
    const saturation = PARAMS.saturation;
    const lightness = PARAMS.lightness;
    const scale08 = scale * 0.8;
    const timeFlow05 = time * flow * 0.5;
    const time04 = time * 0.4;
    const time07 = time * 0.7;
    const timeHue = time * hueSpeed;
    const pulse = PARAMS.torusPulse ?? 1;
    const r1 = R + r * 0.2 * Math.sin(time * 0.5) * pulse;
    const waveAmpY = waveAmp * (pulse > 0 ? Math.sin(time * 0.3) : 1);
    const waveZ = Math.cos(time04);
    const golden = 2.39996322972865332;
    const invCount = 1 / count;
    const lerp = runtimeProfile.positionLerp ?? 0.1;

    const s = PARAMS.particleSize;
    const scaleChanged = s !== lastScaleRef.current;
    lastScaleRef.current = s;

    if (!mesh.instanceColor) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    }
    if (mesh.frustumCulled) mesh.frustumCulled = false;
    const mArr = mesh.instanceMatrix.array;
    const cArr = mesh.instanceColor.array;

    for (let i = 0; i < count; i++) {
      const t = i * invCount;
      const u = i * golden + timeFlow05;
      const phi = Math.acos(1 - 2 * t);
      const v = phi * 2 + time04;

      const cu = Math.cos(u);
      const su = Math.sin(u);
      const cv = Math.cos(v);
      const sv = Math.sin(v);

      const x4 = r1 * cu;
      const y4 = r1 * su;
      const z4 = r * cv;
      const w4 = r * sv;

      const d = 2 - w4;
      const x = x4 / d;
      const y = y4 / d;
      const z = z4 / d;

      const wave = Math.sin(x * 5 + time) * Math.cos(y * 5 - time07) * chaos;

      const tx = x * scale + wave * waveAmp;
      const ty = y * scale + wave * waveAmpY;
      const tz = z * scale08 + wave * waveZ;

      const hue = (hueOffset + t * 0.8 + timeHue + wave * 0.05) % 1;
      pColor.setHSL(hue, saturation, lightness + wave * 0.15);

      const i3 = i * 3;
      const px = positions[i3]     + (tx - positions[i3])     * lerp;
      const py = positions[i3 + 1] + (ty - positions[i3 + 1]) * lerp;
      const pz = positions[i3 + 2] + (tz - positions[i3 + 2]) * lerp;
      positions[i3]     = px;
      positions[i3 + 1] = py;
      positions[i3 + 2] = pz;

      const mi = i * 16;
      if (scaleChanged) {
        mArr[mi]      = s; mArr[mi + 1]  = 0; mArr[mi + 2]  = 0; mArr[mi + 3]  = 0;
        mArr[mi + 4]  = 0; mArr[mi + 5]  = s; mArr[mi + 6]  = 0; mArr[mi + 7]  = 0;
        mArr[mi + 8]  = 0; mArr[mi + 9]  = 0; mArr[mi + 10] = s; mArr[mi + 11] = 0;
        mArr[mi + 15] = 1;
      }
      mArr[mi + 12] = px;
      mArr[mi + 13] = py;
      mArr[mi + 14] = pz;

      cArr[i3]     = pColor.r;
      cArr[i3 + 1] = pColor.g;
      cArr[i3 + 2] = pColor.b;
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;

    if (silhouetteRef) {
      const out = silhouetteRef.current || (silhouetteRef.current = createSilhouetteBuffer());
      const group = groupRef.current;
      // Rotation was written above this frame; matrixWorld is only refreshed
      // during render, so force it here or the anchors trail by a frame.
      group.updateMatrixWorld();
      const { points, radii, sampleX, sampleY } = out;
      const step = Math.max(1, Math.floor(count / SILHOUETTE_SAMPLES));

      let sumX = 0;
      let sumY = 0;
      let taken = 0;
      for (let i = 0; i < count && taken < SILHOUETTE_SAMPLES; i += step) {
        const i3 = i * 3;
        projVec.set(positions[i3], positions[i3 + 1], positions[i3 + 2])
          .applyMatrix4(group.matrixWorld)
          .project(camera);
        const px = (projVec.x * 0.5 + 0.5) * size.width;
        const py = (-projVec.y * 0.5 + 0.5) * size.height;
        sampleX[taken] = px;
        sampleY[taken] = py;
        sumX += px;
        sumY += py;
        taken += 1;
      }

      if (taken > 0) {
        const cx = sumX / taken;
        const cy = sumY / taken;
        radii.fill(-1);
        for (let s = 0; s < taken; s++) {
          const dx = sampleX[s] - cx;
          const dy = sampleY[s] - cy;
          const d2 = dx * dx + dy * dy;
          let angle = Math.atan2(dy, dx);
          if (angle < 0) angle += TAU;
          const bin = Math.min(SILHOUETTE_BINS - 1, ((angle / TAU) * SILHOUETTE_BINS) | 0);
          if (d2 > radii[bin]) {
            radii[bin] = d2;
            points[bin * 2] = sampleX[s];
            points[bin * 2 + 1] = sampleY[s];
          }
        }
        out.cx = cx;
        out.cy = cy;
        out.valid = true;
      } else {
        out.valid = false;
      }
    }
  });

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[geometry, material, count]} />
    </group>
  );
};

// `pointerInfluenceScale` (optional, default 1 = unchanged homepage behavior):
// multiplies the desktop profile's cursor-parallax strength — /looper passes
// >1 for a stronger cursor reaction across the page.
export default function App({ params = {}, liveParamsRef = null, backgroundColor = '#1a1a1a', onReady = null, snapRef = null, scatterRef = null, silhouetteRef = null, viewResetRef = null, pointerInfluenceScale = 1, enableDiffusion = false }) {
  const controlsRef = useRef(null);
  const diffusionStateRef = useRef({
    group: null,
    origin: new THREE.Vector3(),
    strength: 0,
    falloff: 0.015,
  });
  const useSimpleScrollViewport = useMediaMatch(SIMPLE_SCROLL_MEDIA_QUERY);
  const isMobile = useMediaMatch(MOBILE_MEDIA_QUERY);
  const prefersReducedMotion = useMediaMatch(REDUCED_MOTION_QUERY);

  const qualityProfile = useMemo(() => {
    if (prefersReducedMotion) {
      return {
        antialias: false,
        autoRotate: false,
        dpr: [1, 1],
        enableControls: false,
        particleScale: 0.18,
        powerPreference: 'default',
        positionLerp: 0.16,
        sphereSegments: 8,
        maxDelta: 1 / 60,
        paramSmoothing: 12,
        pointerInfluence: 0,
      };
    }

    if (isMobile) {
      return {
        antialias: false,
        autoRotate: false,
        dpr: [1, 1],
        enableControls: false,
        particleScale: 0.24,
        powerPreference: 'default',
        positionLerp: 0.14,
        sphereSegments: 8,
        maxDelta: 1 / 60,
        paramSmoothing: 12,
        pointerInfluence: 0,
      };
    }

    return {
      antialias: true,
      autoRotate: true,
      dpr: [1, 1.5],
      enableControls: true,
      particleScale: 1,
      powerPreference: 'high-performance',
      positionLerp: 0.1,
      sphereSegments: 16,
      maxDelta: 1 / 45,
      paramSmoothing: 10,
      pointerInfluence: 1 * pointerInfluenceScale,
    };
  }, [isMobile, prefersReducedMotion, pointerInfluenceScale]);

  const optimizedParams = useMemo(() => {
    const resolvedParticleCount = params.particleCount ?? 25000;
    const resolvedAnimationSpeed = params.animationSpeed ?? 1;

    return {
      ...params,
      particleCount: Math.max(400, Math.round(resolvedParticleCount * qualityProfile.particleScale)),
      sphereSegments: qualityProfile.sphereSegments,
      tireSpinSpeed: prefersReducedMotion ? 0 : params.tireSpinSpeed,
      animationSpeed: prefersReducedMotion
        ? Math.min(resolvedAnimationSpeed, 1)
        : isMobile
          ? Math.min(resolvedAnimationSpeed, 1.8)
          : resolvedAnimationSpeed,
    };
  }, [isMobile, params, prefersReducedMotion, qualityProfile]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100dvh',
        background: 'transparent',
        zIndex: 1,
        pointerEvents: 'none',
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 100], fov: 60 }}
        dpr={qualityProfile.dpr}
        style={{ pointerEvents: 'none', background: 'transparent', cursor: 'default' }}
        gl={{ alpha: true, antialias: qualityProfile.antialias, powerPreference: qualityProfile.powerPreference }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          // Notify parent after the first frame is painted so callers can
          // gate UI transitions (e.g. a loading overlay) on canvas readiness.
          if (typeof onReady === 'function') {
            requestAnimationFrame(() => onReady());
          }
        }}
      >
        <SceneBackground color={backgroundColor} />
        <ParticleSwarm params={optimizedParams} liveParamsRef={liveParamsRef} runtimeProfile={qualityProfile} snapRef={snapRef} scatterRef={scatterRef} silhouetteRef={silhouetteRef} diffusionStateRef={enableDiffusion ? diffusionStateRef : null} />
        <CameraHomeReset resetRef={viewResetRef} controlsRef={controlsRef} />
        {enableDiffusion ? <RadialDiffusionEffect diffusionStateRef={diffusionStateRef} /> : null}
        {qualityProfile.enableControls ? (
          <OrbitControls ref={controlsRef} autoRotate={qualityProfile.autoRotate} enableZoom enablePan={false} enableRotate enableDamping dampingFactor={0.08} rotateSpeed={0.45} zoomSpeed={0.75} minDistance={45} maxDistance={180} />
        ) : null}
      </Canvas>
    </div>
  );
}
