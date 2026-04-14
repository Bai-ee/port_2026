import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

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

const ParticleSwarm = ({ params = {}, liveParamsRef = null, runtimeProfile = {} }) => {
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
    // Animation params
    animationSpeed: 1.0,
    sphereSegments: 16,
  };

  const staticParams = useMemo(() => ({ ...defaultParams, ...params }), [params]);
  const count = staticParams.particleCount;
  const pColor = useMemo(() => new THREE.Color(), []);
  const color = pColor; // Alias for user code compatibility
  const lastScaleRef = useRef(-1);
  const targetKeysRef = useRef({ src: null, keys: null });

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

    // Param smoothing: only when live params are provided; otherwise use static directly.
    let PARAMS;
    if (liveParamsRef?.current) {
      const targetParams = liveParamsRef.current;
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
    groupRef.current.rotation.x = rotX;
    groupRef.current.rotation.y = rotY;
    groupRef.current.rotation.z = rotZ;

    material.uniforms.uOpacity.value = PARAMS.opacity ?? 1;

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
    const r1 = R + r * 0.2 * Math.sin(time * 0.5);
    const waveAmpY = waveAmp * Math.sin(time * 0.3);
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
  });

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[geometry, material, count]} />
    </group>
  );
};

export default function App({ params = {}, liveParamsRef = null, backgroundColor = '#1a1a1a', onReady = null }) {
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
    };
  }, [isMobile, prefersReducedMotion]);

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
        <ParticleSwarm params={optimizedParams} liveParamsRef={liveParamsRef} runtimeProfile={qualityProfile} />
        {qualityProfile.enableControls ? (
          <OrbitControls autoRotate={qualityProfile.autoRotate} enableZoom enablePan={false} enableRotate enableDamping dampingFactor={0.08} rotateSpeed={0.45} zoomSpeed={0.75} minDistance={45} maxDistance={180} />
        ) : null}
      </Canvas>
    </div>
  );
}
